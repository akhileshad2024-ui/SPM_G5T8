"""
US36 — the notification functions in backend/messaging.py, called directly on a throwaway SQLite database.

Covers the functions ready for stories still being built (US12 reassign, US14 confirm, US44 safety check
for US36-AC7, US49-US51 reassessment), US38's reassessment notice, and the rules every notice follows:
only the people involved get it, the person who made the change is left out, and a repeated check
(notify_once) does not send the same notice twice.
"""

from datetime import date, datetime, timedelta, timezone

import pytest

import messaging
import models
from auth_testkit import PASSWORD, get_user
from login import security
from login.models import Role, User


def notices(db, role_or_id):
    db.flush()
    user_id = role_or_id if isinstance(role_or_id, int) else get_user(db, role_or_id).id
    return db.query(models.Notification).filter_by(recipient_id=user_id).order_by(models.Notification.id).all()


def add_user(db, email, role):
    user = User(email=email, name=email.split("@")[0], role=role, password_hash=security.hash_password(PASSWORD),
                is_active=True, failed_login_attempts=0, session_version=0)
    db.add(user)
    db.flush()
    return user


@pytest.fixture
def event(db):
    row = models.Event(organiser_id=get_user(db, Role.organiser).id, coordinator_id=get_user(db, Role.coordinator).id,
                       name="Design Keynote", status=models.EventStatus.approved, date=date(2027, 1, 4))
    db.add(row)
    db.flush()
    return row


@pytest.fixture
def venue(db):
    row = models.Venue(name="Lecture Theatre 1", location="North wing", cap=250, layouts=["theatre"],
                       last_updated_by="daniel.ortiz@connectsphere.edu")
    db.add(row)
    db.flush()
    return row


def booking(db, event, venue, **fields):
    values = dict(
        event_id=event.id, event_name=event.name, venue_id=venue.id, venue_name=venue.name, status="pending",
        date=date(2027, 1, 4), start_time="10:00", end_time="12:00", setup_minutes=30, teardown_minutes=45,
        hold_start=datetime(2027, 1, 4, 9, 30), hold_end=datetime(2027, 1, 4, 12, 45), attendance=100,
        layout="theatre", verdict="suitable", requested_by="priya.tan@connectsphere.edu",
        requested_at=datetime.now(timezone.utc))
    row = models.VenueBooking(**{**values, **fields})
    db.add(row)
    db.flush()
    return row


def with_tech(db, event):
    db.add(models.EquipmentAssignment(event_id=event.id, tech_id=get_user(db, Role.tech).id))
    db.flush()
    db.refresh(event)


def register(db, event, attendee_id, status=models.RegistrationStatus.registered):
    now = datetime.now(timezone.utc)
    db.add(models.Registration(event_id=event.id, attendee_id=attendee_id, status=status, registered_at=now, updated_at=now))
    db.flush()


# ---------------------------------------------------------------- shared rules

def test_US36_notify_once_does_not_repeat_the_same_notice(db, event):
    coordinator = get_user(db, Role.coordinator).id
    for _ in range(3):
        messaging.notify_once(db, coordinator, event, "Venue hold expiring soon", "Design Keynote: soon.")
    db.commit()
    messaging.notify_once(db, coordinator, event, "Venue hold expiring soon", "Design Keynote: soon.")
    assert len(notices(db, coordinator)) == 1


def test_US36_notify_skips_a_missing_recipient(db, event):
    event.coordinator_id = None
    messaging.coordinator_assigned(db, event, get_user(db, Role.lead))
    messaging.notify_once(db, None, event, "t", "b")
    assert db.query(models.Notification).count() == 0


def test_US36_inactive_venue_staff_are_not_notified(db, event, venue):
    gone = add_user(db, "former.staff@connectsphere.edu", Role.venue)
    gone.is_active = False
    messaging.venue_booking_reassess(db, booking(db, event, venue))
    assert len(notices(db, Role.venue)) == 1
    assert notices(db, gone.id) == []


# ---------------------------------------------------------------- US42: the background sweep

def test_US36_US42_AC3_background_sweep_warns_without_anyone_using_the_app(db, event, venue):
    import threading
    from database import SessionLocal
    row = booking(db, event, venue, hold_expires_at=datetime.now(timezone.utc) + timedelta(hours=2))
    db.commit()

    class StopAfterOneSweep(threading.Event):
        calls = 0

        def wait(self, timeout=None):
            self.calls += 1
            return self.calls > 1  # the first wait "times out", so one sweep runs; the next one stops

    messaging.sweep_holds_forever(StopAfterOneSweep(), session_factory=SessionLocal, interval=0)
    assert [n.title for n in notices(db, Role.coordinator)] == ["Venue hold expiring soon"]
    assert row.venue_name in notices(db, Role.coordinator)[0].body


def test_US36_US42_AC3_sweeps_at_the_same_time_warn_only_once(db, event, venue, monkeypatch):
    # The background thread and the page's requests each sweep in their own session. Slow down sending
    # so the two sweeps overlap: without taking turns, both find no warning saved yet and both send one.
    import threading
    import time
    from database import SessionLocal
    booking(db, event, venue, hold_expires_at=datetime.now(timezone.utc) + timedelta(hours=2))
    db.commit()
    send = messaging.notify

    def slow_notify(*args):
        time.sleep(0.3)
        send(*args)

    monkeypatch.setattr(messaging, "notify", slow_notify)

    def sweep():
        with SessionLocal() as session:
            messaging.sweep_and_save(session)

    sweeps = [threading.Thread(target=sweep) for _ in range(2)]
    for thread in sweeps:
        thread.start()
    for thread in sweeps:
        thread.join()
    assert [n.title for n in notices(db, Role.coordinator)] == ["Venue hold expiring soon"]


def test_US36_US42_background_sweep_keeps_running_after_a_failure(caplog):
    import threading

    class StopAfterTwo(threading.Event):
        calls = 0

        def wait(self, timeout=None):
            self.calls += 1
            return self.calls > 2

    def broken_session():
        raise RuntimeError("database unavailable")

    stop = StopAfterTwo()
    messaging.sweep_holds_forever(stop, session_factory=broken_session, interval=0)
    assert stop.calls == 3  # tried twice, then stopped: a failure doesn't end the loop
    assert "Hold sweep failed" in caplog.text


# ---------------------------------------------------------------- US38

def test_US36_US38_AC4_coordinator_is_told_a_booking_requires_reassessment(db, event, venue):
    row = booking(db, event, venue, reassessment={"reason": "venue_time_changed", "message": "Now overlaps another booking."})
    messaging.bookings_flagged(db, [], [row])
    [notice] = notices(db, Role.coordinator)
    assert notice.title == "Booking requires reassessment"
    assert notice.body == "Design Keynote: Now overlaps another booking."


# ---------------------------------------------------------------- ready for US12 (reassign)

def test_US36_AC6_US12_AC4_reassignment_tells_both_coordinators_and_the_organiser(db, event):
    outgoing = event.coordinator_id
    lead = get_user(db, Role.lead)  # before the change: get_user() expires unsaved state
    incoming = add_user(db, "new.coord@connectsphere.edu", Role.coordinator)
    event.coordinator_id = incoming.id
    messaging.coordinator_reassigned(db, event, outgoing, lead)
    assert [n.title for n in notices(db, outgoing)] == ["Event reassigned"]
    assert [n.title for n in notices(db, incoming.id)] == ["Event assigned to you"]
    assert [n.title for n in notices(db, Role.organiser)] == ["New coordinator"]


# ---------------------------------------------------------------- ready for US14 (confirm)

def test_US36_US14_AC4_confirmation_reaches_organiser_and_involved_staff_not_the_confirmer(db, event, venue):
    with_tech(db, event)
    booking(db, event, venue, status="approved")
    coordinator = get_user(db, Role.coordinator)
    messaging.event_confirmed(db, event, coordinator)
    for role in (Role.organiser, Role.tech, Role.venue):
        assert [n.title for n in notices(db, role)] == ["Event confirmed"]
    assert notices(db, coordinator.id) == []
    assert notices(db, Role.attendee) == []


def test_US36_US14_AC4_venue_staff_are_not_told_when_the_event_holds_no_venue(db, event):
    messaging.event_confirmed(db, event, get_user(db, Role.coordinator))
    assert notices(db, Role.venue) == []


# ---------------------------------------------------------------- ready for US44 (safety check, US36-AC7)

def test_US36_AC7_safety_check_ready_sends_nothing_until_the_safety_officer_role_exists(db, event):
    assert not hasattr(Role, "safety")
    messaging.safety_check_ready(db, event)
    assert db.query(models.Notification).count() == 0


def test_US36_AC7_safety_check_ready_reaches_every_safety_officer(db, event, monkeypatch):
    officers = [add_user(db, f"safety{i}@connectsphere.edu", Role.tech) for i in (1, 2)]
    monkeypatch.setattr(messaging, "staff_with_role", lambda _db, role: [o.id for o in officers])
    messaging.safety_check_ready(db, event)
    for officer in officers:
        assert [n.title for n in notices(db, officer.id)] == ["Safety check needed"]


@pytest.mark.parametrize("outcome, title", [
    ("approved", "Safety check approved"),
    ("changes_requested", "Safety changes requested"),
    ("rejected", "Safety check rejected"),
])
def test_US36_AC7_coordinator_is_told_the_safety_outcome(db, event, outcome, title):
    messaging.safety_check_decided(db, event, outcome, "Fire exit is blocked.")
    [notice] = notices(db, Role.coordinator)
    assert notice.title == title
    assert notice.body.startswith("Design Keynote ") and notice.body.endswith("Comment: Fire exit is blocked.")


# ---------------------------------------------------------------- ready for US49-US51 (reassessment)

def test_US36_US49_AC3_venue_staff_are_told_a_booking_needs_reassessing(db, event, venue):
    messaging.venue_booking_reassess(db, booking(db, event, venue))
    [notice] = notices(db, Role.venue)
    assert notice.title == "Booking requires reassessment" and "Lecture Theatre 1" in notice.body


def test_US36_US50_AC3_assigned_technician_is_told_equipment_needs_reassessing(db, event):
    with_tech(db, event)
    messaging.equipment_reassess(db, event)
    assert [n.title for n in notices(db, Role.tech)] == ["Equipment requires reassessment"]


def test_US36_US50_AC3_no_technician_means_no_notice(db, event):
    messaging.equipment_reassess(db, event)
    assert db.query(models.Notification).count() == 0


def test_US36_US51_AC3_only_registered_attendees_are_told(db, event):
    registered = get_user(db, Role.attendee).id
    waitlisted = add_user(db, "wait@student.connectsphere.edu", Role.attendee).id
    withdrawn = add_user(db, "gone@student.connectsphere.edu", Role.attendee).id
    register(db, event, registered)
    register(db, event, waitlisted, models.RegistrationStatus.waitlisted)
    register(db, event, withdrawn, models.RegistrationStatus.withdrawn)
    messaging.attendees_affected(db, event, "now starts at 14:00.")
    assert [n.body for n in notices(db, registered)] == ["Design Keynote: now starts at 14:00."]
    assert notices(db, waitlisted) == []
    assert notices(db, withdrawn) == []


def test_US51_notification_does_not_include_registrations_for_other_events(db, event):
    other = models.Event(organiser_id=event.organiser_id, name="Other event",
                         status=models.EventStatus.approved)
    db.add(other)
    db.flush()
    attendee = get_user(db, Role.attendee).id
    register(db, other, attendee)
    messaging.attendees_affected(db, event, "now starts at 14:00.")
    assert notices(db, attendee) == []


def test_US51_recipient_filter_does_not_change_general_attendee_audience(db, event):
    registered = get_user(db, Role.attendee).id
    waitlisted = add_user(db, "waiting@student.connectsphere.edu", Role.attendee).id
    register(db, event, registered)
    register(db, event, waitlisted, models.RegistrationStatus.waitlisted)
    assert messaging.attendees(db, event) == [registered, waitlisted]


def test_US51_notification_is_rolled_back_with_callers_transaction(db, event):
    attendee = get_user(db, Role.attendee).id
    register(db, event, attendee)
    db.commit()
    messaging.attendees_affected(db, event, "now starts at 14:00.")
    assert len(notices(db, attendee)) == 1
    db.rollback()
    assert notices(db, attendee) == []

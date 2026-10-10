"""
US13 — View Event Status (API + database).

AC1: the user can view the current status of every event they are involved in
AC2: the status comes from the defined set
AC3: the user can view a timestamped history of all status changes for the event
AC4: the user cannot view the status of events they are not involved in

Status changes made by other stories (review, approval, confirmation...) are simulated
by calling change_status() directly, and coordinator assignments / venue bookings are
seeded straight into the database until those stories save them themselves.
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError, StatementError

import models
from auth_testkit import PASSWORD, get_user, login
from event_status import change_status
from login import security
from login.models import Role, User
from main import app

S = models.EventStatus
DEFINED_SET = {"draft", "submitted", "under_review", "pending_clarification", "approved", "rejected", "confirmed", "cancelled"}


def request(submit, **overrides):
    future = (datetime.now(timezone.utc) + timedelta(days=30)).date().isoformat()
    body = {
        "submit": submit, "name": "Design Week Keynote", "description": "Opening keynote.", "eventType": "Conference",
        "expectedAttendance": 120, "preferredDate": future, "startTime": "10:00", "endTime": "12:00",
        "venue": {"location": "Central campus", "capacity": 150, "layout": "theatre", "accessibility": [], "facilities": []},
        "equipment": [{"type": "E2", "quantity": 1, "technicalRequirements": "HDMI"}],
        "registration": {"required": False, "capacityLimit": None, "closingDate": None},
    }
    body.update(overrides)
    return body


def create(session, submit=True, **overrides):
    response = session.post("/events", json=request(submit, **overrides))
    assert response.status_code == 201, response.text
    return response.json()["id"]


def history(session, event_id):
    response = session.get(f"/events/{event_id}/history")
    assert response.status_code == 200, response.text
    return response.json()


def steps(entries):
    return [(e["fromStatus"], e["toStatus"]) for e in entries]


def move(db, event_id, *statuses, by=Role.coordinator, reason=None):
    """Simulate other stories moving the event along, through the shared change_status()."""
    db.expire_all()
    event = db.get(models.Event, event_id)
    user = get_user(db, by)
    for new in statuses:
        change_status(db, event, new, user, datetime.now(timezone.utc), reason=reason)
    db.commit()


def seed(db, event_id, **fields):
    db.expire_all()
    event = db.get(models.Event, event_id)
    for name, value in fields.items():
        setattr(event, name, value)
    db.commit()


def add_user(db, email, name, role):
    db.add(User(email=email, name=name, role=role, password_hash=security.hash_password(PASSWORD),
                is_active=True, failed_login_attempts=0, session_version=0))
    db.commit()
    session = TestClient(app)
    assert login(session, email).status_code == 200
    return session


# ---------------------------------------------------------------- AC3: history of every change

def test_a_saved_draft_starts_its_history(signed_in):
    organiser = signed_in(Role.organiser)
    event_id = create(organiser, submit=False)

    entries = history(organiser, event_id)

    assert steps(entries) == [(None, "draft")]
    assert entries[0]["changedBy"] == "Maya Rahman"


def test_submitting_a_saved_draft_is_recorded(signed_in):
    organiser = signed_in(Role.organiser)
    event_id = create(organiser, submit=False)
    organiser.put(f"/events/{event_id}", json=request(True))

    assert steps(history(organiser, event_id)) == [(None, "draft"), ("draft", "submitted")]


def test_resaving_a_draft_records_no_change(signed_in):
    organiser = signed_in(Role.organiser)
    event_id = create(organiser, submit=False)
    organiser.put(f"/events/{event_id}", json=request(False, name="Renamed"))

    assert steps(history(organiser, event_id)) == [(None, "draft")]


def test_a_request_submitted_straight_away_starts_as_submitted(signed_in):
    organiser = signed_in(Role.organiser)
    event_id = create(organiser, submit=True)

    assert steps(history(organiser, event_id)) == [(None, "submitted")]


def test_every_change_through_the_workflow_is_listed_in_order(signed_in, db):
    organiser = signed_in(Role.organiser)
    event_id = create(organiser)
    move(db, event_id, S.under_review, S.pending_clarification)
    move(db, event_id, S.under_review, by=Role.organiser)
    move(db, event_id, S.approved, S.confirmed)

    entries = history(organiser, event_id)

    assert steps(entries) == [
        (None, "submitted"), ("submitted", "under_review"), ("under_review", "pending_clarification"),
        ("pending_clarification", "under_review"), ("under_review", "approved"), ("approved", "confirmed"),
    ]
    assert [e["changedBy"] for e in entries] == [
        "Maya Rahman", "Priya Tan", "Priya Tan", "Maya Rahman", "Priya Tan", "Priya Tan",
    ]


def test_each_change_has_a_timestamp_in_order(signed_in, db):
    organiser = signed_in(Role.organiser)
    before = datetime.now(timezone.utc)
    event_id = create(organiser)
    move(db, event_id, S.under_review, S.approved)
    after = datetime.now(timezone.utc)

    stamps = [datetime.fromisoformat(e["changedAt"].replace("Z", "+00:00")) for e in history(organiser, event_id)]

    assert all(t.tzinfo is not None for t in stamps)  # sent with their timezone
    assert all(before - timedelta(seconds=1) <= t <= after + timedelta(seconds=1) for t in stamps)
    assert stamps == sorted(stamps)


def test_a_reason_is_shown_with_the_change(signed_in, db):
    organiser = signed_in(Role.organiser)
    event_id = create(organiser)
    move(db, event_id, S.under_review)
    move(db, event_id, S.rejected, reason="Clashes with the exam period")

    assert history(organiser, event_id)[-1]["reason"] == "Clashes with the exam period"


def test_a_refused_change_is_not_recorded(signed_in, db):
    organiser = signed_in(Role.organiser)
    event_id = create(organiser)

    with pytest.raises(Exception):
        move(db, event_id, S.confirmed)  # can't skip review
    db.rollback()

    assert steps(history(organiser, event_id)) == [(None, "submitted")]


# ---------------------------------------------------------------- AC1 + AC2: current status

def test_the_current_status_matches_the_last_history_entry(signed_in, db):
    organiser = signed_in(Role.organiser)
    event_id = create(organiser)
    move(db, event_id, S.under_review, S.pending_clarification)

    [event] = organiser.get("/events").json()

    assert event["status"] == "pending_clarification" == history(organiser, event_id)[-1]["toStatus"]


def test_every_status_shown_comes_from_the_defined_set(signed_in, db):
    organiser = signed_in(Role.organiser)
    for path in ([], [S.under_review], [S.under_review, S.pending_clarification], [S.under_review, S.approved],
                 [S.under_review, S.rejected], [S.under_review, S.approved, S.confirmed], [S.cancelled]):
        move(db, create(organiser), *path)
    create(organiser, submit=False)

    statuses = {e["status"] for e in organiser.get("/events").json()}

    assert statuses == DEFINED_SET


def test_the_database_refuses_a_status_outside_the_defined_set(signed_in, db):
    event_id = create(signed_in(Role.organiser))

    with pytest.raises((IntegrityError, StatementError, LookupError)):
        seed(db, event_id, status="planning")
    db.rollback()


# ---------------------------------------------------------------- AC4: only events you are involved in

def test_organisers_see_only_their_own_events(signed_in, db):
    maya_event = create(signed_in(Role.organiser))
    lin = add_user(db, "lin.chen@connectsphere.edu", "Lin Chen", Role.organiser)

    assert [e["id"] for e in lin.get("/events").json()] == []
    assert lin.get(f"/events/{maya_event}/history").status_code == 403


def test_a_coordinator_sees_events_assigned_to_them(signed_in, db):
    event_id = create(signed_in(Role.organiser))
    move(db, event_id, S.under_review)
    seed(db, event_id, coordinator_id=get_user(db, Role.coordinator).id)  # saved by US11 later

    coordinator = signed_in(Role.coordinator)

    assert [e["id"] for e in coordinator.get("/events").json()] == [event_id]
    assert history(coordinator, event_id)[-1]["toStatus"] == "under_review"


def test_a_coordinator_cannot_see_events_assigned_to_someone_else(signed_in, db):
    event_id = create(signed_in(Role.organiser))
    move(db, event_id, S.under_review)
    other = add_user(db, "marcus.lee@connectsphere.edu", "Marcus Lee", Role.coordinator)
    seed(db, event_id, coordinator_id=db.query(User).filter_by(email="marcus.lee@connectsphere.edu").one().id)

    coordinator = signed_in(Role.coordinator)

    assert coordinator.get("/events").json() == []
    assert coordinator.get(f"/events/{event_id}/history").status_code == 403
    assert history(other, event_id)[-1]["toStatus"] == "under_review"


def test_coordinators_see_submitted_events_nobody_has_picked_up(signed_in):
    event_id = create(signed_in(Role.organiser))

    assert [e["id"] for e in signed_in(Role.coordinator).get("/events").json()] == [event_id]


def test_drafts_are_visible_only_to_their_organiser(signed_in):
    event_id = create(signed_in(Role.organiser), submit=False)

    for role in (Role.coordinator, Role.venue, Role.tech, Role.attendee):
        session = signed_in(role)
        assert session.get("/events").json() == [], role
        assert session.get(f"/events/{event_id}/history").status_code == 403, role


def test_venue_staff_see_events_with_a_venue_booking(signed_in, db):
    booked = create(signed_in(Role.organiser))
    not_booked = create(signed_in(Role.organiser))
    move(db, booked, S.under_review, S.approved)
    db.add(models.Venue(name="Grand Hall", location="Level 1", cap=300, last_updated_by="seed"))
    db.commit()
    seed(db, booked, venue_id=db.query(models.Venue).one().id, booking_state="pending")  # saved by US22 later

    venue_staff = signed_in(Role.venue)

    assert [e["id"] for e in venue_staff.get("/events").json()] == [booked]
    assert venue_staff.get(f"/events/{not_booked}/history").status_code == 403


def test_technical_support_see_events_that_request_equipment(signed_in):
    with_equipment = create(signed_in(Role.organiser))
    without_equipment = create(signed_in(Role.organiser), equipment=[])

    tech = signed_in(Role.tech)

    assert [e["id"] for e in tech.get("/events").json()] == [with_equipment]
    assert tech.get(f"/events/{without_equipment}/history").status_code == 403


def test_attendees_see_only_confirmed_events_open_for_registration(signed_in, db):
    closes = (datetime.now(timezone.utc) + timedelta(days=20)).date().isoformat()
    registration = {"required": True, "capacityLimit": 100, "closingDate": closes}
    confirmed = create(signed_in(Role.organiser), registration=registration)
    approved = create(signed_in(Role.organiser), registration=registration)
    move(db, confirmed, S.under_review, S.approved, S.confirmed)
    move(db, approved, S.under_review, S.approved)

    attendee = signed_in(Role.attendee)

    assert [e["id"] for e in attendee.get("/events").json()] == [confirmed]
    assert attendee.get(f"/events/{approved}/history").status_code == 403


def test_history_of_a_missing_event_is_404(signed_in):
    assert signed_in(Role.organiser).get("/events/99999/history").status_code == 404


def test_signed_out_users_see_nothing(client, signed_in):
    event_id = create(signed_in(Role.organiser))

    assert client.get("/events").status_code == 401
    assert client.get(f"/events/{event_id}/history").status_code == 401

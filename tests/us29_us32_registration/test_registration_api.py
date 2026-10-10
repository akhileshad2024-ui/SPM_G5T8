"""
US29-US32: attendee registration saved on the server (backend/registrations.py).

    US29  register for a confirmed event open for registration; waitlisted when full
    US30  the attendee's own registrations and their status
    US31  withdraw up to the deadline (7 days before registration closes); a freed place
          goes to the longest-waiting attendee on the waitlist
    US32  the event's registrations, for its organiser and assigned coordinator only
"""

from datetime import datetime, time, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import models
import registrations
from auth_testkit import PASSWORD, _PASSWORD_HASH, get_user, login
from login.models import Role, User
from main import app
from schemas import campus_today

S = models.EventStatus
TODAY = campus_today()


def attendee(db, n: int) -> TestClient:
    """Signs in an extra attendee account (attendee1@..., attendee2@...)."""
    email = f"attendee{n}@student.connectsphere.edu"
    if db.query(User).filter(User.email == email).one_or_none() is None:
        db.add(User(email=email, name=f"Attendee {n}", role=Role.attendee, password_hash=_PASSWORD_HASH,
                    is_active=True, failed_login_attempts=0, session_version=0))
        db.commit()
    session = TestClient(app)
    assert login(session, email, PASSWORD).status_code == 200
    return session


def make_event(db, *, cap=2, closes_in=30, status=S.confirmed, reg=True, coordinator=True, **fields) -> int:
    event = models.Event(
        status=status, organiser_id=get_user(db, Role.organiser).id,
        coordinator_id=get_user(db, Role.coordinator).id if coordinator else None,
        name="Robotics Showcase", date=TODAY + timedelta(days=(closes_in or 0) + 10), start_time=time(10), end_time=time(16),
        facilities=[], accessibility=[], equipment=[], registration_required=reg, registration_cap=cap,
        registration_close=None if closes_in is None else TODAY + timedelta(days=closes_in),
        **fields,
    )
    db.add(event)
    db.commit()
    return event.id


def register(session, event_id):
    return session.post(f"/events/{event_id}/registrations")


def withdraw(session, event_id):
    return session.delete(f"/events/{event_id}/registrations/me")


def places_taken(session, event_id) -> int:
    response = session.get(f"/events/{event_id}")
    assert response.status_code == 200, response.text
    return response.json()["registered"]


def statuses(db, event_id) -> dict:
    db.expire_all()
    rows = db.query(models.Registration, User).join(User, User.id == models.Registration.attendee_id) \
        .filter(models.Registration.event_id == event_id).all()
    return {user.name: reg.status.value for reg, user in rows}


# ---------------------------------------------------------------- US29 register

def test_an_attendee_registers_and_takes_a_place(signed_in, db):
    event_id = make_event(db)
    sam = signed_in(Role.attendee)

    response = register(sam, event_id)

    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["status"], body["eventName"], body["attendeeName"]) == ("registered", "Robotics Showcase", "Sam Adeyemi")
    assert places_taken(sam, event_id) == 1
    assert statuses(db, event_id) == {"Sam Adeyemi": "registered"}


def test_registering_twice_is_refused_and_adds_nothing(signed_in, db):
    event_id = make_event(db)
    sam = signed_in(Role.attendee)
    register(sam, event_id)

    response = register(sam, event_id)

    assert response.status_code == 409
    assert response.json()["detail"] == "You already have a registered registration for Robotics Showcase."
    assert places_taken(sam, event_id) == 1


def test_a_full_event_puts_the_attendee_on_the_waitlist_without_taking_a_place(signed_in, db):
    event_id = make_event(db, cap=1)
    assert register(attendee(db, 1), event_id).json()["status"] == "registered"

    response = register(signed_in(Role.attendee), event_id)

    assert response.status_code == 201
    assert response.json()["status"] == "waitlisted"
    assert places_taken(attendee(db, 1), event_id) == 1


def test_the_last_place_goes_to_exactly_one_attendee(signed_in, db):
    event_id = make_event(db, cap=3)

    results = [register(attendee(db, n), event_id).json()["status"] for n in range(1, 6)]

    assert results == ["registered"] * 3 + ["waitlisted"] * 2
    assert places_taken(attendee(db, 1), event_id) == 3


def test_registration_is_open_up_to_and_including_the_closing_date(signed_in, db):
    event_id = make_event(db, closes_in=0)  # closes today

    assert register(signed_in(Role.attendee), event_id).status_code == 201


def test_registration_after_the_closing_date_is_refused(signed_in, db):
    event_id = make_event(db, closes_in=-1)

    response = register(signed_in(Role.attendee), event_id)

    assert response.status_code == 409
    assert response.json()["detail"] == "Registration for Robotics Showcase has closed."


@pytest.mark.parametrize("status", [s for s in S if s != S.confirmed], ids=lambda s: s.value)
def test_only_confirmed_events_take_registrations(signed_in, db, status):
    event_id = make_event(db, status=status)

    assert register(signed_in(Role.attendee), event_id).status_code == 403


def test_events_without_registration_take_no_registrations(signed_in, db):
    event_id = make_event(db, reg=False)

    assert register(signed_in(Role.attendee), event_id).status_code == 403


def test_the_rules_refuse_an_event_that_is_not_open_even_if_called_directly(db):
    event = db.get(models.Event, make_event(db, status=S.approved))

    with pytest.raises(Exception) as refused:
        registrations.register(db, event, get_user(db, Role.attendee), datetime.now(timezone.utc))

    assert refused.value.detail == "Registration is not open for this event."


def test_an_event_without_a_capacity_never_fills(signed_in, db):
    event_id = make_event(db, cap=None)

    assert [register(attendee(db, n), event_id).json()["status"] for n in range(1, 4)] == ["registered"] * 3


@pytest.mark.parametrize("role", [Role.organiser, Role.coordinator, Role.venue, Role.tech], ids=lambda r: r.value)
def test_only_attendees_can_register(signed_in, db, role):
    event_id = make_event(db)

    assert register(signed_in(role), event_id).status_code == 403


def test_registering_for_a_missing_event_is_not_found(signed_in):
    assert register(signed_in(Role.attendee), 9999).status_code == 404


def test_signed_out_users_cannot_register_or_withdraw(client, db):
    event_id = make_event(db)

    assert register(client, event_id).status_code == 401
    assert withdraw(client, event_id).status_code == 401
    assert client.get("/registrations/me").status_code == 401


# ---------------------------------------------------------------- US31 withdraw

def test_withdrawing_frees_the_place(signed_in, db):
    event_id = make_event(db)
    sam = signed_in(Role.attendee)
    register(sam, event_id)

    response = withdraw(sam, event_id)

    assert response.status_code == 200
    assert response.json()["status"] == "withdrawn"
    assert places_taken(sam, event_id) == 0


def test_a_freed_place_goes_to_the_longest_waiting_attendee(signed_in, db):
    event_id = make_event(db, cap=1)
    sam = signed_in(Role.attendee)
    register(sam, event_id)
    register(attendee(db, 1), event_id)  # waiting first
    register(attendee(db, 2), event_id)

    withdraw(sam, event_id)

    assert statuses(db, event_id) == {"Sam Adeyemi": "withdrawn", "Attendee 1": "registered", "Attendee 2": "waitlisted"}
    assert places_taken(sam, event_id) == 1


def test_leaving_the_waitlist_does_not_move_anyone_up(signed_in, db):
    event_id = make_event(db, cap=1)
    register(attendee(db, 1), event_id)
    sam = signed_in(Role.attendee)
    register(sam, event_id)
    register(attendee(db, 2), event_id)

    withdraw(sam, event_id)

    assert statuses(db, event_id) == {"Attendee 1": "registered", "Sam Adeyemi": "withdrawn", "Attendee 2": "waitlisted"}


def test_withdrawal_closes_seven_days_before_registration_closes(signed_in, db):
    on_the_deadline = make_event(db, closes_in=7)   # last day to withdraw is today
    past_the_deadline = make_event(db, closes_in=6)  # last day to withdraw was yesterday
    sam = signed_in(Role.attendee)
    register(sam, on_the_deadline)
    register(sam, past_the_deadline)

    assert withdraw(sam, on_the_deadline).status_code == 200
    refused = withdraw(sam, past_the_deadline)
    assert refused.status_code == 409
    assert refused.json()["detail"] == "The withdrawal deadline for Robotics Showcase has passed."


def test_the_deadline_is_sent_with_the_event(signed_in, db):
    event_id = make_event(db, closes_in=30)

    event = signed_in(Role.attendee).get(f"/events/{event_id}").json()

    assert event["withdrawalClose"] == (TODAY + timedelta(days=23)).isoformat()


def test_without_a_closing_date_withdrawal_is_allowed_until_the_event_date(db):
    event = db.get(models.Event, make_event(db, closes_in=None))

    assert registrations.withdrawal_close(event) == event.date


def test_withdrawing_without_a_registration_is_refused(signed_in, db):
    event_id = make_event(db)

    response = withdraw(signed_in(Role.attendee), event_id)

    assert response.status_code == 409
    assert response.json()["detail"] == "No active registration was found."


def test_withdrawing_twice_is_refused(signed_in, db):
    event_id = make_event(db)
    sam = signed_in(Role.attendee)
    register(sam, event_id)
    withdraw(sam, event_id)

    assert withdraw(sam, event_id).status_code == 409


def test_re_registering_after_withdrawing_joins_the_back_of_the_queue(signed_in, db):
    event_id = make_event(db, cap=1)
    sam = signed_in(Role.attendee)
    register(sam, event_id)
    register(attendee(db, 1), event_id)
    withdraw(sam, event_id)  # attendee 1 moves up

    again = register(sam, event_id)

    assert again.status_code == 201
    assert again.json()["status"] == "waitlisted"
    assert db.query(models.Registration).filter(models.Registration.event_id == event_id).count() == 2


# ---------------------------------------------------------------- US30 my registrations

def test_an_attendee_sees_their_registrations_newest_first(signed_in, db):
    first = make_event(db)
    second = make_event(db, cap=0)
    sam = signed_in(Role.attendee)
    register(sam, first)
    register(sam, second)

    mine = sam.get("/registrations/me").json()

    assert [(r["eventId"], r["status"]) for r in mine] == [(second, "waitlisted"), (first, "registered")]
    assert mine[0]["eventDate"] == (TODAY + timedelta(days=40)).isoformat()
    assert (mine[0]["eventStart"], mine[0]["eventEnd"]) == ("10:00:00", "16:00:00")


def test_a_registration_for_a_cancelled_event_shows_as_cancelled(signed_in, db):
    event_id = make_event(db)
    sam = signed_in(Role.attendee)
    register(sam, event_id)
    event = db.get(models.Event, event_id)
    event.status = S.cancelled
    db.commit()

    assert [r["status"] for r in sam.get("/registrations/me").json()] == ["cancelled"]


def test_attendees_only_see_their_own_registrations(signed_in, db):
    event_id = make_event(db)
    register(attendee(db, 1), event_id)

    assert signed_in(Role.attendee).get("/registrations/me").json() == []


# ---------------------------------------------------------------- US32 the event's registrations

def test_the_organiser_sees_every_registration_of_their_event(signed_in, db):
    event_id = make_event(db, cap=1)
    register(signed_in(Role.attendee), event_id)
    register(attendee(db, 1), event_id)

    rows = signed_in(Role.organiser).get(f"/events/{event_id}/registrations").json()

    assert [(r["attendeeName"], r["attendeeEmail"], r["status"]) for r in rows] == [
        ("Sam Adeyemi", "sam.adeyemi@student.connectsphere.edu", "registered"),
        ("Attendee 1", "attendee1@student.connectsphere.edu", "waitlisted"),
    ]


def test_the_assigned_coordinator_sees_the_registrations(signed_in, db):
    event_id = make_event(db)
    register(signed_in(Role.attendee), event_id)

    assert len(signed_in(Role.coordinator).get(f"/events/{event_id}/registrations").json()) == 1


def test_a_coordinator_not_assigned_to_the_event_is_refused(signed_in, db):
    event_id = make_event(db, coordinator=False)

    assert signed_in(Role.coordinator).get(f"/events/{event_id}/registrations").status_code == 403


def test_another_organisers_event_registrations_are_refused(signed_in, db):
    event_id = make_event(db)
    event = db.get(models.Event, event_id)
    event.organiser_id = get_user(db, Role.tech).id
    db.commit()

    assert signed_in(Role.organiser).get(f"/events/{event_id}/registrations").status_code == 403


@pytest.mark.parametrize("role", [Role.venue, Role.tech, Role.attendee], ids=lambda r: r.value)
def test_other_roles_cannot_see_an_events_registrations(signed_in, db, role):
    event_id = make_event(db)

    assert signed_in(role).get(f"/events/{event_id}/registrations").status_code == 403


def test_the_registrations_of_a_missing_event_are_not_found(signed_in):
    assert signed_in(Role.organiser).get("/events/9999/registrations").status_code == 404


def test_tech_support_do_not_get_the_registration_count(signed_in, db):
    event_id = make_event(db, equipment_state="requested")

    event = signed_in(Role.tech).get(f"/events/{event_id}").json()

    assert "registered" not in event
    assert "withdrawalClose" not in event

"""
US42 — Expire Tentative Venue Holds (Week 7 change CR-W7-4), through the API.

"As a Venue Staff member, I want tentative venue holds to expire at a set time so that a venue is
not held indefinitely while an Event Coordinator finalises arrangements."

A pending booking request is the tentative hold. These tests drive the real FastAPI app with real
session cookies on a throwaway SQLite database (tests/conftest.py), never Supabase. Where a test
needs the expiry to have passed, it moves the saved expiry into the past ("Given ...") rather than
waiting. The rules on their own are in unit/test_hold_expiry_rules_unit.py.

Criterion IDs (US42-AC1..AC4) are in the test names.
"""

from datetime import datetime, timedelta, timezone

import pytest

import models
from auth_testkit import get_user
from login.models import Role

MON = "2027-01-04"  # a Monday; setup for 10:00 starts 09:30 Singapore time (01:30 UTC)
THEATRE = {
    "name": "Lecture Theatre 1", "location": "North wing", "cap": 250,
    "layouts": ["theatre", "classroom"], "facilities": ["Projector"], "accessibility": [],
    "operatingHours": "08:00 - 22:00", "operatingDays": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    "setupMinutes": 30, "turnaroundMinutes": 45,
}
SGT = timezone(timedelta(hours=8))


@pytest.fixture
def staff(signed_in):
    return signed_in(Role.venue)


@pytest.fixture
def coordinator(signed_in):
    return signed_in(Role.coordinator)


@pytest.fixture
def organiser(signed_in):
    return signed_in(Role.organiser)


@pytest.fixture
def venue(staff):
    res = staff.post("/venues", json=THEATRE)
    assert res.status_code == 200, res.text
    return res.json()


@pytest.fixture
def lead(signed_in):
    return signed_in(Role.lead)


@pytest.fixture
def approved_event(organiser, coordinator, lead, db):
    """make() -> the id of an event submitted, assigned to Priya by the Lead, reviewed and approved, ready to book."""

    def make(name="Design Keynote"):
        res = organiser.post("/events", json={
            "submit": True, "name": name, "description": "US42 test.", "eventType": "Conference",
            "expectedAttendance": 100, "preferredDate": MON, "startTime": "10:00", "endTime": "12:00",
            "venue": {"location": "North wing", "capacity": 200, "layout": "theatre", "accessibility": [], "facilities": []},
            "equipment": [], "registration": {"required": False, "capacityLimit": None, "closingDate": None},
        })
        assert res.status_code == 201, res.text
        event_id = res.json()["id"]
        priya = get_user(db, Role.coordinator)
        assert lead.post(f"/events/{event_id}/assign", json={"coordinatorId": priya.id}).is_success  # US11: the Lead assigns
        for step, body in (("review", {}), ("decision", {"outcome": "approved", "reason": ""})):
            assert coordinator.post(f"/events/{event_id}/{step}", json=body).is_success
        return event_id

    return make


@pytest.fixture
def held(coordinator, venue, approved_event):
    """make() -> a pending booking request (a tentative hold) for a new approved event."""

    def make(name="Design Keynote"):
        res = coordinator.post(f"/venues/{venue['id']}/booking-requests", json={"event_id": approved_event(name)})
        assert res.status_code == 200, res.text
        return res.json()["booking"]

    return make


def expire_now(db, booking_id, ago=timedelta(minutes=1)):
    """Given: the hold's expiry has passed (moved into the past in the test database)."""
    db.expire_all()
    row = db.get(models.VenueBooking, booking_id)
    row.hold_expires_at = datetime.now(timezone.utc) - ago
    db.commit()


def bookings(client):
    res = client.get("/bookings")
    assert res.status_code == 200, res.text
    return {b["id"]: b for b in res.json()}


def parse(stamp):
    return datetime.fromisoformat(stamp.replace("Z", "+00:00"))


# ---------------------------------------------------------------- AC1: an expiry is set on every hold

def test_US42_AC1_a_new_request_is_held_with_a_default_expiry(held):
    booking = held()

    expires = parse(booking["hold_expires_at"])
    setup = datetime(2027, 1, 4, 9, 30, tzinfo=SGT)
    # Three days after the request, or the start of setup if that is sooner.
    assert expires <= setup
    assert expires == min(parse(booking["requested_at"]) + timedelta(days=3), setup)
    assert booking["hold_expiry_set_by"] is None


def test_US42_AC1_venue_staff_set_the_expiry_and_it_is_saved(held, staff):
    booking = held()
    wanted = datetime.now(SGT).replace(microsecond=0) + timedelta(days=1)

    res = staff.post(f"/bookings/{booking['id']}/hold", json={"expires_at": wanted.isoformat()})

    assert res.status_code == 200, res.text
    assert parse(res.json()["hold_expires_at"]) == wanted
    assert res.json()["hold_expiry_set_by"] == "daniel.ortiz@connectsphere.edu"
    assert parse(bookings(staff)[booking["id"]]["hold_expires_at"]) == wanted  # kept after a reload


@pytest.mark.parametrize("when, error", [
    (lambda: datetime.now(timezone.utc) - timedelta(hours=1), "The expiry must be in the future."),
    (lambda: datetime(2027, 1, 4, 9, 31, tzinfo=SGT), "The hold can't last beyond the start of setup for the event."),
])
def test_US42_AC1_an_expiry_in_the_past_or_after_setup_is_refused(held, staff, when, error):
    booking = held()

    res = staff.post(f"/bookings/{booking['id']}/hold", json={"expires_at": when().isoformat()})

    assert (res.status_code, res.json()["detail"]) == (409, error)


def test_US42_AC1_only_venue_staff_set_expiries(held, coordinator, organiser):
    booking = held()
    soon = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()

    for client in (coordinator, organiser):
        assert client.post(f"/bookings/{booking['id']}/hold", json={"expires_at": soon}).status_code == 403


def test_US42_AC1_an_approved_booking_has_no_hold_to_expire(held, staff):
    booking = held()
    assert staff.post(f"/bookings/{booking['id']}/decision", json={"outcome": "approved", "reason": ""}).is_success

    res = staff.post(f"/bookings/{booking['id']}/hold", json={"expires_at": (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()})

    assert res.status_code == 409
    assert "this one is approved" in res.json()["detail"]


def test_US42_AC1_an_unknown_booking_is_not_found(staff):
    res = staff.post("/bookings/999/hold", json={"expires_at": (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()})
    assert res.status_code == 404


# ---------------------------------------------------------------- AC2: expire automatically, release the venue

def test_US42_AC2_a_hold_past_its_expiry_is_saved_as_expired(held, staff, db):
    booking = held()
    expire_now(db, booking["id"])

    assert bookings(staff)[booking["id"]]["status"] == "expired"
    db.expire_all()
    assert db.get(models.VenueBooking, booking["id"]).status == "expired"


def test_US42_AC2_the_venue_is_released_for_other_requests(held, coordinator, venue, approved_event, db):
    # Given: one event's hold on the theatre has expired.
    first = held("Design Keynote")
    expire_now(db, first["id"])

    # When: another event asks for the same venue at the same time.
    res = coordinator.post(f"/venues/{venue['id']}/booking-requests", json={"event_id": approved_event("Pitch Night")})

    # Then: it is accepted as suitable, not refused or warned about a clash.
    assert res.status_code == 200, res.text
    assert res.json()["booking"]["verdict"] == "suitable"


def test_US42_AC2_until_it_expires_the_hold_keeps_the_venue(held, coordinator, venue, approved_event):
    held("Design Keynote")

    res = coordinator.post(f"/venues/{venue['id']}/booking-requests", json={"event_id": approved_event("Pitch Night")})

    # Still held: the clash is reported (the coordinator would have to acknowledge it).
    assert res.status_code == 409


def test_US42_AC2_the_event_no_longer_shows_the_venue_as_requested(held, coordinator, db):
    booking = held()
    expire_now(db, booking["id"])

    event = coordinator.get(f"/events/{booking['event_id']}").json()

    assert event.get("bookingState") in (None, "none")
    assert event.get("venue") in (None, "")


# ---------------------------------------------------------------- AC3: warned before, told at expiry

def test_US42_AC3_the_coordinator_is_warned_within_24_hours_of_expiry(held, coordinator, staff):
    booking = held()
    staff.post(f"/bookings/{booking['id']}/hold", json={"expires_at": (datetime.now(timezone.utc) + timedelta(hours=5)).isoformat()})

    assert bookings(coordinator)[booking["id"]]["hold_notice"] == "expiring_soon"


def test_US42_AC3_no_warning_while_expiry_is_further_off(held, coordinator, staff):
    booking = held()
    staff.post(f"/bookings/{booking['id']}/hold", json={"expires_at": (datetime.now(timezone.utc) + timedelta(hours=30)).isoformat()})

    assert bookings(coordinator)[booking["id"]]["hold_notice"] is None


def test_US42_AC3_the_coordinator_is_told_when_it_expires(held, coordinator, db):
    booking = held()
    expire_now(db, booking["id"])

    assert bookings(coordinator)[booking["id"]]["hold_notice"] == "expired"


# ---------------------------------------------------------------- AC4: shown as Expired, never confirmed

def test_US42_AC4_an_expired_hold_cannot_become_a_confirmed_booking(held, staff, db):
    booking = held()
    expire_now(db, booking["id"])

    res = staff.post(f"/bookings/{booking['id']}/decision", json={"outcome": "approved", "reason": ""})

    assert res.status_code == 409
    db.expire_all()
    assert db.get(models.VenueBooking, booking["id"]).status == "expired"


def test_US42_AC4_even_before_expired_is_saved_it_is_not_approved(held, staff, db):
    # The expiry passes between reads: the decision itself must still refuse it.
    booking = held()
    expire_now(db, booking["id"], ago=timedelta(seconds=1))

    res = staff.post(f"/bookings/{booking['id']}/decision", json={"outcome": "approved", "reason": ""})

    assert res.status_code == 409


def test_US42_AC4_the_coordinator_sees_it_as_expired(held, coordinator, db):
    booking = held()
    expire_now(db, booking["id"])

    assert bookings(coordinator)[booking["id"]]["status"] == "expired"

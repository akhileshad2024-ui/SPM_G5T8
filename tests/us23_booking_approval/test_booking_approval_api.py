"""
US23 — Approve or Reject Venue Booking, through the API (Week 7 changes CR-W7-3, CR-W7-4).

"As a Venue Staff member, I want to review and approve or reject a venue booking request, providing
a reason where relevant, so that the Event Coordinator can proceed with planning."

Drives the real FastAPI app with real session cookies on a throwaway SQLite database (never
Supabase). Events are made the way users make them: submitted, assigned, reviewed and approved, then
the coordinator requests a venue. Criterion IDs (US23-AC1..AC7) are in the test names.

AC1 note: ConnectSphere's Venue Staff are one team managing every venue (Sprint 3 decision), so
"the venues they manage" is every venue; see docs/user-stories/US23_booking_approval.md.
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import models
from auth_testkit import PASSWORD, get_user, login
from login import security
from login.models import Role, User
from main import app

MON = "2027-01-04"  # a Monday


def venue_body(name, **overrides):
    body = {
        "name": name, "location": f"{name} wing", "cap": 250, "layouts": ["theatre", "classroom"],
        "facilities": ["Projector"], "accessibility": ["Wheelchair Access"], "operatingHours": "08:00 - 22:00",
        "operatingDays": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], "setupMinutes": 30, "turnaroundMinutes": 45,
    }
    body.update(overrides)
    return body


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
def second_staff(db):
    """Another Venue Staff member (a separate account), signed in."""
    db.add(User(email="venue.two@connectsphere.edu", name="Venue Two", role=Role.venue,
                password_hash=security.hash_password(PASSWORD), is_active=True, failed_login_attempts=0, session_version=0))
    db.commit()
    c = TestClient(app)
    assert login(c, "venue.two@connectsphere.edu").status_code == 200
    return c


@pytest.fixture
def venues(staff):
    """make(name) -> a new venue in the catalogue."""

    def make(name="Lecture Theatre 1", **overrides):
        res = staff.post("/venues", json=venue_body(name, **overrides))
        assert res.status_code == 200, res.text
        return res.json()

    return make


@pytest.fixture
def lead(signed_in):
    return signed_in(Role.lead)


@pytest.fixture
def approved_event(organiser, coordinator, lead, db):
    """make() -> an event submitted, assigned to Priya by the Lead (US11), reviewed and approved, ready to book."""

    def make(name="Design Keynote", start="10:00", end="12:00"):
        res = organiser.post("/events", json={
            "submit": True, "name": name, "description": "US23 test.", "eventType": "Conference",
            "expectedAttendance": 100, "preferredDate": MON, "startTime": start, "endTime": end,
            "venue": {"location": "Campus", "capacity": 200, "layout": "theatre", "accessibility": [], "facilities": []},
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
def request_venue(coordinator):
    """request_venue(venue, event_id, **needs) -> the pending booking request."""

    def make(venue, event_id, **body):
        res = coordinator.post(f"/venues/{venue['id']}/booking-requests", json={"event_id": event_id, **body})
        assert res.status_code == 200, res.text
        return res.json()["booking"]

    return make


def decide(client, booking, outcome, reason=""):
    return client.post(f"/bookings/{booking['id']}/decision", json={"outcome": outcome, "reason": reason})


def listed(client):
    res = client.get("/bookings")
    assert res.status_code == 200, res.text
    return {b["id"]: b for b in res.json()}


# ---------------------------------------------------------------- AC1: see every pending request

def test_US23_AC1_venue_staff_see_pending_requests_for_every_venue(staff, venues, approved_event, request_venue):
    hall, room = venues("Grand Hall"), venues("Seminar Room")
    a = request_venue(hall, approved_event("Alumni Dinner"))
    b = request_venue(room, approved_event("Pitch Night"))

    pending = [x for x in listed(staff).values() if x["status"] == "pending"]

    assert {x["id"] for x in pending} == {a["id"], b["id"]}


def test_US23_AC1_every_venue_staff_member_sees_the_same_requests(staff, second_staff, venues, approved_event, request_venue):
    booking = request_venue(venues(), approved_event())

    assert booking["id"] in listed(staff)
    assert booking["id"] in listed(second_staff)


@pytest.mark.parametrize("role", [Role.organiser, Role.tech, Role.attendee])
def test_US23_AC1_other_roles_cannot_list_booking_requests(signed_in, role):
    assert signed_in(role).get("/bookings").status_code == 403


# ---------------------------------------------------------------- AC2: timing and venue requirements

def test_US23_AC2_a_request_shows_the_event_timing_and_venue_requirements(staff, venues, approved_event, request_venue):
    booking = request_venue(venues(), approved_event(), attendance=80, layout="classroom", purpose="Breakout session")

    shown = listed(staff)[booking["id"]]

    assert (shown["date"], shown["start"], shown["end"]) == (MON, "10:00", "12:00")
    assert (shown["setup_minutes"], shown["teardown_minutes"]) == (30, 45)
    assert (shown["hold_start"], shown["hold_end"]) == ("2027-01-04T09:30:00", "2027-01-04T12:45:00")
    assert (shown["attendance"], shown["layout"], shown["purpose"]) == (80, "classroom", "Breakout session")
    assert shown["event_name"] == "Design Keynote"


# ---------------------------------------------------------------- AC3: approve, or reject with a reason

def test_US23_AC3_venue_staff_approve_a_request(staff, venues, approved_event, request_venue):
    booking = request_venue(venues(), approved_event())

    res = decide(staff, booking, "approved")

    assert res.status_code == 200, res.text
    assert (res.json()["status"], res.json()["decided_by"]) == ("approved", "daniel.ortiz@connectsphere.edu")
    assert res.json()["decided_at"] is not None


@pytest.mark.parametrize("reason", ["", "   "])
def test_US23_AC3_rejecting_needs_a_reason(staff, venues, approved_event, request_venue, reason):
    booking = request_venue(venues(), approved_event())

    res = decide(staff, booking, "rejected", reason)

    assert (res.status_code, res.json()["detail"]) == (409, "Give a reason for rejecting the request.")
    assert listed(staff)[booking["id"]]["status"] == "pending"


def test_US23_AC3_a_rejection_keeps_its_reason(staff, venues, approved_event, request_venue):
    booking = request_venue(venues(), approved_event())

    res = decide(staff, booking, "rejected", "  Held for maintenance that week.  ")

    assert (res.json()["status"], res.json()["decision_reason"]) == ("rejected", "Held for maintenance that week.")


@pytest.mark.parametrize("role", [Role.coordinator, Role.organiser])
def test_US23_AC3_only_venue_staff_decide(signed_in, venues, approved_event, request_venue, role):
    booking = request_venue(venues(), approved_event())

    assert decide(signed_in(role), booking, "approved").status_code == 403


def test_US23_AC3_an_unknown_request_is_not_found(staff):
    assert staff.post("/bookings/999/decision", json={"outcome": "approved", "reason": ""}).status_code == 404


@pytest.mark.parametrize("first", ["approved", "rejected"])
def test_US23_AC3_a_decided_request_cannot_be_decided_again(staff, venues, approved_event, request_venue, first):
    booking = request_venue(venues(), approved_event())
    decide(staff, booking, first, "No room.")

    res = decide(staff, booking, "approved")

    assert (res.status_code, res.json()["detail"]) == (409, f"This request is no longer pending (it is {first}).")


# ---------------------------------------------------------------- AC4: the hold is confirmed or released

def test_US23_AC4_approving_confirms_the_hold_so_a_clashing_request_cannot_be_approved(staff, venues, approved_event, request_venue, coordinator):
    hall = venues()
    first = request_venue(hall, approved_event("Alumni Dinner"))
    decide(staff, first, "approved")

    # Another event at the same time can still be requested if the coordinator acknowledges the clash (US21),
    # but Venue Staff can't approve it: the confirmed booking holds the venue.
    second = coordinator.post(f"/venues/{hall['id']}/booking-requests", json={"event_id": approved_event("Pitch Night"), "acknowledged": True})
    assert second.status_code == 200, second.text

    res = decide(staff, second.json()["booking"], "approved")

    assert res.status_code == 409
    assert res.json()["detail"].startswith("Can't approve: Clashes with Alumni Dinner")


def test_US23_AC4_a_venue_deactivated_since_the_request_cannot_be_approved(staff, venues, approved_event, request_venue):
    hall = venues()
    booking = request_venue(hall, approved_event())
    assert staff.put(f"/venues/{hall['id']}", json={"is_active": False}).is_success

    res = decide(staff, booking, "approved")

    assert (res.status_code, res.json()["detail"]) == (409, "Lecture Theatre 1 has been deactivated and can't be approved.")


def test_US23_AC4_the_event_shows_its_venue_as_booked(staff, coordinator, venues, approved_event, request_venue):
    booking = request_venue(venues(), approved_event())
    decide(staff, booking, "approved")

    assert coordinator.get(f"/events/{booking['event_id']}").json()["bookingState"] == "approved"


def test_US23_AC4_rejecting_releases_the_venue_for_other_requests(staff, coordinator, venues, approved_event, request_venue):
    hall = venues()
    decide(staff, request_venue(hall, approved_event("Alumni Dinner")), "rejected", "Not suitable for a dinner.")

    res = coordinator.post(f"/venues/{hall['id']}/booking-requests", json={"event_id": approved_event("Pitch Night")})

    assert res.status_code == 200, res.text
    assert res.json()["booking"]["verdict"] == "suitable"  # no clash any more


# ---------------------------------------------------------------- AC5: the coordinator is told

@pytest.mark.parametrize("outcome, reason", [("approved", ""), ("rejected", "Held for maintenance that week.")])
def test_US23_AC5_the_requesting_coordinator_is_told_the_outcome(staff, coordinator, venues, approved_event, request_venue, outcome, reason):
    booking = request_venue(venues(), approved_event())
    decide(staff, booking, outcome, reason)

    seen = listed(coordinator)[booking["id"]]

    assert seen["decision_notice"] == outcome
    assert seen["decision_reason"] == (reason or None)


def test_US23_AC5_an_undecided_request_has_nothing_to_tell(coordinator, venues, approved_event, request_venue):
    booking = request_venue(venues(), approved_event())

    assert listed(coordinator)[booking["id"]]["decision_notice"] is None


def test_US23_AC5_old_decisions_are_not_repeated(staff, coordinator, venues, approved_event, request_venue, db):
    booking = request_venue(venues(), approved_event())
    decide(staff, booking, "approved")
    db.expire_all()
    db.get(models.VenueBooking, booking["id"]).decided_at = datetime.now(timezone.utc) - timedelta(days=8)
    db.commit()

    assert listed(coordinator)[booking["id"]]["decision_notice"] is None


# ---------------------------------------------------------------- AC6: each booking on its own

def test_US23_AC6_deciding_one_booking_leaves_the_events_other_bookings_alone(staff, venues, approved_event, request_venue):
    event_id = approved_event("Research Conference")
    main_hall = request_venue(venues("Auditorium"), event_id, purpose="Main programme")
    breakout = request_venue(venues("Seminar Room"), event_id, attendance=40, layout="classroom", purpose="Breakout session")

    decide(staff, main_hall, "approved")
    decide(staff, breakout, "rejected", "Too small for the breakout session.")

    shown = listed(staff)
    assert (shown[main_hall["id"]]["status"], shown[breakout["id"]]["status"]) == ("approved", "rejected")


def test_US23_AC6_an_event_waits_on_its_remaining_bookings(staff, coordinator, venues, approved_event, request_venue):
    event_id = approved_event("Research Conference")
    main_hall = request_venue(venues("Auditorium"), event_id, purpose="Main programme")
    request_venue(venues("Seminar Room"), event_id, attendance=40, layout="classroom", purpose="Breakout session")

    decide(staff, main_hall, "approved")

    # One booking approved, one still pending: the event isn't fully booked yet.
    assert coordinator.get(f"/events/{event_id}").json()["bookingState"] == "pending"


# ---------------------------------------------------------------- AC7: not after the hold has expired

def expire(db, booking_id):
    db.expire_all()
    db.get(models.VenueBooking, booking_id).hold_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()


def test_US23_AC7_an_expired_hold_cannot_be_approved(staff, venues, approved_event, request_venue, db):
    booking = request_venue(venues(), approved_event())
    expire(db, booking["id"])

    res = decide(staff, booking, "approved")

    assert res.status_code == 409
    assert res.json()["detail"].startswith("This tentative hold expired on ")
    assert res.json()["detail"].endswith(" and can't be approved.")
    assert listed(staff)[booking["id"]]["status"] == "expired"


def test_US23_AC7_rejecting_it_explains_the_venue_is_already_free(staff, venues, approved_event, request_venue, db):
    booking = request_venue(venues(), approved_event())
    expire(db, booking["id"])

    res = decide(staff, booking, "rejected", "Too late now.")

    assert res.status_code == 409
    assert res.json()["detail"].endswith(", so the venue has already been released.")


def test_US23_AC7_a_hold_still_within_its_expiry_can_be_approved(staff, venues, approved_event, request_venue):
    booking = request_venue(venues(), approved_event())  # default expiry: three days away

    assert decide(staff, booking, "approved").status_code == 200

"""
US14 — Confirm Event (Week 7 changes CR-W7-2, CR-W7-3, CR-W7-6), through the API.

"As an Event Coordinator, I want to confirm an event once its essential arrangements are complete so that
the Event Organiser knows the arrangements are finalised."

    POST /events/{id}/confirm        the assigned coordinator confirms (409 listing what is outstanding)
    GET  /events/{id}/confirmation   ready or not, every outstanding item, when/by whom, the locked fields

Each event is made the way users make it: Maya submits, Grace (the Lead) assigns Priya, Priya reviews and
approves and books venues, Daniel (Venue Staff) approves the bookings, Priya requests the Operational Safety
Check and Hannah (Safety Officer) approves it. Real session cookies, a throwaway SQLite database, never
Supabase. Criterion IDs (US14-AC1..AC7) are in the test names.
"""

from datetime import datetime, timedelta, timezone

import pytest

import models
from auth_testkit import get_user
from login.models import Role

MON = "2027-01-04"  # a Monday


@pytest.fixture
def people(signed_in):
    return {role: signed_in(role) for role in (Role.organiser, Role.coordinator, Role.lead, Role.venue, Role.safety, Role.tech)}


@pytest.fixture
def venue(people):
    """make(name) -> a new venue in the catalogue."""

    def make(name="Lecture Theatre 1"):
        res = people[Role.venue].post("/venues", json={
            "name": name, "location": f"{name} wing", "cap": 250, "layouts": ["theatre", "classroom"],
            "facilities": ["Projector"], "accessibility": [], "operatingHours": "08:00 - 22:00",
            "operatingDays": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], "setupMinutes": 30, "turnaroundMinutes": 45,
        })
        assert res.status_code == 200, res.text
        return res.json()

    return make


@pytest.fixture
def approved_event(people, db):
    """make(name) -> an event submitted by Maya, assigned to Priya by the Lead, reviewed and approved."""

    def make(name="Career Fair"):
        res = people[Role.organiser].post("/events", json={
            "submit": True, "name": name, "description": "US14 test.", "eventType": "Conference",
            "expectedAttendance": 100, "preferredDate": MON, "startTime": "10:00", "endTime": "12:00",
            "venue": {"location": "Campus", "capacity": 200, "layout": "theatre", "accessibility": [], "facilities": []},
            "equipment": [], "registration": {"required": False, "capacityLimit": None, "closingDate": None},
        })
        assert res.status_code == 201, res.text
        event_id = res.json()["id"]
        priya = people[Role.coordinator]
        assert people[Role.lead].post(f"/events/{event_id}/assign", json={"coordinatorId": get_user(db, Role.coordinator).id}).is_success
        assert priya.post(f"/events/{event_id}/review", json={}).is_success
        assert priya.post(f"/events/{event_id}/decision", json={"outcome": "approved", "reason": ""}).is_success
        return event_id

    return make


def book(people, venue, event_id, approve=True, **needs):
    res = people[Role.coordinator].post(f"/venues/{venue['id']}/booking-requests", json={"event_id": event_id, **needs})
    assert res.status_code == 200, res.text
    booking = res.json()["booking"]
    if approve:
        decided = people[Role.venue].post(f"/bookings/{booking['id']}/decision", json={"outcome": "approved", "reason": ""})
        assert decided.status_code == 200, decided.text
    return booking


def safety(people, event_id, outcome="approved", comment=""):
    assert people[Role.coordinator].post(f"/events/{event_id}/safety-check/request", json={}).status_code == 200
    res = people[Role.safety].post(f"/events/{event_id}/safety-check", json={"outcome": outcome, "comment": comment})
    assert res.status_code == 200, res.text


@pytest.fixture
def ready(people, venue, approved_event):
    """make(name) -> an event whose venue is approved and whose safety check the Safety Officer approved."""

    def make(name="Career Fair"):
        event_id = approved_event(name)
        book(people, venue(f"Hall for {name}"), event_id)
        safety(people, event_id)
        return event_id

    return make


def confirm(client, event_id):
    return client.post(f"/events/{event_id}/confirm", json={})


def readiness(client, event_id):
    res = client.get(f"/events/{event_id}/confirmation")
    assert res.status_code == 200, res.text
    return res.json()


def notices(client):
    body = client.get("/notifications").json()
    return [(n["title"], n["body"]) for n in (body["items"] if isinstance(body, dict) else body)]


# ---------------------------------------------------------------- AC1 + AC3: confirming a complete event

def test_US14_AC1_AC3_a_fully_arranged_event_is_confirmed_with_a_timestamp(people, ready):
    event_id = ready()

    res = confirm(people[Role.coordinator], event_id)

    assert (res.status_code, res.json()["status"]) == (200, "confirmed")
    shown = readiness(people[Role.coordinator], event_id)
    assert (shown["confirmed"], shown["confirmedBy"]) == (True, "Priya Tan")
    stamp = datetime.fromisoformat(shown["confirmedAt"].replace("Z", "+00:00"))
    assert abs(datetime.now(timezone.utc) - stamp) < timedelta(minutes=5)


def test_US14_AC1_every_venue_booking_must_be_approved(people, venue, approved_event):
    # CR-W7-3: a main hall (approved) and a breakout room still pending.
    event_id = approved_event("Research Conference")
    book(people, venue("Auditorium"), event_id, purpose="Main programme")
    book(people, venue("Seminar Room"), event_id, approve=False, attendance=40, layout="classroom", purpose="Breakout session")

    shown = readiness(people[Role.coordinator], event_id)

    assert "The booking at Seminar Room is still waiting for Venue Staff's approval." in shown["outstanding"]
    assert confirm(people[Role.coordinator], event_id).status_code == 409


@pytest.mark.parametrize("role", [Role.organiser, Role.lead, Role.venue, Role.safety, Role.tech])
def test_US14_AC1_only_the_assigned_coordinator_can_confirm(people, ready, role):
    event_id = ready()

    assert confirm(people[role], event_id).status_code == 403


# ---------------------------------------------------------------- AC2: outstanding items listed

def test_US14_AC2_a_refusal_lists_each_outstanding_item(people, venue, approved_event):
    event_id = approved_event()
    book(people, venue(), event_id, approve=False)

    res = confirm(people[Role.coordinator], event_id)

    assert res.status_code == 409
    assert res.json()["detail"] == (
        "Can't confirm yet. Outstanding: (1) The booking at Lecture Theatre 1 is still waiting for Venue Staff's approval. "
        "(2) The Safety Officer hasn't approved the Operational Safety Check yet (the event is Approved).")
    assert readiness(people[Role.coordinator], event_id)["outstanding"] == [
        "The booking at Lecture Theatre 1 is still waiting for Venue Staff's approval.",
        "The Safety Officer hasn't approved the Operational Safety Check yet (the event is Approved).",
    ]


# ---------------------------------------------------------------- AC4: everyone involved is told

def test_US14_AC4_the_organiser_and_venue_staff_are_notified(people, ready):
    event_id = ready()

    confirm(people[Role.coordinator], event_id)

    for role in (Role.organiser, Role.venue):
        assert "Event confirmed" in [title for title, _ in notices(people[role])], role


# ---------------------------------------------------------------- AC5: details locked

def test_US14_AC5_details_cannot_be_edited_after_confirmation(people, ready):
    event_id = ready()
    confirm(people[Role.coordinator], event_id)

    res = people[Role.coordinator].patch(f"/events/{event_id}/details", json={"pax": 999})

    assert res.status_code == 409
    assert people[Role.coordinator].get(f"/events/{event_id}").json()["pax"] == 100
    assert "pax" in readiness(people[Role.coordinator], event_id)["lockedFields"]


# ---------------------------------------------------------------- AC6: flagged bookings

def test_US14_AC6_a_booking_whose_venue_became_unavailable_blocks_confirmation(people, venue, approved_event):
    event_id = approved_event()
    hall = venue()
    book(people, hall, event_id)
    safety(people, event_id)
    # CR-W7-2 / US39: Venue Staff mark the hall unavailable over the event.
    marked = people[Role.venue].put(f"/venues/{hall['id']}", json={"unavailability": [
        {"start": f"{MON}T08:00:00", "end": f"{MON}T20:00:00", "reason": "maintenance", "note": "Ceiling repair"}]})
    assert marked.status_code == 200, marked.text

    res = confirm(people[Role.coordinator], event_id)

    assert res.status_code == 409
    assert "The booking at Lecture Theatre 1 needs alternative arrangements:" in res.json()["detail"]


# ---------------------------------------------------------------- AC7: the safety check

def test_US14_AC7_an_approved_event_cannot_skip_the_safety_check(people, venue, approved_event):
    event_id = approved_event()
    book(people, venue(), event_id)

    res = confirm(people[Role.coordinator], event_id)

    assert res.status_code == 409
    assert "The Safety Officer hasn't approved the Operational Safety Check yet (the event is Approved)." in res.json()["detail"]


def test_US14_AC7_a_safety_rejection_blocks_confirmation(people, venue, approved_event):
    event_id = approved_event()
    book(people, venue(), event_id)
    safety(people, event_id, "rejected", "Over capacity for the fire exits.")

    res = confirm(people[Role.coordinator], event_id)

    assert res.status_code == 409
    assert "(the event is Safety Rejected)" in res.json()["detail"]


def test_US14_signed_out_and_unknown_events(people, client):
    assert client.post("/events/1/confirm", json={}).status_code == 401
    assert people[Role.coordinator].get("/events/9999/confirmation").status_code == 404

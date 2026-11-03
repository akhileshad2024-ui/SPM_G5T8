"""
US49 — Reassess Venue Bookings After an Accepted Change (split from US35, CR-W7-3), through the API.

"As an Event Coordinator, I want the event's venue bookings to be re-evaluated and flagged for reassessment
when a change is accepted so that venue information remains consistent."

    POST /events/{id}/change-requests/{rid}/decision    accepting may name the reviewed values (effective_changes);
                                                        every venue booking is re-checked against them
    GET  /events/{id}/reassessments                     the event's "Requires Reassessment" flags (shared, US50/US51/US45)
    POST /events/{id}/reassessments/{flag}/resolve      the responsible staff resolve a flag, with a note
    POST /events/{id}/change-requests/{rid}/apply       the coordinator applies the reviewed values to the event

Each event is made the way users make it: Maya submits, Grace (the Lead) assigns Priya, Priya approves it and
books venues, Daniel (Venue Staff) approves the bookings, Maya proposes a change and Priya accepts it. Real
session cookies, a throwaway SQLite database, never Supabase. Criterion IDs (US49-AC1..AC4) are in the test names.
"""

import pytest

from auth_testkit import get_user
from login.models import Role

MON = "2027-01-04"  # a Monday
TUE = "2027-01-05"


@pytest.fixture
def people(signed_in):
    return {role: signed_in(role) for role in (Role.organiser, Role.coordinator, Role.lead, Role.venue, Role.safety, Role.tech)}


@pytest.fixture
def venue(people):
    """make(name, cap) -> a new venue in the catalogue (theatre or classroom, Monday to Friday 08:00-22:00)."""

    def make(name="Lecture Theatre 1", cap=250):
        res = people[Role.venue].post("/venues", json={
            "name": name, "location": f"{name} wing", "cap": cap, "layouts": ["theatre", "classroom"],
            "facilities": [], "accessibility": [], "operatingHours": "08:00 - 22:00",
            "operatingDays": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], "setupMinutes": 30, "turnaroundMinutes": 45,
        })
        assert res.status_code == 200, res.text
        return res.json()

    return make


@pytest.fixture
def approved_event(people, db):
    """make(name, start, end) -> an event (100 people, theatre, on MON) submitted by Maya, assigned to Priya, approved."""

    def make(name="Career Fair", start="10:00", end="12:00"):
        res = people[Role.organiser].post("/events", json={
            "submit": True, "name": name, "description": "US49 test.", "eventType": "Conference",
            "expectedAttendance": 100, "preferredDate": MON, "startTime": start, "endTime": end,
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


@pytest.fixture
def booked_event(people, venue, approved_event):
    """make(name, cap) -> (event id, booking): approved, with its hall booked and approved by Venue Staff."""

    def make(name="Career Fair", cap=250):
        event_id = approved_event(name)
        return event_id, book(people, venue(f"Hall for {name}", cap), event_id)

    return make


def book(people, venue, event_id, approve=True, **needs):
    res = people[Role.coordinator].post(f"/venues/{venue['id']}/booking-requests", json={"event_id": event_id, **needs})
    assert res.status_code == 200, res.text
    booking = res.json()["booking"]
    if approve:
        decided = people[Role.venue].post(f"/bookings/{booking['id']}/decision", json={"outcome": "approved", "reason": ""})
        assert decided.status_code == 200, decided.text
    return booking


def propose(people, event_id, text="Please move the event to Tuesday."):
    res = people[Role.organiser].post(f"/events/{event_id}/change-requests", json={"proposed_changes": text})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def accept(people, event_id, **changes):
    request_id = propose(people, event_id)
    body = {"outcome": "accepted", **({"effective_changes": changes} if changes else {})}
    res = people[Role.coordinator].post(f"/events/{event_id}/change-requests/{request_id}/decision", json=body)
    assert res.status_code == 200, res.text
    return res.json()


def venue_flags(client, event_id):
    res = client.get(f"/events/{event_id}/reassessments")
    assert res.status_code == 200, res.text
    return [f for f in res.json()["flags"] if f["targetType"] == "venue"]


def notices(client):
    body = client.get("/notifications").json()
    return [(n["title"], n["body"]) for n in (body["items"] if isinstance(body, dict) else body)]


def resolve(client, event_id, flag_id, note="Checked with the hall manager: still fine."):
    return client.post(f"/events/{event_id}/reassessments/{flag_id}/resolve", json={"note": note})


# ---------------------------------------------------------------- AC1: every booking re-checked on acceptance

def test_US49_AC1_accepting_a_change_rechecks_every_booking(people, venue, booked_event):
    event_id, hall = booked_event()
    breakout = book(people, venue("Seminar Room"), event_id, attendance=30, layout="classroom", purpose="Breakout session")

    saved = accept(people, event_id, date=TUE, pax=120)

    evaluation = saved["decision"]["reassessment"]
    assert evaluation["venue_checked"] == 2
    flagged = venue_flags(people[Role.coordinator], event_id)
    assert sorted(f["targetId"] for f in flagged) == sorted([hall["id"], breakout["id"]])
    assert sorted(evaluation["flag_ids"]) == sorted(f["id"] for f in flagged)


def test_US49_AC1_the_event_itself_is_not_edited(people, booked_event):
    # US34 boundary: the reviewed values are kept with the decision, not applied to the event.
    event_id, _ = booked_event()
    keys = ("date", "start", "end", "pax", "layout", "status")
    before = people[Role.coordinator].get(f"/events/{event_id}").json()
    accept(people, event_id, date=TUE, start="14:00", end="16:00", pax=120, layout="classroom")
    after = people[Role.coordinator].get(f"/events/{event_id}").json()
    assert {k: after[k] for k in keys} == {k: before[k] for k in keys}


def test_US49_AC1_a_change_that_still_fits_flags_nothing(people, booked_event):
    event_id, _ = booked_event()
    saved = accept(people, event_id, pax=120)
    assert saved["decision"]["reassessment"]["venue_checked"] == 1
    assert venue_flags(people[Role.coordinator], event_id) == []


# ---------------------------------------------------------------- AC2: invalid bookings flagged

def test_US49_AC2_a_venue_too_small_for_the_change_is_flagged(people, booked_event):
    event_id, hall = booked_event(cap=150)

    accept(people, event_id, pax=200)

    [flag] = venue_flags(people[Role.venue], event_id)
    assert (flag["targetId"], flag["status"], flag["source"]) == (hall["id"], "Requires Reassessment", "change_request")
    assert flag["reason"] == "Capacity 150 is below the expected attendance of 200."
    # The booking is kept as it was.
    booking = next(b for b in people[Role.coordinator].get("/bookings").json() if b["id"] == hall["id"])
    assert (booking["status"], booking["attendance"]) == ("approved", 100)


def test_US49_AC2_a_new_time_that_clashes_with_another_event_is_flagged(people, approved_event, booked_event):
    event_id, hall = booked_event()
    # Gala Dinner has the same hall that afternoon, 15:00-17:00 (held from 14:30 with setup).
    gala_id = approved_event("Gala Dinner", "15:00", "17:00")
    book(people, {"id": hall["venue_id"]}, gala_id)

    accept(people, event_id, start="14:00", end="16:00")

    [flag] = venue_flags(people[Role.coordinator], event_id)
    assert flag["reason"].startswith(
        "The booking holds 04 Jan 2027, 10:00–12:00, but the event as reviewed is on 04 Jan 2027, 14:00–16:00. "
        "Clashes with Gala Dinner, already booked on 04 Jan 2027"), flag["reason"]


# ---------------------------------------------------------------- AC3: Venue Staff told of each flagged booking

def test_US49_AC3_venue_staff_are_told_of_each_flagged_booking(people, venue, booked_event):
    event_id, _ = booked_event()
    book(people, venue("Annex"), event_id, attendance=40, purpose="Overflow")

    accept(people, event_id, date=TUE)

    told = [b for t, b in notices(people[Role.venue]) if t == "Booking requires reassessment"]
    assert sorted(told) == [
        "Career Fair: an accepted change means the Annex booking for 2027-01-04 needs reassessing. Review it in Bookings.",
        "Career Fair: an accepted change means the Hall for Career Fair booking for 2027-01-04 needs reassessing. Review it in Bookings.",
    ]
    for role in (Role.organiser, Role.tech, Role.safety, Role.lead):
        assert "Booking requires reassessment" not in [t for t, _ in notices(people[role])]


def test_US49_AC3_nobody_is_told_when_nothing_was_flagged(people, booked_event):
    event_id, _ = booked_event()
    accept(people, event_id, pax=110)
    assert "Booking requires reassessment" not in [t for t, _ in notices(people[Role.venue])]


# ---------------------------------------------------------------- AC4: confirmation blocked until resolved

def test_US49_AC4_a_flagged_booking_blocks_confirmation_until_it_is_resolved(people, booked_event):
    event_id, hall = booked_event(cap=150)
    priya = people[Role.coordinator]
    assert priya.post(f"/events/{event_id}/safety-check/request", json={}).status_code == 200
    assert people[Role.safety].post(f"/events/{event_id}/safety-check", json={"outcome": "approved", "comment": ""}).status_code == 200
    saved = accept(people, event_id, pax=200)
    [flag] = venue_flags(priya, event_id)

    outstanding = priya.get(f"/events/{event_id}/confirmation").json()["outstanding"]
    assert f"Venue {hall['id']}: Requires Reassessment — Capacity 150 is below the expected attendance of 200." in outstanding
    refused = priya.post(f"/events/{event_id}/confirm", json={})
    assert refused.status_code == 409 and "Requires Reassessment" in refused.json()["detail"]

    # Priya applies the reviewed values; Daniel finds the hall still fits (balcony seating) and resolves the flag.
    assert resolve(people[Role.venue], event_id, flag["id"]).status_code == 409  # not applied yet
    assert priya.post(f"/events/{event_id}/change-requests/{saved['id']}/apply").status_code == 200
    assert resolve(people[Role.venue], event_id, flag["id"], "Balcony seating opens for 60 more.").status_code == 200

    [resolved] = venue_flags(priya, event_id)
    assert (resolved["status"], resolved["resolution"]) == ("resolved", "Balcony seating opens for 60 more.")
    outstanding = priya.get(f"/events/{event_id}/confirmation").json()["outstanding"]
    assert not [item for item in outstanding if "Requires Reassessment" in item], outstanding


def test_US49_AC4_only_the_responsible_staff_resolve_a_venue_flag(people, booked_event):
    event_id, _ = booked_event(cap=150)
    saved = accept(people, event_id, pax=200)
    assert people[Role.coordinator].post(f"/events/{event_id}/change-requests/{saved['id']}/apply").status_code == 200
    [flag] = venue_flags(people[Role.coordinator], event_id)
    assert resolve(people[Role.tech], event_id, flag["id"]).status_code == 403
    assert resolve(people[Role.venue], event_id, flag["id"], note="").status_code == 422
    assert venue_flags(people[Role.coordinator], event_id)[0]["status"] == "Requires Reassessment"

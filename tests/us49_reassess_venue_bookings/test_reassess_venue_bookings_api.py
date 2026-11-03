"""
US49 — Reassess Venue Bookings After an Accepted Change (split from US35, CR-W7-3), through the API.

"As an Event Coordinator, I want the event's venue bookings to be re-evaluated and flagged for reassessment
when a change is accepted so that venue information remains consistent."

    POST /events/{id}/change-requests/{rid}/decision    accepting may say what the change changes ("changes");
                                                        every booking is re-checked and the results saved on the request
    POST /bookings/{id}/reassessment/resolve            Venue Staff: the flagged booking still fits (with a note)

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


def decide(people, event_id, request_id, outcome="accepted", client=None, **changes):
    body = {"outcome": outcome, **({"changes": changes} if changes else {})}
    return (client or people[Role.coordinator]).post(f"/events/{event_id}/change-requests/{request_id}/decision", json=body)


def accept(people, event_id, **changes):
    res = decide(people, event_id, propose(people, event_id), **changes)
    assert res.status_code == 200, res.text
    return res.json()


def booking_seen_by(client, booking_id):
    return next(b for b in client.get("/bookings").json() if b["id"] == booking_id)


def notices(client):
    body = client.get("/notifications").json()
    return [(n["title"], n["body"]) for n in (body["items"] if isinstance(body, dict) else body)]


def get_user_name(client):
    return client.get("/auth/me").json()["name"]


def resolve(people, booking_id, note="Checked with the hall manager: still fine.", client=None):
    return (client or people[Role.venue]).post(f"/bookings/{booking_id}/reassessment/resolve", json={"note": note})


# ---------------------------------------------------------------- AC1: every booking re-checked on acceptance

def test_US49_AC1_accepting_a_change_rechecks_every_booking_and_saves_each_result(people, venue, booked_event):
    event_id, hall = booked_event()
    breakout = book(people, venue("Seminar Room"), event_id, attendance=30, layout="classroom", purpose="Breakout session")

    saved = accept(people, event_id, date=TUE, pax=120)

    assert saved["accepted_changes"] == {"date": TUE, "pax": 120}
    assert [(r["booking_id"], r["outcome"]) for r in saved["venue_reassessment"]["bookings"]] == [
        (hall["id"], "requires_reassessment"), (breakout["id"], "requires_reassessment")]
    # The organiser and the coordinator read back the same saved request.
    url = f"/events/{event_id}/change-requests"
    assert saved in people[Role.organiser].get(url).json()
    assert saved in people[Role.coordinator].get(url).json()


def test_US49_AC1_the_event_itself_is_not_edited(people, booked_event):
    # US34 boundary: the accepted values are kept on the request, not applied to the event.
    event_id, _ = booked_event()
    before = people[Role.coordinator].get(f"/events/{event_id}").json()
    accept(people, event_id, date=TUE, start="14:00", end="16:00", pax=120, layout="classroom")
    after = people[Role.coordinator].get(f"/events/{event_id}").json()
    assert {k: after[k] for k in ("date", "start", "end", "pax", "layout", "status")} == \
           {k: before[k] for k in ("date", "start", "end", "pax", "layout", "status")}


def test_US49_AC1_a_change_that_still_fits_flags_nothing(people, booked_event):
    event_id, hall = booked_event()
    saved = accept(people, event_id, pax=120)
    assert saved["venue_reassessment"]["bookings"][0]["outcome"] == "still_valid"
    assert booking_seen_by(people[Role.venue], hall["id"])["reassessment"] is None


@pytest.mark.parametrize("body, status", [
    ({"outcome": "rejected", "changes": {"pax": 300}}, 422),
    ({"outcome": "accepted", "changes": {"start": "13:00"}}, 422),
    ({"outcome": "accepted", "changes": {"start": "1pm"}}, 422),
    ({"outcome": "accepted", "changes": {"pax": 0}}, 422),
    ({"outcome": "accepted", "changes": {"venue": "Somewhere else"}}, 422),
])
def test_US49_AC1_B01_invalid_changes_are_refused_and_nothing_is_saved(people, booked_event, body, status):
    event_id, hall = booked_event()
    request_id = propose(people, event_id)
    res = people[Role.coordinator].post(f"/events/{event_id}/change-requests/{request_id}/decision", json=body)
    assert res.status_code == status, res.text
    saved = people[Role.coordinator].get(f"/events/{event_id}/change-requests").json()[0]
    assert (saved["status"], saved["accepted_changes"], saved["venue_reassessment"]) == ("pending", None, None)
    assert booking_seen_by(people[Role.venue], hall["id"])["reassessment"] is None


# ---------------------------------------------------------------- AC2: invalid bookings flagged

def test_US49_AC2_a_booking_the_change_invalidates_is_flagged_requires_reassessment(people, booked_event):
    event_id, hall = booked_event(cap=150)

    saved = accept(people, event_id, pax=200)

    flag = booking_seen_by(people[Role.venue], hall["id"])["reassessment"]
    assert (flag["reason"], flag["change_request_id"]) == ("accepted_change", saved["id"])
    assert flag["problems"] == ["Capacity 150 is below the expected attendance of 200."]
    assert flag["message"].endswith("The booking is kept; it needs to be reassessed.")
    # The coordinator sees it on the event's booking too, and the booking stays approved.
    mine = booking_seen_by(people[Role.coordinator], hall["id"])
    assert (mine["status"], mine["reassessment"]["reason"]) == ("approved", "accepted_change")


def test_US49_AC2_a_new_time_that_clashes_with_another_event_is_flagged(people, approved_event, booked_event):
    event_id, hall = booked_event()
    # Gala Dinner has the same hall that afternoon, 15:00-17:00 (held from 14:30 with setup).
    gala_id = approved_event("Gala Dinner", "15:00", "17:00")
    book(people, {"id": hall["venue_id"]}, gala_id)

    saved = accept(people, event_id, start="14:00", end="16:00")

    problems = saved["venue_reassessment"]["bookings"][0]["problems"]
    assert problems[0] == "The booking holds 04 Jan 2027, 10:00–12:00, but the event moves to 04 Jan 2027, 14:00–16:00."
    assert problems[1].startswith("Clashes with Gala Dinner, already booked on 04 Jan 2027"), problems
    assert len(problems) == 2


# ---------------------------------------------------------------- AC3: Venue Staff told of each flagged booking

def test_US49_AC3_venue_staff_are_told_of_each_flagged_booking(people, venue, booked_event):
    event_id, hall = booked_event()
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

def test_US49_AC4_a_flagged_booking_blocks_confirmation_until_venue_staff_reassess_it(people, booked_event):
    event_id, hall = booked_event()
    assert people[Role.coordinator].post(f"/events/{event_id}/safety-check/request", json={}).status_code == 200
    assert people[Role.safety].post(f"/events/{event_id}/safety-check", json={"outcome": "approved", "comment": ""}).status_code == 200
    saved = accept(people, event_id, start="10:30")

    shown = people[Role.coordinator].get(f"/events/{event_id}/confirmation").json()
    assert shown["ready"] is False
    assert shown["outstanding"] == [f"The booking at Hall for Career Fair requires reassessment after change request #{saved['id']}: "
                                    "The booking holds 04 Jan 2027, 10:00–12:00, but the event moves to 04 Jan 2027, 10:30–12:00."]
    refused = people[Role.coordinator].post(f"/events/{event_id}/confirm", json={})
    assert refused.status_code == 409 and "requires reassessment" in refused.json()["detail"]

    assert resolve(people, hall["id"]).status_code == 200
    assert people[Role.coordinator].get(f"/events/{event_id}/confirmation").json()["ready"] is True
    assert people[Role.coordinator].post(f"/events/{event_id}/confirm", json={}).status_code == 200


def test_US49_AC4_replacing_the_venue_clears_the_flag(people, venue, booked_event):
    event_id, hall = booked_event(cap=150)
    accept(people, event_id, pax=200)
    # Priya books a bigger hall and cancels the flagged one.
    book(people, venue("Grand Hall", 400), event_id)
    assert people[Role.coordinator].post(f"/bookings/{hall['id']}/cancel", json={}).status_code == 200
    outstanding = people[Role.coordinator].get(f"/events/{event_id}/confirmation").json()["outstanding"]
    assert not any("requires reassessment" in item for item in outstanding), outstanding


# ---------------------------------------------------------------- resolving a flag

def test_US49_venue_staff_resolve_a_flag_the_outcome_is_kept_and_the_coordinator_told(people, booked_event):
    event_id, hall = booked_event(cap=150)
    accept(people, event_id, pax=200)

    res = resolve(people, hall["id"], note="Balcony seating opens for 60 more.")

    assert res.status_code == 200, res.text
    assert res.json()["reassessment"] is None
    row = people[Role.coordinator].get(f"/events/{event_id}/change-requests").json()[0]["venue_reassessment"]["bookings"][0]
    assert (row["outcome"], row["resolution"]["note"]) == ("still_valid", "Balcony seating opens for 60 more.")
    staff = get_user_name(people[Role.venue])
    assert ("Booking reassessed", f"Career Fair: {staff} reassessed the Hall for Career Fair booking for 2027-01-04 after the "
            "accepted change and found it still fits: \"Balcony seating opens for 60 more.\"") in notices(people[Role.coordinator])


def test_US49_only_venue_staff_resolve_and_a_note_is_required(people, booked_event):
    event_id, hall = booked_event(cap=150)
    accept(people, event_id, pax=200)
    for role in (Role.coordinator, Role.organiser, Role.tech, Role.safety):
        assert resolve(people, hall["id"], client=people[role]).status_code == 403
    assert resolve(people, hall["id"], note="  ").status_code == 409
    assert resolve(people, 99999).status_code == 404
    assert booking_seen_by(people[Role.venue], hall["id"])["reassessment"]["reason"] == "accepted_change"

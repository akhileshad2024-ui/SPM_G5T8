"""
US12 — Reassign Event Coordinator (Week 7 change CR-W7-5), through the API.

"As an Event Coordinator Lead, I want to reassign an event to another Event Coordinator so that
coordination can continue when staff availability or responsibilities change."

    POST /events/{id}/reassign      the Lead moves the event to another coordinator, with a reason
    GET  /events/{id}/assignments   the event's complete assignment history

Drives the real FastAPI app with real session cookies on a throwaway SQLite database (tests/conftest.py),
never Supabase. The rules on their own are in tests/unit/lead_assignment/test_us12_reassign_coordinator.py.
Criterion IDs (US12-AC1..AC5) are in the test names.
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import models
from auth_testkit import PASSWORD, get_user, login
from auth import security
from auth.models import Role, User
from main import app

REASON = "Priya is on leave for the next two weeks."


@pytest.fixture
def organiser(signed_in):
    return signed_in(Role.organiser)


@pytest.fixture
def priya(signed_in):
    return signed_in(Role.coordinator)


@pytest.fixture
def lead(signed_in):
    return signed_in(Role.lead)


@pytest.fixture
def marcus(db):
    """A second Event Coordinator, signed in."""
    db.add(User(email="marcus.lee@connectsphere.edu", name="Marcus Lee", role=Role.coordinator,
                password_hash=security.hash_password(PASSWORD), is_active=True, failed_login_attempts=0, session_version=0))
    db.commit()
    client = TestClient(app)
    assert login(client, "marcus.lee@connectsphere.edu").status_code == 200
    return client


def me(client):
    return client.get("/auth/me").json()


@pytest.fixture
def assigned(organiser, lead, priya):
    """make(name) -> the id of a request Maya submitted and the Lead assigned to Priya, now under review."""

    def make(name="Charity Gala"):
        future = (datetime.now(timezone.utc) + timedelta(days=30)).date().isoformat()
        res = organiser.post("/events", json={
            "submit": True, "name": name, "description": "US12 test.", "eventType": "Conference",
            "expectedAttendance": 120, "preferredDate": future, "startTime": "10:00", "endTime": "12:00",
            "venue": {"location": "Central campus", "capacity": 150, "layout": "theatre", "accessibility": [], "facilities": []},
            "equipment": [], "registration": {"required": False, "capacityLimit": None, "closingDate": None},
        })
        assert res.status_code == 201, res.text
        event_id = res.json()["id"]
        assert lead.post(f"/events/{event_id}/assign", json={"coordinatorId": me(priya)["id"]}).is_success
        assert priya.post(f"/events/{event_id}/review", json={}).is_success
        return event_id

    return make


def reassign(client, event_id, coordinator_id, reason=REASON):
    return client.post(f"/events/{event_id}/reassign", json={"coordinatorId": coordinator_id, "reason": reason})


def notices(client):
    res = client.get("/notifications")
    assert res.status_code == 200, res.text
    body = res.json()
    return [(n["title"], n["body"]) for n in (body["items"] if isinstance(body, dict) else body)]


def visible(client):
    return [e["name"] for e in client.get("/events").json()]


# ---------------------------------------------------------------- AC1: change the assigned coordinator

def test_US12_AC1_the_lead_reassigns_an_event_to_another_coordinator(assigned, lead, marcus):
    event_id = assigned()

    res = reassign(lead, event_id, me(marcus)["id"])

    assert res.status_code == 200, res.text
    assert (res.json()["coordinator"], res.json()["status"]) == ("Marcus Lee", "under_review")
    assert lead.get(f"/events/{event_id}").json()["coordinator"] == "Marcus Lee"  # saved


@pytest.mark.parametrize("who", ["priya", "organiser", "venue"])
def test_US12_AC1_only_the_lead_can_reassign(assigned, marcus, request, signed_in, who):
    event_id = assigned()
    client = signed_in(Role.venue) if who == "venue" else request.getfixturevalue(who)

    assert reassign(client, event_id, me(marcus)["id"]).status_code == 403


def test_US12_AC1_signed_out_users_get_401(assigned, marcus):
    event_id = assigned()

    assert reassign(TestClient(app), event_id, me(marcus)["id"]).status_code == 401


def test_US12_AC1_an_unassigned_event_is_assigned_not_reassigned(organiser, lead, marcus):
    future = (datetime.now(timezone.utc) + timedelta(days=30)).date().isoformat()
    event_id = organiser.post("/events", json={
        "submit": True, "name": "Open Day", "description": "x", "eventType": "Fair", "expectedAttendance": 50,
        "preferredDate": future, "startTime": "10:00", "endTime": "12:00",
        "venue": {"location": "Campus", "capacity": 60, "layout": "theatre", "accessibility": [], "facilities": []},
        "equipment": [], "registration": {"required": False, "capacityLimit": None, "closingDate": None},
    }).json()["id"]

    res = reassign(lead, event_id, me(marcus)["id"])

    assert (res.status_code, res.json()["detail"]) == (409, "This event has no coordinator yet. Assign one instead.")


def test_US12_AC1_a_non_coordinator_cannot_take_over(assigned, lead, organiser):
    event_id = assigned()

    res = reassign(lead, event_id, me(organiser)["id"])

    assert (res.status_code, res.json()["detail"]) == (422, "Maya Rahman is not an Event Coordinator.")


# ---------------------------------------------------------------- AC2: a reason is required

@pytest.mark.parametrize("reason", ["", "   "])
def test_US12_AC2_a_reassignment_without_a_reason_is_refused(assigned, lead, marcus, priya, reason):
    event_id = assigned()

    res = reassign(lead, event_id, me(marcus)["id"], reason)

    assert (res.status_code, res.json()["detail"]) == (422, "Reassignment reason is required.")
    assert lead.get(f"/events/{event_id}").json()["coordinator"] == "Priya Tan"  # nothing changed


def test_US12_AC2_a_missing_reason_field_is_refused_too(assigned, lead, marcus):
    event_id = assigned()

    res = lead.post(f"/events/{event_id}/reassign", json={"coordinatorId": me(marcus)["id"]})

    assert res.status_code == 422


# ---------------------------------------------------------------- AC3: access moves with the assignment

def test_US12_AC3_the_previous_coordinator_loses_access_and_the_new_one_gains_it(assigned, lead, priya, marcus):
    event_id = assigned()
    assert "Charity Gala" in visible(priya) and "Charity Gala" not in visible(marcus)

    reassign(lead, event_id, me(marcus)["id"])

    assert "Charity Gala" not in visible(priya)
    assert priya.get(f"/events/{event_id}").status_code == 403
    assert "Charity Gala" in visible(marcus)
    assert marcus.get(f"/events/{event_id}").status_code == 200


def test_US12_AC3_only_the_new_coordinator_can_continue_the_review(assigned, lead, priya, marcus):
    event_id = assigned()
    reassign(lead, event_id, me(marcus)["id"])

    assert priya.post(f"/events/{event_id}/decision", json={"outcome": "approved", "reason": ""}).status_code == 403
    res = marcus.post(f"/events/{event_id}/decision", json={"outcome": "approved", "reason": ""})
    assert (res.status_code, res.json()["status"]) == (200, "approved")


# ---------------------------------------------------------------- AC4: everyone affected is notified

def test_US12_AC4_outgoing_and_incoming_coordinators_and_the_organiser_are_notified(assigned, lead, priya, marcus, organiser):
    event_id = assigned()

    reassign(lead, event_id, me(marcus)["id"])

    assert ("Event reassigned",
            "Charity Gala: Grace Ong reassigned this event to another coordinator. You no longer manage it.") in notices(priya)
    assert ("Event assigned to you",
            "Charity Gala: Grace Ong reassigned this event to you. Open it from your queue to continue planning.") in notices(marcus)
    assert ("New coordinator", "Charity Gala: a new Event Coordinator is now handling your event.") in notices(organiser)


# ---------------------------------------------------------------- AC5: the complete assignment history

def test_US12_AC5_the_lead_sees_every_assignment_with_who_when_and_why(assigned, lead, priya, marcus):
    event_id = assigned()
    reassign(lead, event_id, me(marcus)["id"])
    reassign(lead, event_id, me(priya)["id"], "Back from leave.")

    res = lead.get(f"/events/{event_id}/assignments")

    assert res.status_code == 200, res.text
    rows = res.json()
    assert [(r["coordinator"], r["previousCoordinator"], r["assignedBy"], r["reason"]) for r in rows] == [
        ("Priya Tan", None, "Grace Ong", None),
        ("Marcus Lee", "Priya Tan", "Grace Ong", REASON),
        ("Priya Tan", "Marcus Lee", "Grace Ong", "Back from leave."),
    ]
    stamps = [datetime.fromisoformat(r["assignedAt"].replace("Z", "+00:00")) for r in rows]
    assert stamps == sorted(stamps) and all(s.tzinfo is not None for s in stamps)


def test_US12_AC5_someone_no_longer_involved_cannot_read_the_history(assigned, lead, priya, marcus):
    event_id = assigned()
    reassign(lead, event_id, me(marcus)["id"])

    assert priya.get(f"/events/{event_id}/assignments").status_code == 403
    assert TestClient(app).get(f"/events/{event_id}/assignments").status_code == 401
    assert lead.get("/events/9999/assignments").status_code == 404

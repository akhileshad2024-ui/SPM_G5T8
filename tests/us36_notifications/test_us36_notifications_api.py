"""
US36 — Receive Notifications, through the API (Week 7 changes CR-W7-5, CR-W7-6).

"As a user involved in an event, I want to receive notifications about significant decisions and changes
relevant to me so that I know when information changes or action is required."

Drives the real FastAPI app with real session cookies on a throwaway SQLite database (never Supabase).
Each workflow step is made the way users make it, then the recipient reads GET /notifications. The
criterion each test covers (US36-AC1..AC6, and the story whose "notify" criterion it delivers) is in its name.
AC7 (Safety Officer) waits on US44's role; its notices are tested in test_us36_notifications_unit.py.
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


def venue_body(name):
    return {
        "name": name, "location": f"{name} wing", "cap": 250, "layouts": ["theatre", "classroom"],
        "facilities": ["Projector"], "accessibility": ["Wheelchair Access"], "operatingHours": "08:00 - 22:00",
        "operatingDays": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], "setupMinutes": 30, "turnaroundMinutes": 45,
    }


def inbox(session):
    response = session.get("/notifications")
    assert response.status_code == 200, response.text
    return response.json()


def titles(session):
    return [n["title"] for n in inbox(session)]


@pytest.fixture
def organiser(signed_in):
    return signed_in(Role.organiser)


@pytest.fixture
def coordinator(signed_in):
    return signed_in(Role.coordinator)


@pytest.fixture
def lead(signed_in):
    return signed_in(Role.lead)


@pytest.fixture
def staff(signed_in):
    return signed_in(Role.venue)


@pytest.fixture
def second_staff(db):
    db.add(User(email="venue.two@connectsphere.edu", name="Venue Two", role=Role.venue,
                password_hash=security.hash_password(PASSWORD), is_active=True, failed_login_attempts=0, session_version=0))
    db.commit()
    session = TestClient(app)
    assert login(session, "venue.two@connectsphere.edu").status_code == 200
    return session


@pytest.fixture
def submitted(organiser):
    def make(name="Design Keynote"):
        response = organiser.post("/events", json={
            "submit": True, "name": name, "description": "US36 test.", "eventType": "Conference",
            "expectedAttendance": 100, "preferredDate": MON, "startTime": "10:00", "endTime": "12:00",
            "venue": {"location": "Campus", "capacity": 200, "layout": "theatre", "accessibility": [], "facilities": []},
            "equipment": [], "registration": {"required": False, "capacityLimit": None, "closingDate": None},
        })
        assert response.status_code == 201, response.text
        return response.json()["id"]
    return make


@pytest.fixture
def assigned(submitted, lead, db):
    def make(name="Design Keynote"):
        event_id = submitted(name)
        priya = get_user(db, Role.coordinator)
        assert lead.post(f"/events/{event_id}/assign", json={"coordinatorId": priya.id}).is_success
        return event_id
    return make


@pytest.fixture
def approved(assigned, coordinator):
    def make(name="Design Keynote"):
        event_id = assigned(name)
        assert coordinator.post(f"/events/{event_id}/review", json={}).is_success
        assert coordinator.post(f"/events/{event_id}/decision", json={"outcome": "approved", "reason": ""}).is_success
        return event_id
    return make


@pytest.fixture
def booked(approved, coordinator, staff):
    """make() -> (event_id, venue, booking): an approved event with a pending booking request."""
    def make(name="Design Keynote"):
        event_id = approved(name)
        venue = staff.post("/venues", json=venue_body("Lecture Theatre 1")).json()
        response = coordinator.post(f"/venues/{venue['id']}/booking-requests", json={"event_id": event_id})
        assert response.status_code == 200, response.text
        return event_id, venue, response.json()["booking"]
    return make


# ---------------------------------------------------------------- AC6 / US11: assignment

def test_US36_AC6_US11_AC4_assigned_coordinator_is_notified(assigned, coordinator, organiser, staff):
    assigned("Orientation Fair")
    notices = inbox(coordinator)
    assert [n["title"] for n in notices] == ["Event assigned to you"]
    assert "Grace Ong" in notices[0]["body"]
    assert "Event assigned to you" not in titles(organiser) + titles(staff)


# ---------------------------------------------------------------- AC1: review decisions reach the organiser

def test_US36_AC1_US08_AC4_organiser_is_notified_of_clarification(assigned, coordinator, organiser):
    event_id = assigned()
    coordinator.post(f"/events/{event_id}/review", json={})
    response = coordinator.post(f"/events/{event_id}/clarification",
                                json={"kind": "clarification", "message": "Please confirm the expected attendance."})
    assert response.is_success, response.text
    notice = inbox(organiser)[0]
    assert notice["title"] == "Clarification requested"
    assert "Please confirm the expected attendance." in notice["body"]


def test_US36_AC1_US10_AC5_organiser_is_notified_of_approval(approved, organiser):
    approved()
    assert "Event request approved" in titles(organiser)


def test_US36_AC1_US10_AC5_organiser_is_told_the_rejection_reason(assigned, coordinator, organiser):
    event_id = assigned()
    coordinator.post(f"/events/{event_id}/review", json={})
    coordinator.post(f"/events/{event_id}/decision", json={"outcome": "rejected", "reason": "The date clashes with exams."})
    notice = inbox(organiser)[0]
    assert notice["title"] == "Event request rejected"
    assert "The date clashes with exams." in notice["body"]


# ---------------------------------------------------------------- AC1: venue bookings

def test_US36_AC1_US22_AC4_every_venue_staff_member_is_notified_of_a_request(booked, staff, second_staff, coordinator):
    booked()
    assert "Booking request pending" in titles(staff)
    assert "Booking request pending" in titles(second_staff)
    assert "Booking request pending" not in titles(coordinator)


def test_US36_AC1_US23_AC5_coordinator_is_notified_of_booking_decision(booked, staff, coordinator):
    _, _, booking = booked()
    response = staff.post(f"/bookings/{booking['id']}/decision", json={"outcome": "rejected", "reason": "Closed for exams."})
    assert response.is_success, response.text
    notice = inbox(coordinator)[0]
    assert notice["title"] == "Venue booking rejected"
    assert "Closed for exams." in notice["body"]


def test_US36_AC1_US39_AC5_coordinator_is_notified_when_venue_becomes_unavailable(booked, staff, coordinator):
    _, venue, _ = booked()
    period = {"start": f"{MON}T00:00:00", "end": "2027-01-05T00:00:00", "reason": "maintenance", "note": "Rewiring"}
    assert staff.put(f"/venues/{venue['id']}", json={"unavailability": [period]}).is_success
    assert titles(coordinator).count("Replacement venue required") == 1
    # Saving the venue again with the same period does not flag (or notify) a second time.
    assert staff.put(f"/venues/{venue['id']}", json={"unavailability": [period], "cap": 240}).is_success
    assert titles(coordinator).count("Replacement venue required") == 1


def test_US36_AC1_US42_AC3_coordinator_is_warned_once_then_told_when_hold_expires(booked, coordinator, db):
    _, _, booking = booked()
    row = db.get(models.VenueBooking, booking["id"])
    row.hold_expires_at = datetime.now(timezone.utc) + timedelta(hours=2)
    db.commit()
    assert titles(coordinator).count("Venue hold expiring soon") == 1
    assert titles(coordinator).count("Venue hold expiring soon") == 1  # polling again does not repeat it
    db.expire_all()
    row = db.get(models.VenueBooking, booking["id"])
    row.hold_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()
    assert titles(coordinator).count("Venue hold expired") == 1
    assert titles(coordinator).count("Venue hold expired") == 1
    db.expire_all()
    assert db.get(models.VenueBooking, booking["id"]).status == "expired"


# ---------------------------------------------------------------- AC1: event changes

def test_US36_AC1_US16_AC3_significant_detail_change_notifies_the_organiser_not_the_editor(approved, coordinator, organiser):
    event_id = approved()
    response = coordinator.patch(f"/events/{event_id}/details", json={"pax": 90})
    assert response.is_success, response.text
    notice = inbox(organiser)[0]
    assert notice["title"] == "Event details changed"
    assert "expected attendance" in notice["body"]
    assert "Event details changed" not in titles(coordinator)


def test_US36_AC1_US16_AC3_ordinary_edit_without_arrangements_sends_nothing(approved, coordinator, organiser):
    event_id = approved()
    coordinator.patch(f"/events/{event_id}/details", json={"name": "Design Keynote 2027"})
    assert "Event details changed" not in titles(organiser)


def test_US36_AC1_US33_US34_change_request_reaches_coordinator_and_decision_reaches_organiser(approved, coordinator, organiser):
    event_id = approved()
    created = organiser.post(f"/events/{event_id}/change-requests", json={"proposed_changes": "Start at 14:00 instead."})
    assert created.status_code == 201, created.text
    notice = inbox(coordinator)[0]
    assert notice["title"] == "Change requested"
    assert "Start at 14:00 instead." in notice["body"]
    decided = coordinator.post(f"/events/{event_id}/change-requests/{created.json()['id']}/decision",
                               json={"outcome": "accepted", "reason": "Room is free then."})
    assert decided.is_success, decided.text
    notice = inbox(organiser)[0]
    assert notice["title"] == "Change request accepted"
    assert "Room is free then." in notice["body"]


# ---------------------------------------------------------------- AC1: the Lead's queue and clarification replies

def test_US36_AC1_US43_every_lead_is_told_a_new_request_is_waiting(submitted, lead, coordinator):
    submitted("Robotics Showcase")
    notice = inbox(lead)[0]
    assert notice["title"] == "New request to assign"
    assert notice["body"].startswith("Robotics Showcase:")
    assert "New request to assign" not in titles(coordinator)


def test_US36_AC1_US43_a_saved_draft_tells_nobody_until_it_is_submitted(organiser, lead):
    future = (datetime.now(timezone.utc) + timedelta(days=30)).date().isoformat()
    response = organiser.post("/events", json={
        "submit": False, "name": "Draft Fair", "description": "", "eventType": "", "expectedAttendance": None,
        "preferredDate": future, "startTime": "10:00", "endTime": "12:00",
        "venue": {"location": "", "capacity": None, "layout": "theatre", "accessibility": [], "facilities": []},
        "equipment": [], "registration": {"required": False, "capacityLimit": None, "closingDate": None},
    })
    assert response.status_code == 201, response.text
    assert inbox(lead) == []
    draft = response.json()
    body = {"submit": True, "name": "Draft Fair", "description": "Now complete.", "eventType": "Fair", "expectedAttendance": 50,
            "preferredDate": future, "startTime": "10:00", "endTime": "12:00",
            "venue": {"location": "Campus", "capacity": 60, "layout": "theatre", "accessibility": [], "facilities": []},
            "equipment": [], "registration": {"required": False, "capacityLimit": None, "closingDate": None}}
    assert organiser.put(f"/events/{draft['id']}", json=body).is_success
    assert titles(lead) == ["New request to assign"]


def test_US36_AC1_US09_AC3_coordinator_is_told_the_organiser_replied(assigned, coordinator, organiser):
    event_id = assigned()
    coordinator.post(f"/events/{event_id}/review", json={})
    coordinator.post(f"/events/{event_id}/clarification", json={"kind": "clarification", "message": "How many guests?"})
    response = organiser.post(f"/events/{event_id}/clarification-response", json={"message": "About 120 guests."})
    assert response.is_success, response.text
    notice = inbox(coordinator)[0]
    assert notice["title"] == "Clarification answered"
    assert "About 120 guests." in notice["body"]


# ---------------------------------------------------------------- AC2 / AC3 / AC4 / AC5: the inbox

def test_US36_AC2_each_notice_names_the_event_and_what_changed(assigned, coordinator):
    event_id = assigned("Orientation Fair")
    notice = inbox(coordinator)[0]
    assert notice["eventId"] == event_id
    assert notice["eventName"] == "Orientation Fair"
    assert notice["body"].startswith("Orientation Fair:")


def test_US36_AC3_user_marks_one_notice_read_and_the_rest_stay_unread(approved, organiser):
    approved("First")
    approved("Second")
    notices = inbox(organiser)
    assert len(notices) == 2 and not any(n["read"] for n in notices)
    assert organiser.post(f"/notifications/{notices[0]['id']}/read").is_success
    read = {n["id"]: n["read"] for n in inbox(organiser)}
    assert read == {notices[0]["id"]: True, notices[1]["id"]: False}


def test_US36_AC3_user_marks_all_read(approved, organiser):
    approved("First")
    approved("Second")
    assert organiser.post("/notifications/read").is_success
    assert all(n["read"] for n in inbox(organiser))


def test_US36_AC4_nobody_else_receives_or_can_read_the_notice(assigned, coordinator, signed_in):
    assigned()
    notice = inbox(coordinator)[0]
    for role in (Role.organiser, Role.tech, Role.attendee, Role.venue):
        other = signed_in(role)
        assert notice["id"] not in [n["id"] for n in inbox(other)]
        assert other.post(f"/notifications/{notice['id']}/read").status_code == 404


def test_US36_AC3_older_notifications_page_back_with_before(approved, organiser, monkeypatch):
    import messaging
    monkeypatch.setattr(messaging, "PAGE_SIZE", 2)
    for name in ("First", "Second", "Third"):
        approved(name)
    newest = inbox(organiser)
    assert [n["eventName"] for n in newest] == ["Third", "Second"]
    older = organiser.get(f"/notifications?before={newest[-1]['id']}").json()
    assert [n["eventName"] for n in older] == ["First"]


def test_US36_AC4_inbox_requires_sign_in(client):
    assert client.get("/notifications").status_code == 401


def test_US36_AC5_notice_is_saved_with_the_step_so_it_is_there_on_the_next_poll(assigned, coordinator):
    before = datetime.now(timezone.utc)
    assigned()
    created = datetime.fromisoformat(inbox(coordinator)[0]["createdAt"])
    assert created - before < timedelta(minutes=1)

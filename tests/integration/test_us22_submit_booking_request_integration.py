"""
Integration tests for US22 — Submit Venue Booking Request.

"As an Event Coordinator, I want to submit a venue booking request containing the event timing and
venue requirements so that Venue Staff can assess it."

These drive the real FastAPI app (backend/main.py) through TestClient — routing, login cookie,
validation, the SQL queries and the JSON columns together — against an in-memory SQLite database
instead of Supabase. Events are made the way users make them (the organiser submits, the coordinator
is assigned, reviews and approves), so the request is checked against a real saved event. The rules
themselves are unit tested in tests/unit/venue/test_us22_*.py; here the point is that they work through
the web layer and a real database, and that a booking is saved for the other users who need it.

Run by hand from the repo root (not part of the automated unit-test run):
    python -m unittest discover -s tests/integration -p "test_us22_*.py" -v
"""

import os
import sys
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

# Must be set before the backend is imported: database.py and security.py read these at import time.
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["JWT_SECRET"] = "test-secret-for-us17-unit-tests-only-0123456789"

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import models
import venue_bookings
from database import Base, get_db
from login.models import Role, User
from login.security import COOKIE_NAME, create_session_token
from main import app
from venue_availability import event_window, occupied_window, to_datetime


def a_monday_ahead(days=60) -> date:
    day = date.today() + timedelta(days=days)
    return day + timedelta(days=(7 - day.weekday()) % 7)


MON = "2027-01-04"  # a Monday
# A Monday far enough ahead to still be in the future whenever the tests are run (used where that matters).
DAY = a_monday_ahead()
COORDINATOR_EMAIL = "coordinator@connectsphere.edu"

THEATRE = {
    "name": "Lecture Theatre 1", "location": "North wing", "cap": 250,
    "layouts": ["theatre", "classroom"], "facilities": ["Projector", "PA system"],
    "accessibility": ["Wheelchair Access", "Special Physical Seating"],
    "operatingHours": "08:00 - 22:00", "operatingDays": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    "setupMinutes": 30, "turnaroundMinutes": 45,
}


class BookingApiTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(bind=self.engine)
        Session = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)

        def override_get_db():
            db = Session()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        self.db = Session()
        self.staff = self.client(Role.venue)
        self.coordinator = self.client(Role.coordinator)
        self.organiser = self.client(Role.organiser)
        self.venue = self.staff.post("/venues", json=THEATRE).json()

    def tearDown(self):
        self.db.close()
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=self.engine)
        self.engine.dispose()

    def client(self, role, email=None) -> TestClient:
        """A TestClient signed in with a real session cookie for a user with `role` (None = signed out)."""
        client = TestClient(app)
        if role is not None:
            email = email or f"{role.value}@connectsphere.edu"
            user = self.db.query(User).filter(User.email == email).first()
            if user is None:
                user = User(email=email, name=email.split("@")[0], role=role, password_hash="unused")
                self.db.add(user)
                self.db.commit()
                self.db.refresh(user)
            client.cookies.set(COOKIE_NAME, create_session_token(user))
        return client

    def make_event(self, name="Design Keynote", approve=True, coordinator=None, **fields) -> int:
        """An event the way users make it: submitted by the organiser, assigned, reviewed and (by default) approved."""
        body = {
            "submit": True, "name": name, "description": "Integration test event.", "eventType": "Conference",
            "expectedAttendance": 100, "preferredDate": MON, "startTime": "10:00", "endTime": "12:00",
            "venue": {"location": "Central campus", "capacity": 1000, "layout": "theatre", "accessibility": [], "facilities": []},
            "equipment": [], "registration": {"required": False, "capacityLimit": None, "closingDate": None},
        }
        body.update(fields)
        res = self.organiser.post("/events", json=body)
        self.assertEqual(res.status_code, 201, res.text)
        event_id = res.json()["id"]
        assignee = self.db.query(User).filter(User.email == COORDINATOR_EMAIL).first()
        self.assertTrue(self.coordinator.post(f"/events/{event_id}/assign", json={"coordinatorId": assignee.id}).is_success)
        self.assertTrue(self.coordinator.post(f"/events/{event_id}/review", json={}).is_success)
        if approve:
            self.assertTrue(self.coordinator.post(f"/events/{event_id}/decision", json={"outcome": "approved", "reason": ""}).is_success)
        return event_id

    def submit(self, event_id, client=None, venue_id=None, **body):
        return (client or self.coordinator).post(
            f"/venues/{venue_id or self.venue['id']}/booking-requests", json={"event_id": event_id, **body})

    def decide(self, booking_id, outcome, reason="", client=None):
        return (client or self.staff).post(f"/bookings/{booking_id}/decision", json={"outcome": outcome, "reason": reason})

    def event_as(self, client, event_id) -> dict:
        res = client.get(f"/events/{event_id}")
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    def flat_venue(self, name="Flat Hall", **fields) -> int:
        """A venue like the theatre but with no setup or turnaround time (unless given). Returns its id."""
        res = self.staff.post("/venues", json={**THEATRE, "name": name, "setupMinutes": 0, "turnaroundMinutes": 0, **fields})
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()["id"]

    def requested(self, name, start, end, venue_id=None, acknowledged=False, day=DAY) -> dict:
        """An approved event on `day` from `start` to `end` and its booking request. Returns the booking."""
        event_id = self.make_event(name, preferredDate=day.isoformat(), startTime=start, endTime=end)
        res = self.submit(event_id, venue_id=venue_id, acknowledged=acknowledged)
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()["booking"]

    def staff_view(self) -> dict:
        """What Venue Staff are sent: every booking they can see, by event name."""
        return {b["event_name"]: b for b in self.staff.get("/bookings").json()}

    def put_booking(self, event_id, venue_id, status="pending", **fields) -> models.VenueBooking:
        """A booking saved straight into the database for an event made through the API, whatever the rules would have
        allowed when it was made: a second pending request for the same time (two coordinators asking at the same
        moment), a hold that has expired, a booking that is already over."""
        event, venue = self.db.get(models.Event, event_id), self.db.get(models.Venue, venue_id)
        start, end = event.start_time.strftime("%H:%M"), event.end_time.strftime("%H:%M")
        hold = occupied_window(event_window(event.date, start, end), venue)
        values = dict(
            event_id=event.id, event_name=event.name, venue_id=venue.id, venue_name=venue.name, status=status, date=event.date,
            start_time=start, end_time=end, setup_minutes=venue.setupMinutes or 0, teardown_minutes=venue.turnaroundMinutes or 0,
            hold_start=to_datetime(hold[0]), hold_end=to_datetime(hold[1]), attendance=event.expected_attendance, layout=event.layout,
            verdict="suitable", requested_by=COORDINATOR_EMAIL, requested_at=datetime.now(timezone.utc),
        )
        values.update(fields)
        row = models.VenueBooking(**values)
        self.db.add(row)
        self.db.commit()
        venue_bookings.summarise(self.db, event)
        self.db.commit()
        return row


class TestSubmitThroughTheApi(BookingApiTestCase):
    def test_an_approved_event_gets_a_pending_booking_from_its_saved_details_and_a_notification_for_venue_staff(self):
        event_id = self.make_event()

        res = self.submit(event_id)

        self.assertEqual(res.status_code, 200, res.text)
        booking = res.json()["booking"]
        self.assertEqual((booking["status"], booking["verdict"], booking["override"]), ("pending", "suitable", None))
        self.assertEqual((booking["date"], booking["start"], booking["end"]), (MON, "10:00", "12:00"))
        self.assertEqual((booking["setup_minutes"], booking["teardown_minutes"]), (30, 45))
        self.assertEqual((booking["hold_start"], booking["hold_end"]), ("2027-01-04T09:30:00", "2027-01-04T12:45:00"))
        self.assertEqual((booking["attendance"], booking["layout"]), (100, "theatre"))
        self.assertEqual(booking["requested_by"], COORDINATOR_EMAIL)
        notification = res.json()["notification"]
        self.assertEqual((notification["to"], notification["title"]), ("venue", "Booking request pending"))
        self.assertIn("Lecture Theatre 1 requested for Design Keynote on 04 Jan 2027, 10:00–12:00", notification["body"])

    def test_the_booking_is_saved_for_the_coordinator_and_for_venue_staff(self):
        event_id = self.make_event()
        booking = self.submit(event_id).json()["booking"]

        # What each of them gets when they sign in (a fresh request each, as after a reload).
        for client in (self.coordinator, self.staff):
            listed = client.get("/bookings").json()
            self.assertEqual([(b["id"], b["status"], b["event_name"]) for b in listed], [(booking["id"], "pending", "Design Keynote")])
            event = self.event_as(client, event_id)
            self.assertEqual((event["venue"], event["venueName"], event["bookingState"]), (self.venue["id"], "Lecture Theatre 1", "pending"))

    def test_only_an_approved_event_can_ask_for_a_venue(self):
        under_review = self.make_event("Not Yet Approved", approve=False)

        res = self.submit(under_review)

        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()["detail"], "A venue can only be requested for an approved event (this event is under review).")
        self.assertEqual(self.coordinator.get("/bookings").json(), [])

    def test_a_second_pending_request_for_the_same_venue_and_time_is_refused(self):
        self.submit(self.make_event("Career Fair"))

        res = self.submit(self.make_event("Open House"))

        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()["detail"], "Lecture Theatre 1 already has a pending request for that period (Career Fair).")
        self.assertEqual(len(self.staff.get("/bookings").json()), 1)

    def test_only_the_coordinator_the_event_is_assigned_to_may_ask(self):
        event_id = self.make_event()
        other = self.client(Role.coordinator, "marcus.lee@connectsphere.edu")

        self.assertEqual(self.submit(event_id, client=other).status_code, 403)

    def test_an_unsuitable_venue_needs_the_warning_acknowledged_and_the_override_is_saved(self):
        event_id = self.make_event("Big Event", expectedAttendance=500)

        refused = self.submit(event_id)
        self.assertEqual(refused.status_code, 409)
        self.assertIn("Acknowledge the warning", refused.json()["detail"])
        allowed = self.submit(event_id, acknowledged=True)

        self.assertEqual(allowed.status_code, 200, allowed.text)
        override = allowed.json()["booking"]["override"]
        self.assertEqual((override["verdict"], override["acknowledged_by"]), ("unsuitable", COORDINATOR_EMAIL))
        self.assertEqual(override["unmet"][0]["reason"], "Capacity 250 is below the expected attendance of 500.")
        self.assertIn("The coordinator went ahead despite", allowed.json()["notification"]["body"])
        saved = self.coordinator.get("/bookings").json()[0]
        self.assertEqual(saved["override"]["acknowledged_by"], COORDINATOR_EMAIL)

    def test_a_deactivated_venue_cannot_be_requested(self):
        event_id = self.make_event()
        self.staff.put(f"/venues/{self.venue['id']}", json={"is_active": False})

        self.assertEqual(self.submit(event_id, acknowledged=True).status_code, 409)

    def test_an_unknown_venue_or_event_is_a_404(self):
        event_id = self.make_event()

        self.assertEqual(self.submit(event_id, venue_id=9999).status_code, 404)
        self.assertEqual(self.submit(9999).status_code, 404)

    def test_search_and_suitability_see_the_saved_booking_as_holding_the_venue(self):
        held = self.make_event("First Event")
        other = self.make_event("Second Event")
        self.submit(held)

        found = self.coordinator.post("/venues/search", json={"date": MON, "start": "10:00", "end": "12:00"}).json()
        suitability = self.coordinator.post("/venues/suitability", json={
            "attendance": 100, "layout": "theatre", "date": MON, "start": "10:00", "end": "12:00", "event_id": other}).json()
        own = self.coordinator.post("/venues/suitability", json={
            "attendance": 100, "layout": "theatre", "date": MON, "start": "10:00", "end": "12:00", "event_id": held}).json()

        self.assertEqual(found["venues"], [])
        self.assertEqual(suitability["results"][0]["verdict"], "unsuitable")
        self.assertEqual(own["results"][0]["verdict"], "suitable")  # its own booking isn't in its way


class TestVenueStaffDecision(BookingApiTestCase):
    def requested(self, name="Design Keynote"):
        event_id = self.make_event(name)
        return event_id, self.submit(event_id).json()["booking"]

    def test_venue_staff_approve_and_the_coordinator_sees_the_confirmed_venue(self):
        event_id, booking = self.requested()

        res = self.decide(booking["id"], "approved")

        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual((res.json()["status"], res.json()["decided_by"]), ("approved", "venue@connectsphere.edu"))
        self.assertEqual(self.event_as(self.coordinator, event_id)["bookingState"], "approved")
        self.assertEqual(self.coordinator.get("/bookings").json()[0]["status"], "approved")

    def test_rejecting_needs_a_reason_and_then_releases_the_venue(self):
        event_id, booking = self.requested("First Event")

        self.assertEqual(self.decide(booking["id"], "rejected").status_code, 409)
        rejected = self.decide(booking["id"], "rejected", "Held for setup that morning.")

        self.assertEqual((rejected.status_code, rejected.json()["status"]), (200, "rejected"))
        event = self.event_as(self.coordinator, event_id)
        self.assertEqual((event["venue"], event["bookingState"]), (None, "rejected"))
        # The slot is free again for another event.
        self.assertEqual(self.submit(self.make_event("Second Event")).status_code, 200)

    def test_a_clashing_request_cannot_be_approved(self):
        first_id, first = self.requested("Gala")
        self.decide(first["id"], "approved")
        second = self.submit(self.make_event("Fair"), acknowledged=True).json()["booking"]

        res = self.decide(second["id"], "approved")

        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()["detail"], "Can't approve: Clashes with Gala, already booked on 04 Jan 2027 (venue occupied 09:30–12:45 incl. 30 min setup and 45 min turnaround).")

    def test_only_venue_staff_can_decide_and_an_unknown_request_is_a_404(self):
        _, booking = self.requested()

        for role in (Role.organiser, Role.coordinator, Role.tech, Role.attendee):
            with self.subTest(role=role.value):
                self.assertEqual(self.decide(booking["id"], "approved", client=self.client(role)).status_code, 403)
        self.assertEqual(self.decide(9999, "approved").status_code, 404)
        self.assertEqual(self.decide(booking["id"], "maybe").status_code, 422)


class TestAccessAndValidation(BookingApiTestCase):
    def test_signed_out_users_get_401(self):
        event_id = self.make_event()

        self.assertEqual(self.submit(event_id, client=self.client(None)).status_code, 401)
        self.assertEqual(self.client(None).get("/bookings").status_code, 401)
        self.assertEqual(self.client(None).post("/bookings/1/decision", json={"outcome": "approved"}).status_code, 401)

    def test_only_event_coordinators_may_submit(self):
        event_id = self.make_event()
        for role in Role:
            with self.subTest(role=role.value):
                if role != Role.coordinator:
                    self.assertEqual(self.submit(event_id, client=self.client(role)).status_code, 403)

    def test_only_coordinators_and_venue_staff_may_list_bookings(self):
        for role in Role:
            with self.subTest(role=role.value):
                expected = 200 if role in (Role.coordinator, Role.venue) else 403
                self.assertEqual(self.client(role).get("/bookings").status_code, expected)

    def test_a_request_must_name_an_event(self):
        for body in ({}, {"event_id": "soon"}):
            with self.subTest(body=body):
                res = self.coordinator.post(f"/venues/{self.venue['id']}/booking-requests", json=body)
                self.assertEqual(res.status_code, 422)


if __name__ == "__main__":
    unittest.main()

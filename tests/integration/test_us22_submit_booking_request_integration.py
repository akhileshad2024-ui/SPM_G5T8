"""
Integration tests for US22 — Submit Venue Booking Request.

"As an Event Coordinator, I want to submit a venue booking request containing the event timing and
venue requirements so that Venue Staff can assess it."

These drive the real FastAPI app (backend/main.py) through TestClient — routing, login cookie,
validation, the database lookup and the JSON columns together — against an in-memory SQLite database
instead of Supabase. The rules themselves are unit tested in tests/unit/venue/test_us22_*.py;
here the point is that they work through the web layer and a real database.

Run by hand from the repo root (not part of the automated unit-test run):
    python -m unittest discover -s tests/integration -p "test_us22_*.py" -v
"""

import os
import sys
import unittest
from pathlib import Path

# Must be set before the backend is imported: database.py and security.py read these at import time.
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["JWT_SECRET"] = "test-secret-for-us17-unit-tests-only-0123456789"

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base, get_db
from login.models import Role, User
from login.security import COOKIE_NAME, create_session_token
from main import app

MON = "2027-01-04"  # a Monday

THEATRE = {
    "name": "Lecture Theatre 1", "location": "North wing", "cap": 250,
    "layouts": ["theatre", "classroom"], "facilities": ["Projector", "PA system"],
    "accessibility": ["Wheelchair Access", "Special Physical Seating"],
    "operatingHours": "08:00 - 22:00", "operatingDays": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    "setupMinutes": 30, "turnaroundMinutes": 45,
}
REQUEST = dict(event_id="EVT-2030", event_name="Design Week Keynote", event_status="approved",
               date=MON, start="10:00", end="12:00", attendance=100, layout="theatre")


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
        self.venue = self.staff.post("/venues", json=THEATRE).json()

    def tearDown(self):
        self.db.close()
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=self.engine)
        self.engine.dispose()

    def client(self, role) -> TestClient:
        """A TestClient signed in with a real session cookie for a user with `role` (None = signed out)."""
        client = TestClient(app)
        if role is not None:
            email = f"{role.value}@connectsphere.edu"
            user = self.db.query(User).filter(User.email == email).first()
            if user is None:
                user = User(email=email, name=role.value, role=role, password_hash="unused")
                self.db.add(user)
                self.db.commit()
                self.db.refresh(user)
            client.cookies.set(COOKIE_NAME, create_session_token(user))
        return client

    def submit(self, client=None, venue_id=None, **overrides):
        body = {**REQUEST, **overrides}
        return (client or self.coordinator).post(f"/venues/{venue_id or self.venue['id']}/booking-requests", json=body)


class TestSubmitThroughTheApi(BookingApiTestCase):
    def test_an_approved_event_gets_a_pending_booking_that_holds_the_venue_and_a_notification_for_venue_staff(self):
        res = self.submit()

        self.assertEqual(res.status_code, 200, res.text)
        booking = res.json()["booking"]
        self.assertEqual((booking["status"], booking["verdict"], booking["override"]), ("pending", "suitable", None))
        self.assertEqual((booking["date"], booking["start"], booking["end"]), (MON, "10:00", "12:00"))
        self.assertEqual((booking["setup_minutes"], booking["teardown_minutes"]), (30, 45))
        self.assertEqual((booking["hold_start"], booking["hold_end"]), ("2027-01-04T09:30:00", "2027-01-04T12:45:00"))
        self.assertEqual((booking["attendance"], booking["layout"]), (100, "theatre"))
        self.assertEqual(booking["requested_by"], "coordinator@connectsphere.edu")
        notification = res.json()["notification"]
        self.assertEqual((notification["to"], notification["title"]), ("venue", "Booking request pending"))
        self.assertIn("Lecture Theatre 1 requested for Design Week Keynote on 04 Jan 2027, 10:00–12:00", notification["body"])

    def test_only_an_approved_event_can_ask_for_a_venue(self):
        res = self.submit(event_status="draft")

        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()["detail"], "A venue can only be requested for an approved event (this event is draft).")

    def test_a_second_pending_request_for_the_same_venue_and_time_is_refused(self):
        held = [{"venue_id": self.venue["id"], "date": MON, "start": "11:00", "end": "13:00", "status": "pending",
                 "event_id": "EVT-9", "event_name": "Career Fair"}]

        res = self.submit(bookings=held)

        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()["detail"], "Lecture Theatre 1 already has a pending request for that period (Career Fair).")

    def test_the_booking_returned_by_one_request_blocks_the_next(self):
        first = self.submit().json()["booking"]
        held = [{"venue_id": first["venue_id"], "date": first["date"], "start": first["start"], "end": first["end"],
                 "status": first["status"], "event_id": first["event_id"], "event_name": first["event_name"]}]

        second = self.submit(event_id="EVT-2031", event_name="Open House", bookings=held)

        self.assertEqual(second.status_code, 409)
        self.assertIn("pending request", second.json()["detail"])

    def test_an_unsuitable_venue_needs_the_warning_acknowledged_and_the_override_is_returned(self):
        refused = self.submit(attendance=500)
        self.assertEqual(refused.status_code, 409)
        self.assertIn("Acknowledge the warning", refused.json()["detail"])

        allowed = self.submit(attendance=500, acknowledged=True)

        self.assertEqual(allowed.status_code, 200, allowed.text)
        override = allowed.json()["booking"]["override"]
        self.assertEqual((override["verdict"], override["acknowledged_by"]), ("unsuitable", "coordinator@connectsphere.edu"))
        self.assertEqual(override["unmet"][0]["reason"], "Capacity 250 is below the expected attendance of 500.")
        self.assertIn("The coordinator went ahead despite", allowed.json()["notification"]["body"])

    def test_a_deactivated_venue_cannot_be_requested(self):
        self.staff.put(f"/venues/{self.venue['id']}", json={"is_active": False})

        self.assertEqual(self.submit(acknowledged=True).status_code, 409)

    def test_an_unknown_venue_is_a_404(self):
        self.assertEqual(self.submit(venue_id=9999).status_code, 404)


class TestAccessAndValidation(BookingApiTestCase):
    def test_signed_out_users_get_401(self):
        self.assertEqual(self.submit(client=self.client(None)).status_code, 401)

    def test_only_event_coordinators_may_submit(self):
        for role in Role:
            with self.subTest(role=role.value):
                expected = 200 if role == Role.coordinator else 403
                self.assertEqual(self.submit(client=self.client(role)).status_code, expected)

    def test_incomplete_or_bad_requests_are_422(self):
        for field in ("event_id", "event_name", "event_status", "date", "start", "end", "attendance", "layout"):
            with self.subTest(missing=field):
                body = {k: v for k, v in REQUEST.items() if k != field}
                res = self.coordinator.post(f"/venues/{self.venue['id']}/booking-requests", json=body)
                self.assertEqual(res.status_code, 422)
        for name, change in {"attendance of 0": {"attendance": 0}, "end before start": {"start": "12:00", "end": "10:00"},
                             "unknown accessibility": {"accessibility": ["Step-free access"]}}.items():
            with self.subTest(bad=name):
                self.assertEqual(self.submit(**change).status_code, 422)


if __name__ == "__main__":
    unittest.main()

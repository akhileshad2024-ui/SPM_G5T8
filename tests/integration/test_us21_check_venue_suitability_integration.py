"""
Integration tests for US21 — Check Venue Suitability.

"As an Event Coordinator, I want to see whether a venue meets an event's requirements and why it
may be unsuitable so that I can avoid selecting an inappropriate venue."

These drive the real FastAPI app (backend/main.py) through TestClient — routing, login cookie,
validation, the SQL query and the JSON columns together — against an in-memory SQLite database
instead of Supabase. The rules themselves are unit tested in tests/unit/venue/test_us21_*.py;
here the point is that they work through the web layer and a real database.

Run by hand from the repo root (not part of the automated unit-test run):
    python -m unittest discover -s tests/integration -p "test_us21_*.py" -v
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
SEMINAR = {
    "name": "Seminar Room 2", "location": "South wing", "cap": 30,
    "layouts": ["boardroom"], "facilities": ["Whiteboard"], "accessibility": [],
    "operatingHours": "09:00 - 18:00", "operatingDays": ["Monday", "Tuesday"],
}
NEEDS = dict(attendance=100, layout="theatre", facilities=["Projector"], accessibility=["Wheelchair Access"],
             date=MON, start="10:00", end="12:00")


class SuitabilityApiTestCase(unittest.TestCase):
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

    def create_venue(self, **fields) -> dict:
        res = self.staff.post("/venues", json=fields)
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    def check(self, client=None, **body):
        return (client or self.coordinator).post("/venues/suitability", json=body)

    def results(self, **body) -> dict:
        """venue name -> its result."""
        res = self.check(**body)
        self.assertEqual(res.status_code, 200, res.text)
        return {r["venue"]["name"]: r for r in res.json()["results"]}


class TestSuitabilityThroughTheApi(SuitabilityApiTestCase):
    def setUp(self):
        super().setUp()
        self.theatre = self.create_venue(**THEATRE)
        self.seminar = self.create_venue(**SEMINAR)

    def test_each_venue_gets_a_verdict_and_the_unsuitable_one_says_why(self):
        found = self.results(**NEEDS)

        self.assertEqual(found["Lecture Theatre 1"]["verdict"], "suitable")
        small = found["Seminar Room 2"]
        self.assertEqual(small["verdict"], "unsuitable")
        reasons = [c["reason"] for c in small["checks"] if not c["met"]]
        self.assertIn("Capacity 30 is below the expected attendance of 100.", reasons)
        self.assertIn("Does not support a theatre layout.", reasons)
        self.assertIn("Projector is not available at this venue.", reasons)
        self.assertIn("Wheelchair Access is not provided at this venue.", reasons)

    def test_the_checks_compare_every_recorded_need_with_what_the_venue_offers(self):
        checks = self.results(**NEEDS)["Lecture Theatre 1"]["checks"]

        self.assertEqual([c["key"] for c in checks], ["capacity", "layout", "facility", "accessibility", "availability"])
        self.assertEqual((checks[0]["needed"], checks[0]["offered"]), ("100 people", "250 people"))
        self.assertTrue(all(c["met"] for c in checks))

    def test_a_missing_facility_makes_a_venue_partially_suitable(self):
        found = self.results(**{**NEEDS, "facilities": ["Projector", "Stage"]})

        self.assertEqual(found["Lecture Theatre 1"]["verdict"], "partially_suitable")

    def test_availability_reasons_come_from_what_venue_staff_saved(self):
        period = {"start": "2027-01-04T10:00", "end": "2027-01-04T12:00", "reason": "maintenance", "note": "Rewiring"}
        self.staff.put(f"/venues/{self.theatre['id']}", json={"unavailability": [period]})

        theatre = self.results(**NEEDS)["Lecture Theatre 1"]

        self.assertEqual(theatre["verdict"], "unsuitable")
        self.assertIn("is unavailable (Maintenance: Rewiring)", [c["reason"] for c in theatre["checks"] if not c["met"]][0])

    def test_a_held_booking_makes_a_clash(self):
        held = [{"venue_id": self.theatre["id"], "date": MON, "start": "10:00", "end": "12:00",
                 "status": "pending", "event_name": "Career Fair"}]

        theatre = self.results(**NEEDS, bookings=held)["Lecture Theatre 1"]

        self.assertEqual(theatre["verdict"], "unsuitable")
        self.assertTrue(any("Clashes with Career Fair, already requested" in (c["reason"] or "") for c in theatre["checks"]))

    def test_venue_ids_limit_which_venues_are_assessed_and_deactivated_ones_are_left_out(self):
        self.assertEqual(list(self.results(**NEEDS, venue_ids=[self.seminar["id"]])), ["Seminar Room 2"])

        self.staff.put(f"/venues/{self.theatre['id']}", json={"is_active": False})

        self.assertEqual(list(self.results(**NEEDS)), ["Seminar Room 2"])


class TestAccessAndValidation(SuitabilityApiTestCase):
    def test_signed_out_users_get_401(self):
        self.assertEqual(self.check(client=self.client(None), attendance=10).status_code, 401)

    def test_only_event_coordinators_may_check_suitability(self):
        for role in Role:
            with self.subTest(role=role.value):
                expected = 200 if role == Role.coordinator else 403
                self.assertEqual(self.check(client=self.client(role), attendance=10).status_code, expected)

    def test_bad_requests_are_422(self):
        bad = {
            "no attendance": {},
            "attendance of 0": {"attendance": 0},
            "unknown accessibility": {"attendance": 10, "accessibility": ["Step-free access"]},
            "date without times": {"attendance": 10, "date": MON},
            "end before start": {"attendance": 10, "date": MON, "start": "12:00", "end": "10:00"},
        }
        for name, body in bad.items():
            with self.subTest(request=name):
                self.assertEqual(self.check(**body).status_code, 422)

    def test_the_suitability_route_does_not_get_mistaken_for_a_venue_id(self):
        self.assertEqual(self.coordinator.get("/venues/suitability").status_code, 422)  # GET /venues/{id} with a non-number


if __name__ == "__main__":
    unittest.main()

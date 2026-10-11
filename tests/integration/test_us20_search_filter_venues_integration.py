"""
Integration tests for US20 — Search and Filter Venues.

"As an Event Coordinator, I want to search and filter venues by event timing, attendance,
location, accessibility, layout, and facilities so that I can find suitable options
efficiently."

These drive the real FastAPI app (backend/main.py) through TestClient — routing, login cookie,
validation, the SQL query and the JSON columns together — against an in-memory SQLite database
instead of Supabase. The rules themselves are unit tested in tests/unit/venue/test_us20_*.py;
here the point is that they work through the web layer and a real database.

Run by hand from the repo root (not part of the automated unit-test run):
    python -m unittest discover -s tests/integration -p "test_us20_*.py" -v
"""

import os
import sys
import time
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

import models
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


class SearchApiTestCase(unittest.TestCase):
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

    def search(self, client=None, **body):
        return (client or self.coordinator).post("/venues/search", json=body)

    def names(self, **body) -> list:
        res = self.search(**body)
        self.assertEqual(res.status_code, 200, res.text)
        return [v["name"] for v in res.json()["venues"]]


class TestSearchThroughTheApi(SearchApiTestCase):
    def setUp(self):
        super().setUp()
        self.theatre = self.create_venue(**THEATRE)
        self.seminar = self.create_venue(**SEMINAR)

    def test_no_filters_returns_every_active_venue_with_its_full_details(self):
        res = self.search()

        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual((body["total"], body["applied_filters"], body["message"]), (2, [], None))
        self.assertEqual(body["venues"][0]["id"], self.theatre["id"])
        self.assertEqual(body["venues"][0]["accessibility"], ["Wheelchair Access", "Special Physical Seating"])

    def test_each_requirement_filters_the_venues_stored_in_the_database(self):
        cases = {
            "attendance": ({"attendance": 100}, ["Lecture Theatre 1"]),
            "location": ({"location": "south wing"}, ["Seminar Room 2"]),
            "layout": ({"layout": "Boardroom"}, ["Seminar Room 2"]),
            "facilities": ({"facilities": ["projector", "pa system"]}, ["Lecture Theatre 1"]),
            "accessibility": ({"accessibility": ["Special Physical Seating"]}, ["Lecture Theatre 1"]),
        }
        for name, (body, expected) in cases.items():
            with self.subTest(filter=name):
                self.assertEqual(self.names(**body), expected)

    def test_several_filters_must_all_match(self):
        self.assertEqual(self.names(attendance=20, layout="theatre", facilities=["Projector"]), ["Lecture Theatre 1"])
        self.assertEqual(self.names(attendance=20, layout="boardroom", facilities=["Projector"]), [])

    def test_a_deactivated_venue_is_not_returned(self):
        self.staff.put(f"/venues/{self.theatre['id']}", json={"is_active": False})

        self.assertEqual(self.names(), ["Seminar Room 2"])

    def test_no_match_gives_a_message_and_lists_the_filters(self):
        body = self.search(attendance=1000, location="North wing").json()

        self.assertEqual((body["venues"], body["total"]), ([], 0))
        self.assertEqual(body["message"], "No venues match the filters applied.")
        self.assertEqual([(f["key"], f["value"]) for f in body["applied_filters"]], [("attendance", "1000"), ("location", "North wing")])


class TestFreeForThePeriodThroughTheApi(SearchApiTestCase):
    def setUp(self):
        super().setUp()
        self.venue = self.create_venue(**THEATRE)

    def period(self, start, end, **extra):
        return self.names(date=MON, start=start, end=end, **extra)

    def test_a_venue_is_free_when_nothing_is_in_the_way(self):
        self.assertEqual(self.period("10:00", "12:00"), ["Lecture Theatre 1"])

    def test_a_venue_closed_that_day_or_at_that_hour_is_left_out(self):
        self.assertEqual(self.names(date="2027-01-09", start="10:00", end="12:00"), [])  # a Saturday
        self.assertEqual(self.period("06:00", "08:00"), [])

    def test_an_unavailability_period_saved_by_venue_staff_blocks_the_search(self):
        period = {"start": "2027-01-04T10:00", "end": "2027-01-04T12:00", "reason": "maintenance"}
        self.staff.put(f"/venues/{self.venue['id']}", json={"unavailability": [period]})

        self.assertEqual(self.period("10:30", "11:30"), [])
        self.assertEqual(self.period("12:30", "14:00"), ["Lecture Theatre 1"])  # setup of 30 min starts as it ends
        self.assertEqual(self.period("12:29", "14:00"), [])

    def test_a_held_booking_blocks_the_search_with_the_venues_setup_and_turnaround(self):
        held = [{"venue_id": self.venue["id"], "date": MON, "start": "10:00", "end": "12:00"}]  # busy 09:30-12:45

        self.assertEqual(self.period("13:15", "15:00", bookings=held), ["Lecture Theatre 1"])
        self.assertEqual(self.period("13:14", "15:00", bookings=held), [])


class TestAccessAndValidation(SearchApiTestCase):
    def test_signed_out_users_get_401(self):
        self.assertEqual(self.search(client=self.client(None)).status_code, 401)

    def test_only_event_coordinators_may_search(self):
        for role in Role:
            with self.subTest(role=role.value):
                expected = 200 if role == Role.coordinator else 403
                self.assertEqual(self.search(client=self.client(role)).status_code, expected)

    def test_bad_searches_are_422(self):
        bad = {
            "attendance of 0": {"attendance": 0},
            "date without times": {"date": MON},
            "end before start": {"date": MON, "start": "12:00", "end": "10:00"},
            "unknown accessibility": {"accessibility": ["Step-free access"]},
            "not a time": {"date": MON, "start": "ten", "end": "12:00"},
        }
        for name, body in bad.items():
            with self.subTest(search=name):
                self.assertEqual(self.search(**body).status_code, 422)

    def test_the_search_route_does_not_get_mistaken_for_a_venue_id(self):
        self.assertEqual(self.coordinator.get("/venues/search").status_code, 422)  # GET /venues/{id} with a non-number
        self.assertEqual(self.search().status_code, 200)


class TestSearchSpeed(SearchApiTestCase):
    def test_searching_a_large_catalogue_through_the_api_takes_under_3_seconds(self):
        self.db.add_all([
            models.Venue(
                name=f"Room {i}", location=f"Block {i % 40}", cap=20 + i % 500, layouts=["theatre"],
                facilities=["Projector"], accessibility=["Wheelchair Access"], operatingHours="08:00 - 22:00",
                operatingDays=["Monday"], unavailability=[], setupMinutes=15, turnaroundMinutes=15,
                is_active=True, last_updated_by="seed@connectsphere.edu",
            )
            for i in range(1000)
        ])
        self.db.commit()
        held = [{"venue_id": i, "date": MON, "start": "09:00", "end": "10:00"} for i in range(1, 1001, 2)]  # every other venue

        started = time.perf_counter()
        res = self.search(date=MON, start="10:00", end="12:00", attendance=50, layout="theatre",
                          facilities=["Projector"], accessibility=["Wheelchair Access"], bookings=held)
        elapsed = time.perf_counter() - started

        self.assertEqual(res.status_code, 200, res.text)
        self.assertLess(elapsed, 3.0)
        self.assertTrue(0 < res.json()["total"] < 1000)  # real filtering happened, not an empty or trivial answer


if __name__ == "__main__":
    unittest.main()

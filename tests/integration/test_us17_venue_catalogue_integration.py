"""
Integration tests for US17 — Maintain Venue Catalogue.

"As a Venue Staff member, I want to maintain venue details such as capacity,
location, facilities, accessibility, and supported layouts so that planning
decisions use accurate venue information."

The tests drive the real FastAPI app (backend/main.py) through TestClient —
routing, auth, validation and the database layer together — but swap the
Supabase database for an in-memory SQLite one, so they never touch shared data.
Users sign in with a real session cookie, so RBAC is exercised exactly as in
production.

Run from the repo root:
    python -m unittest discover -s tests/integration -p "test_us17_*.py" -v
"""

import os
import sys
import unittest
from datetime import datetime
from pathlib import Path

# Must be set before the backend is imported: database.py and security.py read
# these at import time (load_dotenv doesn't override variables already set).
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

VENUE_STAFF_EMAIL = "daniel.ortiz@connectsphere.edu"
OTHER_STAFF_EMAIL = "venue.two@connectsphere.edu"
OTHER_ROLES = (Role.organiser, Role.coordinator, Role.tech, Role.attendee)

VALID_VENUE = {
    "name": "Lecture Theatre 1",
    "building": "School of Computing, Level 1",
    "cap": 250,
    "layouts": ["theatre", "classroom"],
    "facilities": ["Projector", "PA System", "Wi-Fi"],
    "accessibility": ["Wheelchair access", "Hearing loop"],
    "operatingHours": "08:00 - 22:00",
    "operatingDays": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    "unavailability": [{"start": "2026-12-25T00:00:00", "end": "2026-12-26T00:00:00", "reason": "maintenance", "note": "Annual rewiring"}],
    "setupMinutes": 30,
    "turnaroundMinutes": 45,
}

PERIOD = {"start": "2027-01-10T08:00:00", "end": "2027-01-12T18:00:00", "reason": "renovation", "note": "Re-flooring"}


def parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)


class VenueApiTestCase(unittest.TestCase):
    """Fresh in-memory database per test, plus helpers to sign in and create venues."""

    def setUp(self):
        # StaticPool keeps one connection so the in-memory DB survives across requests.
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
        self.staff = self.client(Role.venue, VENUE_STAFF_EMAIL)

    def tearDown(self):
        self.db.close()
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=self.engine)
        self.engine.dispose()

    def client(self, role, email=None) -> TestClient:
        """A TestClient signed in as a user with `role` (None = signed out)."""
        client = TestClient(app)
        if role is None:
            return client
        email = email or f"{role.value}@connectsphere.edu"
        user = self.db.query(User).filter(User.email == email).first()
        if user is None:
            user = User(email=email, name=email.split("@")[0], role=role, password_hash="unused")
            self.db.add(user)
            self.db.commit()
            self.db.refresh(user)
        client.cookies.set(COOKIE_NAME, create_session_token(user))
        return client

    def create_venue(self, **overrides) -> dict:
        res = self.staff.post("/venues", json={**VALID_VENUE, **overrides})
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    def history(self, venue_id, client=None) -> list:
        res = (client or self.staff).get(f"/venues/{venue_id}/history")
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    def listed(self) -> list:
        return self.staff.get("/venues").json()

    def assertRejected(self, res, field=None):
        """422 validation error, naming `field` if given."""
        self.assertEqual(res.status_code, 422, res.text)
        if field:
            self.assertTrue(any(err["loc"][-1] == field for err in res.json()["detail"]), res.text)


# ---------------------------------------------------------------- AC1: create, edit, deactivate

class TestCreateEditDeactivate(VenueApiTestCase):
    def test_venue_staff_can_create_venue(self):
        res = self.staff.post("/venues", json=VALID_VENUE)

        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertGreater(body["id"], 0)
        self.assertEqual(body["name"], VALID_VENUE["name"])
        self.assertIs(body["is_active"], True)

    def test_created_venue_appears_in_catalogue(self):
        venue = self.create_venue()

        res = self.staff.get("/venues")
        self.assertEqual(res.status_code, 200)
        self.assertEqual([v["id"] for v in res.json()], [venue["id"]])

    def test_venue_staff_can_edit_venue(self):
        venue = self.create_venue()
        res = self.staff.put(f"/venues/{venue['id']}", json={"name": "LT1 (Renovated)", "cap": 300})

        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["name"], "LT1 (Renovated)")
        self.assertEqual(res.json()["cap"], 300)

    def test_partial_edit_leaves_other_fields_unchanged(self):
        venue = self.create_venue()
        body = self.staff.put(f"/venues/{venue['id']}", json={"cap": 120}).json()

        self.assertEqual(body["cap"], 120)
        for field in ("name", "building", "layouts", "facilities", "accessibility"):
            self.assertEqual(body[field], venue[field], field)

    def test_venue_staff_can_deactivate_venue(self):
        venue = self.create_venue()
        res = self.staff.put(f"/venues/{venue['id']}", json={"is_active": False})

        self.assertEqual(res.status_code, 200)
        self.assertIs(res.json()["is_active"], False)

    def test_deactivated_venue_is_hidden_from_catalogue(self):
        venue = self.create_venue()
        self.staff.put(f"/venues/{venue['id']}", json={"is_active": False})

        self.assertEqual(self.listed(), [])

    def test_deactivated_venue_can_be_reactivated(self):
        venue = self.create_venue()
        self.staff.put(f"/venues/{venue['id']}", json={"is_active": False})
        res = self.staff.put(f"/venues/{venue['id']}", json={"is_active": True})

        self.assertIs(res.json()["is_active"], True)
        self.assertEqual(len(self.listed()), 1)

    def test_editing_unknown_venue_returns_404(self):
        self.assertEqual(self.staff.put("/venues/9999", json={"name": "Ghost"}).status_code, 404)

    def test_other_roles_cannot_create_venue(self):
        for role in OTHER_ROLES:
            with self.subTest(role=role.value):
                self.assertEqual(self.client(role).post("/venues", json=VALID_VENUE).status_code, 403)

    def test_other_roles_cannot_edit_or_deactivate_venue(self):
        venue = self.create_venue()
        for role in OTHER_ROLES:
            with self.subTest(role=role.value):
                client = self.client(role)
                self.assertEqual(client.put(f"/venues/{venue['id']}", json={"cap": 1}).status_code, 403)
                self.assertEqual(client.put(f"/venues/{venue['id']}", json={"is_active": False}).status_code, 403)

    def test_other_roles_can_still_view_catalogue(self):
        self.create_venue()
        for role in OTHER_ROLES:
            with self.subTest(role=role.value):
                res = self.client(role).get("/venues")
                self.assertEqual(res.status_code, 200)
                self.assertEqual(len(res.json()), 1)

    def test_signed_out_user_cannot_create_or_view(self):
        client = self.client(None)

        self.assertEqual(client.post("/venues", json=VALID_VENUE).status_code, 401)
        self.assertEqual(client.get("/venues").status_code, 401)


# ---------------------------------------------------------------- AC2: record venue details

class TestRecordVenueDetails(VenueApiTestCase):
    def test_all_details_are_stored_on_create(self):
        venue = self.create_venue()

        for field, value in VALID_VENUE.items():
            self.assertEqual(venue[field], value, field)

    def test_details_persist_in_database(self):
        stored = self.db.get(models.Venue, self.create_venue()["id"])

        self.assertEqual(stored.cap, VALID_VENUE["cap"])
        self.assertEqual(stored.building, VALID_VENUE["building"])
        self.assertEqual(stored.facilities, VALID_VENUE["facilities"])
        self.assertEqual(stored.accessibility, VALID_VENUE["accessibility"])
        self.assertEqual(stored.layouts, VALID_VENUE["layouts"])

    def test_each_detail_can_be_updated(self):
        venue = self.create_venue()
        changes = {
            "cap": 80,
            "building": "Engineering Block E2",
            "facilities": ["Whiteboard"],
            "accessibility": ["Ramp", "Accessible toilet"],
            "layouts": ["banquet", "u-shape", "cocktail"],
        }
        res = self.staff.put(f"/venues/{venue['id']}", json=changes)

        self.assertEqual(res.status_code, 200)
        for field, value in changes.items():
            self.assertEqual(res.json()[field], value, field)

    def test_list_fields_can_be_cleared(self):
        venue = self.create_venue()
        body = self.staff.put(f"/venues/{venue['id']}", json={"facilities": [], "accessibility": []}).json()

        self.assertEqual(body["facilities"], [])
        self.assertEqual(body["accessibility"], [])

    def test_optional_lists_default_to_empty(self):
        res = self.staff.post("/venues", json={"name": "Seminar Room 3", "building": "COM2", "cap": 30})

        self.assertEqual(res.status_code, 200)
        for field in ("layouts", "facilities", "accessibility"):
            self.assertEqual(res.json()[field], [], field)


# ---------------------------------------------------------------- AC3: validation errors

class TestValidation(VenueApiTestCase):
    def test_non_positive_capacity_rejected_on_create(self):
        for cap in (0, -1):
            with self.subTest(cap=cap):
                self.assertRejected(self.staff.post("/venues", json={**VALID_VENUE, "cap": cap}), "cap")

    def test_capacity_of_one_accepted(self):
        self.assertEqual(self.create_venue(cap=1)["cap"], 1)

    def test_non_positive_capacity_rejected_on_edit(self):
        venue = self.create_venue()
        for cap in (0, -1):
            with self.subTest(cap=cap):
                self.assertRejected(self.staff.put(f"/venues/{venue['id']}", json={"cap": cap}))
                self.assertEqual(self.listed()[0]["cap"], VALID_VENUE["cap"])

    def test_non_integer_capacity_rejected(self):
        for cap in ("lots", 12.5, None):
            with self.subTest(cap=cap):
                self.assertRejected(self.staff.post("/venues", json={**VALID_VENUE, "cap": cap}))

    def test_missing_required_field_rejected(self):
        for field in ("name", "building", "cap"):
            with self.subTest(field=field):
                payload = {k: v for k, v in VALID_VENUE.items() if k != field}
                self.assertRejected(self.staff.post("/venues", json=payload), field)

    def test_blank_text_field_rejected(self):
        for field in ("name", "building"):
            with self.subTest(field=field):
                self.assertRejected(self.staff.post("/venues", json={**VALID_VENUE, field: "   "}))

    def test_list_field_must_be_a_list(self):
        for field in ("layouts", "facilities", "accessibility"):
            with self.subTest(field=field):
                self.assertRejected(self.staff.post("/venues", json={**VALID_VENUE, field: "Projector"}))

    def test_invalid_create_does_not_save_anything(self):
        self.staff.post("/venues", json={**VALID_VENUE, "cap": 0})

        self.assertEqual(self.db.query(models.Venue).count(), 0)


# ---------------------------------------------------------------- AC4: no delete, only deactivate

class TestNoDelete(VenueApiTestCase):
    def test_venue_cannot_be_deleted(self):
        res = self.staff.delete(f"/venues/{self.create_venue()['id']}")

        self.assertEqual(res.status_code, 409)
        self.assertIn("Deactivate", res.json()["detail"])

    def test_delete_attempt_leaves_record_in_database(self):
        venue = self.create_venue()
        self.staff.delete(f"/venues/{venue['id']}")

        self.assertIsNotNone(self.db.get(models.Venue, venue["id"]))

    def test_delete_attempt_is_not_recorded_as_a_change(self):
        venue = self.create_venue()
        self.staff.delete(f"/venues/{venue['id']}")

        self.assertEqual(len(self.history(venue["id"])), 1)

    def test_deactivation_keeps_record_instead_of_removing_it(self):
        venue = self.create_venue()
        self.staff.put(f"/venues/{venue['id']}", json={"is_active": False})

        stored = self.db.get(models.Venue, venue["id"])
        self.assertIsNotNone(stored)
        self.assertIs(stored.is_active, False)

    def test_unknown_venue_returns_404(self):
        self.assertEqual(self.staff.delete("/venues/9999").status_code, 404)

    def test_other_roles_get_403(self):
        venue = self.create_venue()
        for role in OTHER_ROLES:
            with self.subTest(role=role.value):
                self.assertEqual(self.client(role).delete(f"/venues/{venue['id']}").status_code, 403)

    def test_signed_out_gets_401(self):
        self.assertEqual(self.client(None).delete(f"/venues/{self.create_venue()['id']}").status_code, 401)


# ---------------------------------------------------------------- AC5: audit (editor + timestamp)

class TestAuditTrail(VenueApiTestCase):
    def test_create_records_editing_user_and_timestamp(self):
        venue = self.create_venue()

        self.assertEqual(venue["last_updated_by"], VENUE_STAFF_EMAIL)
        parse_ts(venue["last_updated_at"])  # must be a valid timestamp

    def test_edit_and_deactivation_record_the_user_who_made_them(self):
        venue = self.create_venue()
        other = self.client(Role.venue, OTHER_STAFF_EMAIL)
        for change in ({"cap": 99}, {"is_active": False}):
            with self.subTest(change=change):
                self.assertEqual(other.put(f"/venues/{venue['id']}", json=change).json()["last_updated_by"], OTHER_STAFF_EMAIL)

    def test_each_successive_edit_moves_timestamp_forward(self):
        venue = self.create_venue()
        stamps = [parse_ts(venue["last_updated_at"])]
        for cap in (10, 20, 30):
            stamps.append(parse_ts(self.staff.put(f"/venues/{venue['id']}", json={"cap": cap}).json()["last_updated_at"]))

        self.assertEqual(stamps, sorted(stamps))
        self.assertEqual(len(set(stamps)), len(stamps))

    def test_editor_cannot_be_spoofed(self):
        venue = self.create_venue(last_updated_by="someone.else@evil.com")
        edited = self.staff.put(f"/venues/{venue['id']}", json={"cap": 50, "last_updated_by": "someone.else@evil.com"}).json()

        self.assertEqual(venue["last_updated_by"], VENUE_STAFF_EMAIL)
        self.assertEqual(edited["last_updated_by"], VENUE_STAFF_EMAIL)


class TestChangeHistory(VenueApiTestCase):
    def test_create_is_recorded(self):
        venue = self.create_venue()
        entries = self.history(venue["id"])

        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["action"], "create")
        self.assertEqual(entries[0]["changed_by"], VENUE_STAFF_EMAIL)
        self.assertEqual(entries[0]["changes"]["cap"], {"old": None, "new": VALID_VENUE["cap"]})
        self.assertEqual(parse_ts(entries[0]["changed_at"]), parse_ts(venue["last_updated_at"]))

    def test_every_change_is_kept_in_order_with_its_user(self):
        vid = self.create_venue()["id"]
        third = "venue.three@connectsphere.edu"
        self.client(Role.venue, OTHER_STAFF_EMAIL).put(f"/venues/{vid}", json={"cap": 300})
        self.client(Role.venue, third).put(f"/venues/{vid}", json={"is_active": False})
        self.staff.put(f"/venues/{vid}", json={"is_active": True})

        entries = self.history(vid)
        self.assertEqual([(e["action"], e["changed_by"]) for e in entries], [
            ("create", VENUE_STAFF_EMAIL),
            ("edit", OTHER_STAFF_EMAIL),
            ("deactivate", third),
            ("reactivate", VENUE_STAFF_EMAIL),
        ])
        stamps = [parse_ts(e["changed_at"]) for e in entries]
        self.assertEqual(stamps, sorted(stamps))
        self.assertEqual(len(set(stamps)), len(stamps))

    def test_edit_records_only_changed_fields_with_old_and_new_values(self):
        venue = self.create_venue()
        res = self.staff.put(f"/venues/{venue['id']}", json={"name": VALID_VENUE["name"], "cap": 300, "facilities": ["Whiteboard"]})

        entry = self.history(venue["id"])[-1]
        self.assertEqual(entry["changes"], {
            "cap": {"old": VALID_VENUE["cap"], "new": 300},
            "facilities": {"old": VALID_VENUE["facilities"], "new": ["Whiteboard"]},
        })
        self.assertEqual(entry["changed_by"], res.json()["last_updated_by"])
        self.assertEqual(parse_ts(entry["changed_at"]), parse_ts(res.json()["last_updated_at"]))

    def test_history_of_deactivated_venue_is_still_viewable(self):
        venue = self.create_venue()
        self.staff.put(f"/venues/{venue['id']}", json={"is_active": False})

        entries = self.history(venue["id"])
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[-1]["changes"]["is_active"], {"old": True, "new": False})

    def test_no_op_edit_records_nothing(self):
        venue = self.create_venue()
        other = self.client(Role.venue, OTHER_STAFF_EMAIL)
        res = other.put(f"/venues/{venue['id']}", json={"cap": VALID_VENUE["cap"]})

        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["last_updated_by"], VENUE_STAFF_EMAIL)
        self.assertEqual(res.json()["last_updated_at"], venue["last_updated_at"])
        self.assertEqual(len(self.history(venue["id"])), 1)

    def test_rejected_or_forbidden_edits_record_nothing(self):
        venue = self.create_venue()
        self.staff.put(f"/venues/{venue['id']}", json={"cap": 0})
        self.staff.put(f"/venues/{venue['id']}", json={"name": "   "})
        for role in OTHER_ROLES:
            self.client(role).put(f"/venues/{venue['id']}", json={"cap": 1})

        self.assertEqual(len(self.history(venue["id"])), 1)

    def test_rejected_create_records_nothing(self):
        self.staff.post("/venues", json={**VALID_VENUE, "cap": -1})

        self.assertEqual(self.db.query(models.VenueChange).count(), 0)

    def test_history_is_stored_in_database(self):
        venue = self.create_venue()
        self.staff.put(f"/venues/{venue['id']}", json={"cap": 42})

        rows = self.db.query(models.VenueChange).filter_by(venue_id=venue["id"]).all()
        self.assertEqual([r.action for r in rows], ["create", "edit"])

    def test_history_of_unknown_venue_returns_404(self):
        self.assertEqual(self.staff.get("/venues/9999/history").status_code, 404)

    def test_only_venue_staff_can_view_history(self):
        vid = self.create_venue()["id"]
        for role in OTHER_ROLES:
            with self.subTest(role=role.value):
                self.assertEqual(self.client(role).get(f"/venues/{vid}/history").status_code, 403)
        self.assertEqual(self.client(None).get(f"/venues/{vid}/history").status_code, 401)


# ---------------------------------------------------------------- Week 7 #1: setup and turnaround time

class TestSetupAndTurnaround(VenueApiTestCase):
    def test_setup_and_turnaround_are_stored(self):
        venue = self.create_venue()

        self.assertEqual((venue["setupMinutes"], venue["turnaroundMinutes"]), (30, 45))
        stored = self.db.get(models.Venue, venue["id"])
        self.assertEqual((stored.setupMinutes, stored.turnaroundMinutes), (30, 45))

    def test_default_to_zero_when_not_given(self):
        body = self.staff.post("/venues", json={"name": "Room", "building": "COM1", "cap": 10}).json()

        self.assertEqual((body["setupMinutes"], body["turnaroundMinutes"]), (0, 0))

    def test_boundaries(self):
        for field in ("setupMinutes", "turnaroundMinutes"):
            for value, status in ((0, 200), (1440, 200), (-1, 422), (1441, 422)):
                with self.subTest(field=field, value=value):
                    self.assertEqual(self.staff.post("/venues", json={**VALID_VENUE, field: value}).status_code, status)

    def test_negative_value_rejected_on_edit(self):
        venue = self.create_venue()
        for field in ("setupMinutes", "turnaroundMinutes"):
            with self.subTest(field=field):
                self.assertRejected(self.staff.put(f"/venues/{venue['id']}", json={field: -1}))
                self.assertEqual(self.listed()[0][field], venue[field])

    def test_change_is_editable_and_recorded_in_history(self):
        venue = self.create_venue()
        body = self.staff.put(f"/venues/{venue['id']}", json={"turnaroundMinutes": 90}).json()

        self.assertEqual(body["turnaroundMinutes"], 90)
        self.assertEqual(self.history(venue["id"])[-1]["changes"], {"turnaroundMinutes": {"old": 45, "new": 90}})


# ---------------------------------------------------------------- operating hours and days

class TestOperatingInformation(VenueApiTestCase):
    def test_hours_are_normalised(self):
        self.assertEqual(self.create_venue(operatingHours=" 08:00  -  22:00 ")["operatingHours"], "08:00 - 22:00")

    def test_bad_hours_rejected(self):
        for raw in ("banana", "08:00 - 24:00", "10:00 - 10:00"):
            with self.subTest(raw=raw):
                self.assertRejected(self.staff.post("/venues", json={**VALID_VENUE, "operatingHours": raw}))

    def test_bad_hours_rejected_on_edit(self):
        venue = self.create_venue()

        self.assertRejected(self.staff.put(f"/venues/{venue['id']}", json={"operatingHours": "22:00 - 08:00"}))

    def test_hours_can_be_cleared(self):
        venue = self.create_venue()
        res = self.staff.put(f"/venues/{venue['id']}", json={"operatingHours": None})

        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.json()["operatingHours"])

    def test_days_are_put_in_week_order_without_repeats(self):
        venue = self.create_venue(operatingDays=["sunday", "Monday", "MONDAY", "Wednesday"])

        self.assertEqual(venue["operatingDays"], ["Monday", "Wednesday", "Sunday"])

    def test_bad_days_rejected(self):
        for days in ([], ["Mon"]):
            with self.subTest(days=days):
                self.assertRejected(self.staff.post("/venues", json={**VALID_VENUE, "operatingDays": days}))

    def test_days_default_to_weekdays(self):
        body = self.staff.post("/venues", json={"name": "Room", "building": "COM1", "cap": 10}).json()

        self.assertEqual(body["operatingDays"], ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"])

    def test_days_can_be_edited_and_partial_edits_keep_them(self):
        venue = self.create_venue()

        self.assertEqual(self.staff.put(f"/venues/{venue['id']}", json={"cap": 99}).json()["operatingDays"], VALID_VENUE["operatingDays"])
        self.assertEqual(
            self.staff.put(f"/venues/{venue['id']}", json={"operatingDays": ["Saturday", "Sunday"]}).json()["operatingDays"],
            ["Saturday", "Sunday"],
        )


# ---------------------------------------------------------------- Week 7 #2: unavailability periods

class TestUnavailability(VenueApiTestCase):
    def test_period_is_stored_with_reason(self):
        self.assertEqual(self.create_venue()["unavailability"], VALID_VENUE["unavailability"])

    def test_invalid_periods_rejected(self):
        cases = {
            "unknown reason": {**PERIOD, "reason": "felt like it"},
            "other without note": {**PERIOD, "reason": "other", "note": "  "},
            "end equals start": {**PERIOD, "end": PERIOD["start"]},
            "start missing": {k: v for k, v in PERIOD.items() if k != "start"},
        }
        for name, period in cases.items():
            with self.subTest(case=name):
                self.assertRejected(self.staff.post("/venues", json={**VALID_VENUE, "unavailability": [period]}))

    def test_bad_period_rejected_on_edit(self):
        venue = self.create_venue()

        self.assertRejected(self.staff.put(f"/venues/{venue['id']}", json={"unavailability": [{**PERIOD, "reason": "nope"}]}))
        self.assertEqual(self.listed()[0]["unavailability"], VALID_VENUE["unavailability"])

    def test_periods_can_be_replaced_and_cleared(self):
        vid = self.create_venue()["id"]

        self.assertEqual(self.staff.put(f"/venues/{vid}", json={"unavailability": [PERIOD]}).json()["unavailability"], [PERIOD])
        self.assertEqual(self.staff.put(f"/venues/{vid}", json={"unavailability": []}).json()["unavailability"], [])

    def test_change_is_recorded_in_history(self):
        venue = self.create_venue()
        self.staff.put(f"/venues/{venue['id']}", json={"unavailability": [PERIOD]})

        self.assertEqual(
            self.history(venue["id"])[-1]["changes"]["unavailability"],
            {"old": VALID_VENUE["unavailability"], "new": [PERIOD]},
        )


# ---------------------------------------------------------------- list clean-up and explicit nulls

class TestNormalisationAndNulls(VenueApiTestCase):
    def test_lists_are_cleaned_up(self):
        venue = self.create_venue(layouts=["Theatre", "theatre", " Banquet "], facilities=["Projector", "projector"])

        self.assertEqual(venue["layouts"], ["theatre", "banquet"])
        self.assertEqual(venue["facilities"], ["Projector"])

    def test_null_for_required_field_is_a_validation_error(self):
        venue = self.create_venue()
        for field in ("name", "cap", "layouts", "is_active"):  # one of each kind of field
            with self.subTest(field=field):
                res = self.staff.put(f"/venues/{venue['id']}", json={field: None})
                self.assertRejected(res)
                self.assertIn(field, res.text)
                self.assertEqual(self.listed()[0][field], venue[field])


# ---------------------------------------------------------------- deactivated venues stay visible to staff

class TestInactiveVenues(VenueApiTestCase):
    def setUp(self):
        super().setUp()
        self.venue = self.create_venue()
        self.staff.put(f"/venues/{self.venue['id']}", json={"is_active": False})

    def test_staff_and_coordinators_can_list_deactivated(self):
        for role in (Role.venue, Role.coordinator):
            with self.subTest(role=role.value):
                res = self.client(role).get("/venues", params={"include_inactive": "true"})
                self.assertEqual(res.status_code, 200)
                self.assertEqual([(v["id"], v["is_active"]) for v in res.json()], [(self.venue["id"], False)])

    def test_other_roles_cannot_list_deactivated(self):
        for role in (Role.organiser, Role.tech, Role.attendee):
            with self.subTest(role=role.value):
                self.assertEqual(self.client(role).get("/venues", params={"include_inactive": "true"}).status_code, 403)

    def test_default_list_still_hides_deactivated(self):
        self.assertEqual(self.listed(), [])


if __name__ == "__main__":
    unittest.main()

"""
Unit tests for US17 — Maintain Venue Catalogue: the venue endpoint functions in
backend/main.py, called directly (no web server, no real database). A MagicMock
stands in for the database session, so each test checks only what the function
decides and what it asks the database to do.

AC1: can create, edit and deactivate venue records; cannot delete (only deactivate)
(Listing and viewing venues is US18; see test_us18_view_venue_details.py.)
AC5: has each change recorded with the editing user and a timestamp
RBAC: only Venue Staff may change or view the history of venues

What these tests cannot show (a mock database does not run SQL, and calling a function
directly skips the web layer): that the SQL really filters by id, and that a request
without a login cookie gets a 401. Those are checked by the integration tests.

Run from the repo root:
    python -m unittest discover -s tests/unit/venue -p "test_us17_*.py" -v
"""

import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

# main.py builds the database engine when imported, so point it at in-memory SQLite
# first. The real Supabase database is never touched.
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["JWT_SECRET"] = "test-secret-for-us17-unit-tests-only-0123456789"
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "backend"))

from fastapi import HTTPException

import main
import models
import schemas
from login.models import Role
from login.security import require_roles

EDITOR = SimpleNamespace(email="daniel.ortiz@connectsphere.edu", role=Role.venue)

NEW_VENUE = {
    "name": "Lecture Theatre 1",
    "location": "North wing",
    "cap": 150,
    "layouts": ["theatre"],
    "facilities": ["Projector"],
    "accessibility": ["Wheelchair Access"],
    "operatingHours": "08:00 - 22:00",
    "operatingDays": ["Monday", "Tuesday"],
    "unavailability": [{"start": "2027-01-10T08:00", "end": "2027-01-11T08:00", "reason": "maintenance"}],
    "setupMinutes": 30,
    "turnaroundMinutes": 45,
}


def make_venue(**overrides) -> models.Venue:
    """A venue as it would be loaded from the database (never saved anywhere)."""
    fields = dict(
        id=7, name="Lecture Theatre 1", location="North wing", cap=150,
        layouts=["theatre"], facilities=["Projector"], accessibility=["Wheelchair Access"],
        operatingHours="08:00 - 22:00", operatingDays=["Monday", "Tuesday"],
        unavailability=[], setupMinutes=30, turnaroundMinutes=45, is_active=True,
        last_updated_by="someone.before@connectsphere.edu",
        last_updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    fields.update(overrides)
    return models.Venue(**fields)


def db_returning(venue=None) -> MagicMock:
    """A fake session where the venue lookups (by id) find `venue`, or nothing if None."""
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = venue
    db.get.return_value = venue
    return db


def added_objects(db) -> list:
    return [c.args[0] for c in db.add.call_args_list]


def audit_row(db) -> models.VenueChange:
    rows = [o for o in added_objects(db) if isinstance(o, models.VenueChange)]
    assert len(rows) == 1, f"expected exactly one audit row, got {len(rows)}"
    return rows[0]


# ---------------------------------------------------------------- RBAC: who may do what

class TestRoleRules(unittest.TestCase):
    def test_only_venue_staff_pass_the_venue_management_check(self):
        check = require_roles(*main.VENUE_MANAGERS)
        for role in Role:
            with self.subTest(role=role.value):
                user = SimpleNamespace(role=role)
                if role == Role.venue:
                    self.assertIs(check(user=user), user)
                else:
                    with self.assertRaises(HTTPException) as ctx:
                        check(user=user)
                    self.assertEqual(ctx.exception.status_code, 403)

    def test_endpoints_are_protected_by_the_checks_above(self):
        def dependencies(method, path):
            route = next(r for r in main.app.routes if getattr(r, "path", None) == path and method in r.methods)
            return [d.call for d in route.dependant.dependencies]

        management = [("POST", "/venues"), ("PUT", "/venues/{venue_id}"),
                      ("DELETE", "/venues/{venue_id}"), ("GET", "/venues/{venue_id}/history")]
        for method, path in management:
            with self.subTest(route=f"{method} {path}"):
                names = [d.__qualname__ for d in dependencies(method, path)]
                self.assertIn("require_roles.<locals>.dependency", names)


# ---------------------------------------------------------------- AC1 + AC5: creating a venue

class TestCreateVenue(unittest.TestCase):
    def setUp(self):
        self.db = MagicMock()
        # flush() is what gives a new row its id, which the audit row needs.
        self.db.flush.side_effect = lambda: setattr(added_objects(self.db)[0], "id", 42)
        before = datetime.now(timezone.utc)
        self.venue = main.create_venue(schemas.VenueCreate(**NEW_VENUE), db=self.db, user=EDITOR)
        self.after = datetime.now(timezone.utc)
        self.before = before

    def test_new_venue_has_the_details_given_and_the_editor_and_time(self):
        self.assertEqual((self.venue.name, self.venue.cap, self.venue.setupMinutes), ("Lecture Theatre 1", 150, 30))
        self.assertEqual(self.venue.unavailability[0]["reason"], "maintenance")
        self.assertEqual(self.venue.last_updated_by, EDITOR.email)
        self.assertTrue(self.before <= self.venue.last_updated_at <= self.after)

    def test_creation_is_recorded_and_saved_in_the_right_order(self):
        row = audit_row(self.db)

        self.assertEqual((row.venue_id, row.action, row.changed_by), (42, "create", EDITOR.email))
        self.assertEqual(row.changed_at, self.venue.last_updated_at)
        self.assertEqual(row.changes["cap"], {"old": None, "new": 150})
        self.assertEqual([c[0] for c in self.db.method_calls], ["add", "flush", "add", "commit", "refresh"])
        self.db.refresh.assert_called_once_with(self.venue)


# ---------------------------------------------------------------- AC1 + AC5: editing and deactivating

class TestUpdateVenue(unittest.TestCase):
    def test_unknown_venue_is_a_404_and_nothing_is_saved(self):
        db = db_returning(None)

        with self.assertRaises(HTTPException) as ctx:
            main.update_venue(9999, schemas.VenueUpdate(cap=300), db=db, user=EDITOR)

        self.assertEqual(ctx.exception.status_code, 404)
        db.add.assert_not_called()
        db.commit.assert_not_called()

    def test_edit_changes_the_venue_and_records_who_what_and_when(self):
        venue = make_venue()
        db = db_returning(venue)

        result = main.update_venue(7, schemas.VenueUpdate(cap=300), db=db, user=EDITOR)

        self.assertIs(result, venue)
        self.assertEqual(venue.cap, 300)
        row = audit_row(db)
        self.assertEqual((row.venue_id, row.action, row.changed_by), (7, "edit", EDITOR.email))
        self.assertEqual(row.changes, {"cap": {"old": 150, "new": 300}})
        self.assertEqual((venue.last_updated_by, venue.last_updated_at), (EDITOR.email, row.changed_at))
        db.commit.assert_called_once()
        db.refresh.assert_called_once_with(venue)

    def test_edit_that_changes_nothing_saves_and_records_nothing(self):
        venue = make_venue()
        db = db_returning(venue)

        result = main.update_venue(7, schemas.VenueUpdate(cap=150), db=db, user=EDITOR)

        self.assertIs(result, venue)
        self.assertEqual(venue.last_updated_by, "someone.before@connectsphere.edu")
        db.add.assert_not_called()
        db.commit.assert_not_called()

    def test_deactivating_and_reactivating_are_recorded_as_such(self):
        for was_active, now_active, action in ((True, False, "deactivate"), (False, True, "reactivate")):
            with self.subTest(action=action):
                venue = make_venue(is_active=was_active)
                db = db_returning(venue)

                main.update_venue(7, schemas.VenueUpdate(is_active=now_active), db=db, user=EDITOR)

                self.assertIs(venue.is_active, now_active)
                self.assertEqual(audit_row(db).action, action)


# ---------------------------------------------------------------- AC1: venues are never deleted

class TestDeleteVenue(unittest.TestCase):
    def test_unknown_venue_is_a_404(self):
        with self.assertRaises(HTTPException) as ctx:
            main.delete_venue(9999, db=db_returning(None), _user=EDITOR)

        self.assertEqual(ctx.exception.status_code, 404)

    def test_existing_venue_is_refused_with_a_409_and_nothing_is_removed(self):
        db = db_returning(make_venue())

        with self.assertRaises(HTTPException) as ctx:
            main.delete_venue(7, db=db, _user=EDITOR)

        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("Deactivate", ctx.exception.detail)
        db.delete.assert_not_called()
        db.commit.assert_not_called()


# ---------------------------------------------------------------- AC5: reading the change history

class TestVenueHistory(unittest.TestCase):
    def test_unknown_venue_is_a_404(self):
        with self.assertRaises(HTTPException) as ctx:
            main.get_venue_history(9999, db=db_returning(None), _user=EDITOR)

        self.assertEqual(ctx.exception.status_code, 404)

    def test_changes_come_back_oldest_first(self):
        rows = [models.VenueChange(id=1), models.VenueChange(id=2)]
        db = db_returning(make_venue())
        ordered = db.query.return_value.filter.return_value.order_by
        ordered.return_value.all.return_value = rows

        result = main.get_venue_history(7, db=db, _user=EDITOR)

        self.assertEqual(result, rows)
        self.assertEqual([str(a) for a in ordered.call_args.args], ["VenueChange.changed_at", "VenueChange.id"])


if __name__ == "__main__":
    unittest.main()

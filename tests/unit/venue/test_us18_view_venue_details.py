"""
Unit tests for US18 — View Venue Details.

"As an Event Coordinator, I want to view venue details so that I can understand the
available venue options."

AC1: can view the full details of any active venue ........ TestGetVenueDetails
AC2: sees capacity, location, facilities, accessibility, layouts ..... TestDetailsShown
AC3: read-only view with no editing controls ............. TestReadOnly, plus the Venue
     Staff-only checks in test_us17_venue_endpoints.py (a coordinator gets a 403 on every
     create/edit/delete route, so the backend cannot be used to edit either)
AC4: deactivated venues excluded from the list ........... TestVenueList

The endpoint functions in backend/main.py are called directly with a MagicMock standing in
for the database session, so these tests check what each function decides and asks the
database to do. They cannot show that the SQL really finds a venue by id, or that a request
without a login gets a 401; the integration tests check those.

Run from the repo root:
    python -m unittest discover -s tests/unit/venue -p "test_us18_*.py" -v
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
REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "backend"))

from fastapi import HTTPException

import main
import models
import schemas
from login.models import Role
from login.security import get_current_user

COORDINATOR = SimpleNamespace(email="priya.tan@connectsphere.edu", role=Role.coordinator)


def make_venue(**overrides) -> models.Venue:
    """A venue as it would be loaded from the database (never saved anywhere)."""
    fields = dict(
        id=7, name="Lecture Theatre 1", location="North wing", cap=150,
        layouts=["theatre", "classroom"], facilities=["Projector", "PA system"],
        accessibility=["Wheelchair Access", "Special Physical Seating"],
        operatingHours="08:00 - 22:00", operatingDays=["Monday", "Tuesday"],
        unavailability=[], setupMinutes=30, turnaroundMinutes=45, is_active=True,
        last_updated_by="daniel.ortiz@connectsphere.edu",
        last_updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    fields.update(overrides)
    return models.Venue(**fields)


def route_dependencies(method, path):
    route = next(r for r in main.app.routes if getattr(r, "path", None) == path and method in r.methods)
    return [d.call for d in route.dependant.dependencies]


# ---------------------------------------------------------------- AC1: full details of one active venue

class TestGetVenueDetails(unittest.TestCase):
    def test_an_active_venue_is_returned_in_full(self):
        venue = make_venue()
        db = MagicMock()
        query = db.query.return_value.filter

        query.return_value.first.return_value = venue
        result = main.get_venue(7, db=db, _user=COORDINATOR)

        self.assertIs(result, venue)
        conditions = [str(c) for c in query.call_args.args]
        self.assertEqual(len(conditions), 2)  # the id, and "must be active"
        self.assertEqual(conditions[1], str(models.Venue.is_active == True))

    def test_an_unknown_or_deactivated_venue_is_a_404(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None  # nothing active matches

        with self.assertRaises(HTTPException) as ctx:
            main.get_venue(9999, db=db, _user=COORDINATOR)

        self.assertEqual(ctx.exception.status_code, 404)
        self.assertEqual(ctx.exception.detail, "Venue not found")

    def test_any_signed_in_user_may_view_venues_but_a_login_is_required(self):
        for method, path in (("GET", "/venues"), ("GET", "/venues/{venue_id}")):
            with self.subTest(route=f"{method} {path}"):
                calls = route_dependencies(method, path)
                self.assertIn(get_current_user, calls)  # must be signed in
                self.assertNotIn("require_roles.<locals>.dependency", [c.__qualname__ for c in calls])  # but any role


# ---------------------------------------------------------------- AC2: which details are shown

class TestDetailsShown(unittest.TestCase):
    def test_the_response_carries_capacity_location_facilities_accessibility_and_layouts(self):
        details = schemas.VenueResponse.model_validate(make_venue()).model_dump()

        self.assertEqual(details["cap"], 150)
        self.assertEqual(details["location"], "North wing")
        self.assertEqual(details["facilities"], ["Projector", "PA system"])
        self.assertEqual(details["accessibility"], ["Wheelchair Access", "Special Physical Seating"])
        self.assertEqual(details["layouts"], ["theatre", "classroom"])


# ---------------------------------------------------------------- AC3: nothing in the coordinator's view edits a venue

class TestReadOnly(unittest.TestCase):
    """The pages a coordinator uses to view venues must not contain anything that changes one.

    This reads the source of the two frontend files, since a Python test cannot click through
    a browser. It is a guard against someone adding an edit control later, not a full UI test.
    """

    FILES = ("components/venues/VenueDetails.tsx", "app/(dashboard)/venues/page.tsx")
    EDIT_CONTROLS = ("<input", "<textarea", "<select", "<form", "VenueForm", 'method: "PUT"', 'method: "POST"',
                     'method: "DELETE"', "saveVenue", "setVenueActive")

    def test_the_venue_view_has_no_editing_controls(self):
        for relative in self.FILES:
            source = (REPO / relative).read_text(encoding="utf-8")
            for control in self.EDIT_CONTROLS:
                with self.subTest(file=relative, control=control):
                    self.assertNotIn(control, source)


# ---------------------------------------------------------------- AC4: deactivated venues are left out of the list

class TestVenueList(unittest.TestCase):
    def test_default_list_has_only_active_venues_in_id_order(self):
        rows = [make_venue(id=1), make_venue(id=2)]
        db = MagicMock()
        query = db.query.return_value.filter.return_value
        query.order_by.return_value.all.return_value = rows

        result = main.get_venues(include_inactive=False, db=db, user=COORDINATOR)

        self.assertEqual(result, rows)
        db.query.return_value.filter.assert_called_once()
        self.assertEqual(str(db.query.return_value.filter.call_args.args[0]), str(models.Venue.is_active == True))
        self.assertEqual([str(a) for a in query.order_by.call_args.args], ["Venue.id"])

    def test_staff_and_coordinators_can_ask_to_include_deactivated_venues(self):
        rows = [make_venue(id=1, is_active=False)]
        for role in (Role.venue, Role.coordinator):
            with self.subTest(role=role.value):
                db = MagicMock()
                db.query.return_value.order_by.return_value.all.return_value = rows

                result = main.get_venues(include_inactive=True, db=db, user=SimpleNamespace(role=role))

                self.assertEqual(result, rows)
                db.query.return_value.filter.assert_not_called()  # no "active only" filter

    def test_other_roles_are_refused_deactivated_venues(self):
        for role in (Role.organiser, Role.tech, Role.attendee):
            with self.subTest(role=role.value):
                db = MagicMock()

                with self.assertRaises(HTTPException) as ctx:
                    main.get_venues(include_inactive=True, db=db, user=SimpleNamespace(role=role))

                self.assertEqual(ctx.exception.status_code, 403)
                db.query.return_value.order_by.return_value.all.assert_not_called()  # nothing was fetched


if __name__ == "__main__":
    unittest.main()

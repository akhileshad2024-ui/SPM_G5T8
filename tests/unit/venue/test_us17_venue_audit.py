"""
Unit tests for US17 — Maintain Venue Catalogue: recording each change
(backend/venue_audit.py).
Plain objects stand in for the database; no API is involved.

AC1: can create, edit and deactivate venue records
AC5: has each change recorded with the editing user and a timestamp

Run from the repo root:
    python -m unittest discover -s tests/unit/venue -p "test_us17_*.py" -v
"""

import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

# backend/ must be importable. database.py and login/security.py read these at
# import time; no connection is ever opened, so in-memory SQLite is enough.
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("JWT_SECRET", "test-secret-for-us17-unit-tests-only-0123456789")
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "backend"))

import models
from venue_audit import AUDITED_FIELDS, apply_update, change_action, creation_changes, record_change

NOW = datetime(2026, 10, 3, 9, 30, tzinfo=timezone.utc)
LATER = datetime(2026, 10, 3, 10, 0, tzinfo=timezone.utc)
EDITOR = "daniel.ortiz@connectsphere.edu"
OTHER_EDITOR = "venue.two@connectsphere.edu"


def make_venue(**overrides):
    fields = dict(
        id=7, name="Lecture Theatre 1", building="North wing", cap=150,
        layouts=["theatre"], facilities=["Projector"], accessibility=["Wheelchair Access"],
        operatingHours="08:00 - 22:00", operatingDays=["Monday", "Tuesday"],
        unavailability=[], setupMinutes=30, turnaroundMinutes=45, is_active=True,
        last_updated_by="someone.before@connectsphere.edu", last_updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    fields.update(overrides)
    return SimpleNamespace(**fields)


class FakeSession:
    """Collects what would be added to the database."""

    def __init__(self):
        self.added = []

    def add(self, obj):
        self.added.append(obj)


# ---------------------------------------------------------------- AC5: what is audited

class TestAuditedFields(unittest.TestCase):
    def test_audited_fields_exist_on_the_venue_table(self):
        for field in AUDITED_FIELDS:
            with self.subTest(field=field):
                self.assertTrue(hasattr(models.Venue, field))


# ---------------------------------------------------------------- AC1 + AC5: creating a venue

class TestCreationChanges(unittest.TestCase):
    def test_every_audited_field_is_recorded_as_new(self):
        changes = creation_changes(make_venue())

        self.assertEqual(set(changes), set(AUDITED_FIELDS))
        self.assertEqual(changes["cap"], {"old": None, "new": 150})
        self.assertEqual(changes["setupMinutes"], {"old": None, "new": 30})
        self.assertTrue(all(c["old"] is None for c in changes.values()))


# ---------------------------------------------------------------- AC1: editing a venue

class TestApplyUpdate(unittest.TestCase):
    def test_changed_fields_are_set_and_reported_with_old_and_new_values(self):
        venue = make_venue()
        changes = apply_update(venue, {"cap": 300, "facilities": ["Whiteboard"]})

        self.assertEqual(changes, {
            "cap": {"old": 150, "new": 300},
            "facilities": {"old": ["Projector"], "new": ["Whiteboard"]},
        })
        self.assertEqual(venue.cap, 300)
        self.assertEqual(venue.facilities, ["Whiteboard"])

    def test_unchanged_values_are_not_reported(self):
        changes = apply_update(make_venue(), {"name": "Lecture Theatre 1", "cap": 300})

        self.assertEqual(set(changes), {"cap"})

    def test_an_edit_that_changes_nothing_reports_nothing(self):
        venue = make_venue()

        self.assertEqual(apply_update(venue, {"cap": 150, "layouts": ["theatre"]}), {})
        self.assertEqual(apply_update(venue, {}), {})

    def test_smallest_possible_change_is_reported(self):
        # Boundary: a change of 1 is still a change.
        self.assertEqual(apply_update(make_venue(), {"cap": 151}), {"cap": {"old": 150, "new": 151}})

    def test_reordering_a_list_counts_as_a_change(self):
        venue = make_venue(layouts=["theatre", "banquet"])

        self.assertNotEqual(apply_update(venue, {"layouts": ["banquet", "theatre"]}), {})

    def test_fields_not_sent_are_left_alone(self):
        venue = make_venue()
        apply_update(venue, {"cap": 99})

        self.assertEqual((venue.name, venue.setupMinutes, venue.operatingDays), ("Lecture Theatre 1", 30, ["Monday", "Tuesday"]))

    def test_setup_turnaround_and_unavailability_changes_are_reported(self):
        period = {"start": "2027-01-10T08:00:00", "end": "2027-01-11T08:00:00", "reason": "maintenance", "note": None}
        changes = apply_update(make_venue(), {"turnaroundMinutes": 90, "unavailability": [period]})

        self.assertEqual(changes, {
            "turnaroundMinutes": {"old": 45, "new": 90},
            "unavailability": {"old": [], "new": [period]},
        })


# ---------------------------------------------------------------- AC1: deactivating is a recorded action

class TestChangeAction(unittest.TestCase):
    def test_ordinary_edit(self):
        self.assertEqual(change_action({"cap": {"old": 1, "new": 2}}), "edit")

    def test_deactivation(self):
        self.assertEqual(change_action({"is_active": {"old": True, "new": False}}), "deactivate")

    def test_reactivation(self):
        self.assertEqual(change_action({"is_active": {"old": False, "new": True}}), "reactivate")

    def test_deactivation_wins_when_combined_with_other_changes(self):
        changes = {"cap": {"old": 1, "new": 2}, "is_active": {"old": True, "new": False}}

        self.assertEqual(change_action(changes), "deactivate")


# ---------------------------------------------------------------- AC5: editor + timestamp recorded

class TestRecordChange(unittest.TestCase):
    def setUp(self):
        self.venue = make_venue()
        self.db = FakeSession()

    def test_venue_is_stamped_with_editor_and_time(self):
        record_change(self.db, self.venue, "edit", EDITOR, {"cap": {"old": 150, "new": 300}}, NOW)

        self.assertEqual(self.venue.last_updated_by, EDITOR)
        self.assertEqual(self.venue.last_updated_at, NOW)

    def test_one_audit_row_is_added_with_who_what_and_when(self):
        changes = {"cap": {"old": 150, "new": 300}}
        record_change(self.db, self.venue, "edit", EDITOR, changes, NOW)

        self.assertEqual(len(self.db.added), 1)
        row = self.db.added[0]
        self.assertIsInstance(row, models.VenueChange)
        self.assertEqual((row.venue_id, row.action, row.changed_by, row.changed_at, row.changes), (7, "edit", EDITOR, NOW, changes))

    def test_audit_row_and_venue_share_the_same_timestamp(self):
        record_change(self.db, self.venue, "deactivate", EDITOR, {"is_active": {"old": True, "new": False}}, NOW)

        self.assertEqual(self.db.added[0].changed_at, self.venue.last_updated_at)

    def test_each_change_adds_its_own_row(self):
        record_change(self.db, self.venue, "edit", EDITOR, {"cap": {"old": 150, "new": 300}}, NOW)
        record_change(self.db, self.venue, "deactivate", OTHER_EDITOR, {"is_active": {"old": True, "new": False}}, LATER)

        self.assertEqual([(r.action, r.changed_by, r.changed_at) for r in self.db.added], [
            ("edit", EDITOR, NOW),
            ("deactivate", OTHER_EDITOR, LATER),
        ])
        self.assertEqual((self.venue.last_updated_by, self.venue.last_updated_at), (OTHER_EDITOR, LATER))


if __name__ == "__main__":
    unittest.main()

"""
Unit tests for US39 — Mark Venue Temporarily Unavailable.

"As a Venue Staff member, I want to mark a venue temporarily unavailable for a period so that it
is not used or booked while it cannot operate."

AC1: record a period with a start, an end and a reason ("other" needs a description) ... TestPeriodValidation
AC3: every booking overlapping the period is flagged ........... TestClashingPeriod, TestFlagAffectedBookings
AC4: no booking or event is cancelled; only the flag changes ... TestFlagAffectedBookings
AC6: edit a period or end it early (the flag follows) .......... TestFlagAffectedBookings

backend/venue_unavailability.py is called directly; the database query is a MagicMock returning
plain objects. The integration tests (tests/integration/test_us39_*.py) check it through the API.

Run from the repo root:
    python -m unittest discover -s tests/unit/venue -p "test_us39_*.py" -v
"""

import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

os.environ["DATABASE_URL"] = "sqlite://"
os.environ["JWT_SECRET"] = "test-secret-for-us17-unit-tests-only-0123456789"
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "backend"))

from pydantic import ValidationError

import schemas
from venue_unavailability import FLAG_KIND, build_flag, clashing_period, flag_affected_bookings

NOW = datetime(2027, 1, 1, 9, 0, tzinfo=timezone.utc)
# A booking held 09:30–12:45 on Mon 4 Jan 2027 (setup and turnaround included).
HOLD = (datetime(2027, 1, 4, 9, 30), datetime(2027, 1, 4, 12, 45))
MAINTENANCE = {"start": "2027-01-04T08:00:00", "end": "2027-01-04T18:00:00", "reason": "maintenance", "note": None}


def booking(status="approved", flag=None, hold=HOLD):
    return SimpleNamespace(id=1, status=status, hold_start=hold[0], hold_end=hold[1], flag=flag, event_id=7)


def db_with(*bookings):
    db = MagicMock()
    db.query.return_value.filter.return_value.all.return_value = list(bookings)
    return db


def venue(periods):
    return SimpleNamespace(id=3, name="Lecture Theatre 1", unavailability=periods)


class TestPeriodValidation(unittest.TestCase):
    def test_a_period_needs_a_start_an_end_after_it_and_a_reason(self):
        period = schemas.UnavailabilityPeriod(start="2027-01-04T08:00", end="2027-01-04T18:00", reason="renovation")
        self.assertEqual(period.reason, "renovation")
        with self.assertRaises(ValidationError):
            schemas.UnavailabilityPeriod(start="2027-01-04T18:00", end="2027-01-04T08:00", reason="maintenance")
        with self.assertRaises(ValidationError):
            schemas.UnavailabilityPeriod(start="2027-01-04T08:00", end="2027-01-04T18:00", reason="holiday")

    def test_other_needs_a_description(self):
        with self.assertRaises(ValidationError):
            schemas.UnavailabilityPeriod(start="2027-01-04T08:00", end="2027-01-04T18:00", reason="other")
        period = schemas.UnavailabilityPeriod(start="2027-01-04T08:00", end="2027-01-04T18:00", reason="other", note="Flooding")
        self.assertEqual(period.note, "Flooding")


class TestClashingPeriod(unittest.TestCase):
    def test_a_period_overlapping_the_hold_is_found(self):
        self.assertEqual(clashing_period(*HOLD, [MAINTENANCE]), MAINTENANCE)

    def test_setup_and_turnaround_count(self):
        # Ends at 09:45: the event starts at 10:00 but setup holds the venue from 09:30.
        early = {**MAINTENANCE, "start": "2027-01-04T07:00:00", "end": "2027-01-04T09:45:00"}
        self.assertEqual(clashing_period(*HOLD, [early]), early)

    def test_touching_or_other_days_do_not_clash(self):
        touching = {**MAINTENANCE, "start": "2027-01-04T12:45:00", "end": "2027-01-04T18:00:00"}
        next_day = {**MAINTENANCE, "start": "2027-01-05T08:00:00", "end": "2027-01-05T18:00:00"}
        self.assertIsNone(clashing_period(*HOLD, [touching, next_day]))
        self.assertIsNone(clashing_period(*HOLD, []))


class TestBuildFlag(unittest.TestCase):
    def test_the_flag_names_the_period_and_asks_for_a_replacement(self):
        flag = build_flag("Lecture Theatre 1", {**MAINTENANCE, "reason": "safety", "note": "Ceiling repair"}, NOW)
        self.assertEqual(flag["kind"], FLAG_KIND)
        self.assertEqual(flag["reason"], "safety")
        self.assertEqual(flag["period_start"], MAINTENANCE["start"])
        self.assertIn("Safety concern: Ceiling repair", flag["message"])
        self.assertIn("04 Jan 2027, 08:00", flag["message"])
        self.assertIn("replacement venue is required", flag["message"])


class TestFlagAffectedBookings(unittest.TestCase):
    def test_an_overlapping_booking_is_flagged_and_kept(self):
        row = booking()
        flagged = flag_affected_bookings(db_with(row), venue([MAINTENANCE]), NOW)
        self.assertEqual(flagged, [row])
        self.assertEqual(row.flag["kind"], FLAG_KIND)
        self.assertEqual(row.status, "approved")  # never cancelled
        self.assertEqual((row.hold_start, row.hold_end), HOLD)

    def test_a_booking_outside_the_period_is_left_alone(self):
        row = booking(hold=(datetime(2027, 1, 5, 9, 30), datetime(2027, 1, 5, 12, 45)))
        self.assertEqual(flag_affected_bookings(db_with(row), venue([MAINTENANCE]), NOW), [])
        self.assertIsNone(row.flag)

    def test_an_already_flagged_booking_is_not_reported_again(self):
        row = booking()
        flag_affected_bookings(db_with(row), venue([MAINTENANCE]), NOW)
        self.assertEqual(flag_affected_bookings(db_with(row), venue([MAINTENANCE]), NOW), [])
        self.assertIsNotNone(row.flag)

    def test_editing_the_period_updates_the_flag(self):
        row = booking()
        flag_affected_bookings(db_with(row), venue([MAINTENANCE]), NOW)
        longer = {**MAINTENANCE, "end": "2027-01-06T18:00:00"}
        self.assertEqual(flag_affected_bookings(db_with(row), venue([longer]), NOW), [])
        self.assertEqual(row.flag["period_end"], longer["end"])

    def test_ending_the_period_early_clears_the_flag(self):
        row = booking()
        flag_affected_bookings(db_with(row), venue([MAINTENANCE]), NOW)
        ended_early = {**MAINTENANCE, "end": "2027-01-04T09:00:00"}
        flag_affected_bookings(db_with(row), venue([ended_early]), NOW)
        self.assertIsNone(row.flag)

    def test_removing_the_period_clears_the_flag(self):
        row = booking()
        flag_affected_bookings(db_with(row), venue([MAINTENANCE]), NOW)
        flag_affected_bookings(db_with(row), venue([]), NOW)
        self.assertIsNone(row.flag)


if __name__ == "__main__":
    unittest.main()

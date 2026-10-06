"""
Unit tests for US17 — Maintain Venue Catalogue: the venue validation rules in
backend/schemas.py, tested directly (no API, no database).

AC2: can record capacity, location, facilities, accessibility and layouts
AC3: is shown validation errors for missing or invalid values, e.g. a non-positive capacity
Week 7 #1: configurable setup and turnaround time per venue
Week 7 #2: venue can be marked temporarily unavailable, with a reason

Each limit is tested at its boundary: the last accepted value and the first rejected one.

Run from the repo root:
    python -m unittest discover -s tests/unit/venue -p "test_us17_*.py" -v
"""

import re
import sys
import unittest
from datetime import datetime
from pathlib import Path

# backend/ must be importable; schemas.py itself needs no database.
REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "backend"))

from pydantic import ValidationError

from schemas import ACCESSIBILITY_FEATURES, UnavailabilityPeriod, VenueCreate, VenueResponse, VenueUpdate

VALID = {
    "name": "Lecture Theatre 1",
    "building": "North wing · Level 2",
    "cap": 150,
    "layouts": ["theatre", "classroom"],
    "facilities": ["Projector", "PA system"],
    "accessibility": ["Wheelchair Access", "Special Physical Seating"],
    "operatingHours": "08:00 - 22:00",
    "operatingDays": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    "unavailability": [{"start": "2027-01-10T08:00", "end": "2027-01-12T18:00", "reason": "renovation", "note": "Re-flooring"}],
    "setupMinutes": 30,
    "turnaroundMinutes": 45,
}

PERIOD = {"start": "2027-01-10T08:00", "end": "2027-01-12T18:00", "reason": "maintenance"}

ALL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


class ValidationTestCase(unittest.TestCase):
    """Adds assertRejects: the model must raise a ValidationError (naming `field`, if given)."""

    def assertRejects(self, model, data, field=None):
        with self.assertRaises(ValidationError) as ctx:
            model(**data)
        if field:
            fields = {e["loc"][0] for e in ctx.exception.errors() if e["loc"]}
            self.assertIn(field, fields, str(ctx.exception))
        return str(ctx.exception)


# ---------------------------------------------------------------- AC2: venue details are recorded

class TestRecordsVenueDetails(ValidationTestCase):
    def test_a_complete_venue_is_accepted_unchanged(self):
        venue = VenueCreate(**VALID)

        self.assertEqual(venue.name, VALID["name"])
        self.assertEqual(venue.building, VALID["building"])
        self.assertEqual(venue.cap, 150)
        self.assertEqual(venue.layouts, ["theatre", "classroom"])
        self.assertEqual(venue.facilities, ["Projector", "PA system"])
        self.assertEqual(venue.accessibility, ["Wheelchair Access", "Special Physical Seating"])
        self.assertEqual((venue.setupMinutes, venue.turnaroundMinutes), (30, 45))

    def test_only_name_location_and_capacity_are_required(self):
        venue = VenueCreate(name="Room", building="COM1", cap=10)

        for field in ("layouts", "facilities", "accessibility", "unavailability"):
            self.assertEqual(getattr(venue, field), [], field)
        self.assertIsNone(venue.operatingHours)
        self.assertEqual(venue.operatingDays, ALL_DAYS[:5])
        self.assertEqual((venue.setupMinutes, venue.turnaroundMinutes), (0, 0))

    def test_text_is_trimmed(self):
        venue = VenueCreate(**{**VALID, "name": "  LT1  ", "building": " COM1 "})

        self.assertEqual((venue.name, venue.building), ("LT1", "COM1"))

    def test_layouts_are_lower_cased_to_match_event_layouts(self):
        venue = VenueCreate(**{**VALID, "layouts": ["Theatre", " BANQUET "]})

        self.assertEqual(venue.layouts, ["theatre", "banquet"])

    def test_repeated_list_items_are_dropped_keeping_first_spelling(self):
        venue = VenueCreate(**{
            **VALID,
            "layouts": ["theatre", "Theatre"],
            "facilities": ["Projector", "projector", "Wi-Fi"],
        })

        self.assertEqual(venue.layouts, ["theatre"])
        self.assertEqual(venue.facilities, ["Projector", "Wi-Fi"])


# ---------------------------------------------------------------- AC3: missing values

class TestMissingValues(ValidationTestCase):
    def test_required_field_missing(self):
        for field in ("name", "building", "cap"):
            with self.subTest(field=field):
                self.assertRejects(VenueCreate, {k: v for k, v in VALID.items() if k != field}, field)

    def test_blank_text_rejected(self):
        for field in ("name", "building"):
            for blank in ("", "   "):  # empty, and whitespace that trims to empty
                with self.subTest(field=field, blank=blank):
                    self.assertRejects(VenueCreate, {**VALID, field: blank}, field)

    def test_one_character_is_enough(self):
        # Boundary: the shortest accepted text.
        for field in ("name", "building"):
            with self.subTest(field=field):
                self.assertEqual(getattr(VenueCreate(**{**VALID, field: "A"}), field), "A")

    def test_blank_list_item_rejected(self):
        self.assertRejects(VenueCreate, {**VALID, "facilities": ["Projector", " "]}, "facilities")


# ---------------------------------------------------------------- AC3: invalid capacity

class TestCapacity(ValidationTestCase):
    def test_non_positive_capacity_rejected(self):
        for cap in (0, -1):
            with self.subTest(cap=cap):
                self.assertIn("greater than 0", self.assertRejects(VenueCreate, {**VALID, "cap": cap}, "cap"))

    def test_capacity_of_one_is_accepted(self):
        # Boundary: the smallest valid capacity.
        self.assertEqual(VenueCreate(**{**VALID, "cap": 1}).cap, 1)

    def test_non_integer_capacity_rejected(self):
        for cap in ("lots", 12.5, None):
            with self.subTest(cap=cap):
                self.assertRejects(VenueCreate, {**VALID, "cap": cap}, "cap")


# ---------------------------------------------------------------- accessibility: a fixed set of features

class TestAccessibilityFeatures(ValidationTestCase):
    def test_every_feature_in_the_set_is_accepted_and_none_is_allowed(self):
        every = list(ACCESSIBILITY_FEATURES)
        for chosen in ([], every):  # boundaries: nothing ticked, everything ticked
            with self.subTest(chosen=chosen):
                self.assertEqual(VenueCreate(**{**VALID, "accessibility": chosen}).accessibility, chosen)

    def test_spelling_is_tidied_to_the_fixed_names_in_order_without_repeats(self):
        venue = VenueCreate(**{**VALID, "accessibility": ["special physical seating", "WHEELCHAIR ACCESS", "wheelchair access"]})

        self.assertEqual(venue.accessibility, ["Wheelchair Access", "Special Physical Seating"])

    def test_a_feature_outside_the_set_is_rejected_naming_it_and_the_allowed_ones(self):
        for features in (["Hearing loop"], ["Wheelchair Access", "Ramp"]):  # only one bad item, or one among good ones
            with self.subTest(features=features):
                message = self.assertRejects(VenueCreate, {**VALID, "accessibility": features}, "accessibility")
                self.assertIn("unknown accessibility feature", message)
                self.assertIn("Mobility/Facility Arrangements", message)

    def test_the_same_rule_applies_when_editing(self):
        self.assertRejects(VenueUpdate, {"accessibility": ["Hearing loop"]}, "accessibility")
        self.assertEqual(VenueUpdate(accessibility=["wheelchair access"]).accessibility, ["Wheelchair Access"])

    def test_the_form_and_the_backend_offer_the_same_features(self):
        source = (REPO / "lib" / "data.ts").read_text(encoding="utf-8")
        listed = re.search(r"VENUE_ACCESSIBILITY_OPTIONS\s*=\s*\[(.*?)\]", source, re.S).group(1)

        self.assertEqual(re.findall(r'"([^"]+)"', listed), list(ACCESSIBILITY_FEATURES))


# ---------------------------------------------------------------- operating information

class TestOperatingHours(ValidationTestCase):
    def test_spacing_is_normalised(self):
        for raw in ("08:00-22:00", " 08:00  -  22:00 "):
            with self.subTest(raw=raw):
                self.assertEqual(VenueCreate(**{**VALID, "operatingHours": raw}).operatingHours, "08:00 - 22:00")

    def test_widest_possible_day_is_accepted(self):
        # Boundary: earliest opening and latest closing time.
        self.assertEqual(VenueCreate(**{**VALID, "operatingHours": "00:00 - 23:59"}).operatingHours, "00:00 - 23:59")

    def test_bad_format_rejected(self):
        cases = [
            "banana",         # not a time range
            "8:00 - 22:00",   # hour must have two digits
            "08:00",          # closing time missing
            "",               # empty
            "08:00 - 24:00",  # first invalid hour (23 is the last valid one)
            "08:00 - 22:60",  # first invalid minute (59 is the last valid one)
        ]
        for raw in cases:
            with self.subTest(raw=raw):
                message = self.assertRejects(VenueCreate, {**VALID, "operatingHours": raw}, "operatingHours")
                self.assertIn("08:00 - 22:00", message)

    def test_closing_one_minute_after_opening_is_accepted(self):
        # Boundary: the shortest valid opening period.
        self.assertEqual(VenueCreate(**{**VALID, "operatingHours": "10:00 - 10:01"}).operatingHours, "10:00 - 10:01")

    def test_closing_must_be_after_opening(self):
        for raw in ("10:00 - 10:00", "10:01 - 10:00"):  # equal, and one minute before
            with self.subTest(raw=raw):
                message = self.assertRejects(VenueCreate, {**VALID, "operatingHours": raw}, "operatingHours")
                self.assertIn("after opening", message)

    def test_hours_are_optional(self):
        self.assertIsNone(VenueCreate(**{**VALID, "operatingHours": None}).operatingHours)


class TestOperatingDays(ValidationTestCase):
    def test_days_are_put_in_week_order_without_repeats(self):
        venue = VenueCreate(**{**VALID, "operatingDays": ["sunday", "Monday", "MONDAY", "Wednesday"]})

        self.assertEqual(venue.operatingDays, ["Monday", "Wednesday", "Sunday"])

    def test_one_day_is_the_minimum(self):
        self.assertEqual(VenueCreate(**{**VALID, "operatingDays": ["Sunday"]}).operatingDays, ["Sunday"])

    def test_no_days_rejected(self):
        self.assertIn("at least one", self.assertRejects(VenueCreate, {**VALID, "operatingDays": []}, "operatingDays"))

    def test_all_seven_days_is_the_maximum(self):
        self.assertEqual(VenueCreate(**{**VALID, "operatingDays": ALL_DAYS}).operatingDays, ALL_DAYS)

    def test_unknown_day_rejected(self):
        for days in (["Mon"], ["Monday", "Someday"]):  # abbreviation; one bad day among good ones
            with self.subTest(days=days):
                message = self.assertRejects(VenueCreate, {**VALID, "operatingDays": days}, "operatingDays")
                self.assertIn("unknown day", message)


# ---------------------------------------------------------------- Week 7 #1: setup and turnaround

class TestSetupAndTurnaround(ValidationTestCase):
    FIELDS = ("setupMinutes", "turnaroundMinutes")

    def test_limits_are_accepted(self):
        for field in self.FIELDS:
            for value in (0, 1440):  # boundaries: none, and one full day
                with self.subTest(field=field, value=value):
                    self.assertEqual(getattr(VenueCreate(**{**VALID, field: value}), field), value)

    def test_just_outside_the_limits_is_rejected(self):
        for field in self.FIELDS:
            for value in (-1, 1441):  # one past each boundary
                with self.subTest(field=field, value=value):
                    self.assertRejects(VenueCreate, {**VALID, field: value}, field)

    def test_non_integer_rejected(self):
        for field in self.FIELDS:
            for value in (12.5, "soon", None):
                with self.subTest(field=field, value=value):
                    self.assertRejects(VenueCreate, {**VALID, field: value}, field)


# ---------------------------------------------------------------- Week 7 #2: unavailability periods

class TestUnavailabilityPeriod(ValidationTestCase):
    def test_each_reason_accepted_without_a_note(self):
        for reason in ("maintenance", "equipment_failure", "renovation", "safety", "internal_activity"):
            with self.subTest(reason=reason):
                period = UnavailabilityPeriod(**{**PERIOD, "reason": reason})
                self.assertEqual(period.reason, reason)
                self.assertEqual(period.start, datetime(2027, 1, 10, 8, 0))

    def test_unknown_reason_rejected(self):
        self.assertRejects(UnavailabilityPeriod, {**PERIOD, "reason": "felt like it"}, "reason")

    def test_other_requires_a_note(self):
        for note in (None, "   "):  # missing, and whitespace that trims to empty
            with self.subTest(note=note):
                message = self.assertRejects(UnavailabilityPeriod, {**PERIOD, "reason": "other", "note": note})
                self.assertIn("note is required", message)

    def test_other_with_a_note_accepted(self):
        self.assertEqual(UnavailabilityPeriod(**{**PERIOD, "reason": "other", "note": " Filming "}).note, "Filming")

    def test_period_of_one_minute_is_accepted(self):
        # Boundary: the shortest valid period.
        period = UnavailabilityPeriod(**{**PERIOD, "start": "2027-01-10T08:00", "end": "2027-01-10T08:01"})

        self.assertEqual((period.end - period.start).total_seconds(), 60)

    def test_end_must_be_after_start(self):
        for end in ("2027-01-10T08:00", "2027-01-10T07:59"):  # equal, and one minute before
            with self.subTest(end=end):
                message = self.assertRejects(UnavailabilityPeriod, {**PERIOD, "end": end})
                self.assertIn("end must be after start", message)

    def test_start_end_and_reason_are_required(self):
        for missing in ("start", "end", "reason"):
            with self.subTest(missing=missing):
                self.assertRejects(UnavailabilityPeriod, {k: v for k, v in PERIOD.items() if k != missing}, missing)

    def test_note_of_500_characters_is_accepted(self):
        self.assertEqual(len(UnavailabilityPeriod(**{**PERIOD, "note": "x" * 500}).note), 500)

    def test_note_of_501_characters_is_rejected(self):
        self.assertRejects(UnavailabilityPeriod, {**PERIOD, "note": "x" * 501}, "note")

    def test_bad_period_makes_the_venue_invalid(self):
        self.assertRejects(VenueCreate, {**VALID, "unavailability": [{**PERIOD, "reason": "nope"}]}, "unavailability")


# ---------------------------------------------------------------- edits (VenueUpdate)

class TestVenueUpdate(ValidationTestCase):
    def test_only_sent_fields_are_set(self):
        self.assertEqual(VenueUpdate(cap=99).model_dump(exclude_unset=True), {"cap": 99})

    def test_deactivation_is_an_update(self):
        self.assertEqual(VenueUpdate(is_active=False).model_dump(exclude_unset=True), {"is_active": False})

    def test_create_rules_also_apply_when_editing(self):
        cases = [
            ("name", "  "),
            ("cap", 0),
            ("operatingHours", "10:00 - 10:00"),
            ("operatingDays", []),
            ("setupMinutes", -1),
            ("turnaroundMinutes", 1441),
            ("unavailability", [{**PERIOD, "end": PERIOD["start"]}]),
        ]
        for field, value in cases:
            with self.subTest(field=field, value=value):
                self.assertRejects(VenueUpdate, {field: value}, field)

    def test_null_for_a_required_field_is_rejected(self):
        for field in ("name", "cap", "layouts", "is_active"):  # one of each kind of field
            with self.subTest(field=field):
                message = self.assertRejects(VenueUpdate, {field: None})
                self.assertIn("cannot be null", message)
                self.assertIn(field, message)

    def test_operating_hours_can_be_cleared_with_null(self):
        self.assertEqual(VenueUpdate(operatingHours=None).model_dump(exclude_unset=True), {"operatingHours": None})

    def test_editor_cannot_be_set_in_the_body(self):
        self.assertEqual(VenueUpdate(cap=50, last_updated_by="x@y.z").model_dump(exclude_unset=True), {"cap": 50})
        self.assertNotIn("last_updated_by", VenueCreate(**VALID, last_updated_by="x@y.z").model_dump())


# ---------------------------------------------------------------- reading venues back

class TestVenueResponse(ValidationTestCase):
    def test_older_rows_with_missing_values_still_load(self):
        row = {
            "id": 1, "name": "Old Hall", "building": "Block A", "cap": 100,
            "layouts": None, "facilities": None, "accessibility": None, "operatingDays": None,
            "unavailability": None, "setupMinutes": None, "turnaroundMinutes": None,
            "is_active": True, "last_updated_by": "x@y.z", "last_updated_at": "2026-09-01T10:00:00",
        }
        venue = VenueResponse(**row)

        self.assertEqual(venue.layouts, [])
        self.assertEqual(venue.unavailability, [])
        self.assertEqual((venue.setupMinutes, venue.turnaroundMinutes), (0, 0))


if __name__ == "__main__":
    unittest.main()

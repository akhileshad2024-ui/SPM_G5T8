"""
Unit tests for US20 — Search and Filter Venues.

"As an Event Coordinator, I want to search and filter venues by event timing, attendance,
location, accessibility, layout, and facilities so that I can find suitable options
efficiently."

AC1: can search by date and time, attendance, location, accessibility, layout, facilities
     ..................... TestSearchRequest (what may be asked), TestMatchingRequirements
AC2: can apply several filters at once and clear them individually
     ..................... TestCombinedFilters, TestClearingFilters
AC3: sees only venues that are free for the specified period
     ..................... TestFreeForPeriod
AC4: is told when no venues match, with the applied filters shown
     ..................... TestAppliedFilters, TestNoMatches
AC5: results within 3 seconds ........................ TestResponseTime
Also: only Event Coordinators may search ............. TestWhoMaySearch
      the page and the backend agree ................. TestPageMatchesBackend

The search rules are in backend/venue_search.py and the endpoint function in backend/main.py
is called directly, with a MagicMock standing in for the database session. So these tests check
what the code decides and asks the database to do. They cannot show that the SQL really returns
only active venues, or that a request without a login gets a 401.

Run from the repo root:
    python -m unittest discover -s tests/unit/venue -p "test_us20_*.py" -v
"""

import os
import sys
import time
import typing
import unittest
from datetime import date, datetime, timezone
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
from pydantic import ValidationError

import main
import models
import schemas
import venue_search
from login.models import Role
from login.security import require_roles

COORDINATOR = SimpleNamespace(email="priya.tan@connectsphere.edu", role=Role.coordinator)

# 2027-01-04 is a Monday.
MON, TUE, WED, SUN = "2027-01-04", "2027-01-05", "2027-01-06", "2027-01-10"


def make_venue(**overrides) -> models.Venue:
    """An active venue open Monday to Friday 08:00-22:00, as loaded from the database (never saved)."""
    fields = dict(
        id=1, name="Lecture Theatre 1", location="North wing", cap=100,
        layouts=["theatre", "classroom"], facilities=["Projector", "PA system"],
        accessibility=["Wheelchair Access", "Special Physical Seating"],
        operatingHours="08:00 - 22:00", operatingDays=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        unavailability=[], setupMinutes=0, turnaroundMinutes=0, is_active=True,
        last_updated_by="daniel.ortiz@connectsphere.edu",
        last_updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    fields.update(overrides)
    return models.Venue(**fields)


def request(**fields) -> schemas.VenueSearchRequest:
    return schemas.VenueSearchRequest(**fields)


def booking(venue_id, start, end, day=MON) -> dict:
    return {"venue_id": venue_id, "date": day, "start": start, "end": end}


def found_ids(venues, **fields) -> list:
    """The ids of the venues a search with these fields returns."""
    return [v.id for v in venue_search.find_venues(venues, request(**fields))]


def route_dependencies(method, path):
    route = next(r for r in main.app.routes if getattr(r, "path", None) == path and method in r.methods)
    return [d.call for d in route.dependant.dependencies]


# ---------------------------------------------------------------- AC1: what a search may contain

class TestSearchRequest(unittest.TestCase):
    def test_a_search_with_nothing_filled_in_is_allowed(self):
        criteria = request()

        self.assertEqual((criteria.date, criteria.attendance, criteria.location, criteria.layout), (None, None, None, None))
        self.assertEqual((criteria.accessibility, criteria.facilities, criteria.bookings), ([], [], []))

    def test_attendance_must_be_at_least_one(self):
        for attendance, ok in ((-1, False), (0, False), (1, True)):
            with self.subTest(attendance=attendance):
                if ok:
                    self.assertEqual(request(attendance=attendance).attendance, 1)
                else:
                    with self.assertRaises(ValidationError):
                        request(attendance=attendance)

    def test_a_blank_location_or_layout_is_no_filter(self):
        for blank in ("", "   "):
            with self.subTest(blank=repr(blank)):
                criteria = request(location=blank, layout=blank)
                self.assertEqual((criteria.location, criteria.layout), (None, None))

    def test_location_is_trimmed_and_layout_is_trimmed_and_lower_cased(self):
        criteria = request(location="  North wing ", layout=" Theatre ")

        self.assertEqual((criteria.location, criteria.layout), ("North wing", "theatre"))

    def test_accessibility_is_one_of_the_fixed_features_tidied_and_in_fixed_order(self):
        criteria = request(accessibility=["special physical seating", "WHEELCHAIR ACCESS", "Wheelchair Access"])

        self.assertEqual(criteria.accessibility, ["Wheelchair Access", "Special Physical Seating"])

    def test_an_accessibility_feature_outside_the_fixed_set_is_refused(self):
        with self.assertRaises(ValidationError) as ctx:
            request(accessibility=["Step-free access"])

        self.assertIn("unknown accessibility feature(s): Step-free access", str(ctx.exception))

    def test_facilities_drop_repeats_keeping_the_first_spelling_and_refuse_blanks(self):
        self.assertEqual(request(facilities=["Projector", "projector", "Wi-Fi"]).facilities, ["Projector", "Wi-Fi"])
        with self.assertRaises(ValidationError):
            request(facilities=["Projector", "  "])

    def test_date_start_and_end_must_be_given_together(self):
        given = {"date": MON, "start": "10:00", "end": "12:00"}
        self.assertEqual(request(**given).end, "12:00")  # all three: fine
        for left_out in given:
            with self.subTest(missing=left_out):
                with self.assertRaises(ValidationError) as ctx:
                    request(**{k: v for k, v in given.items() if k != left_out})
                self.assertIn("date, start and end must be given together", str(ctx.exception))
        for only in given:
            with self.subTest(only=only):
                with self.assertRaises(ValidationError):
                    request(**{only: given[only]})

    def test_the_end_must_be_after_the_start(self):
        for end, ok in (("09:59", False), ("10:00", False), ("10:01", True)):
            with self.subTest(end=end):
                if ok:
                    self.assertEqual(request(date=MON, start="10:00", end=end).end, end)
                else:
                    with self.assertRaises(ValidationError) as ctx:
                        request(date=MON, start="10:00", end=end)
                    self.assertIn("end must be after start", str(ctx.exception))

    def test_times_are_24_hour_hh_mm(self):
        self.assertEqual(request(date=MON, start="00:00", end="23:59").end, "23:59")  # the extremes are fine
        for bad in ("24:00", "12:60", "9:30", "10:00:00", "", "noon"):
            with self.subTest(start=bad):
                with self.assertRaises(ValidationError):
                    request(date=MON, start=bad, end="23:59")
            with self.subTest(end=bad):
                with self.assertRaises(ValidationError):
                    request(date=MON, start="00:00", end=bad)

    def test_the_date_must_be_a_real_date(self):
        with self.assertRaises(ValidationError):
            request(date="2027-02-30", start="10:00", end="12:00")

    def test_a_held_booking_needs_a_venue_a_real_date_and_times(self):
        self.assertEqual(request(bookings=[booking(3, "09:00", "10:00")]).bookings[0].venue_id, 3)
        for broken in ({"venue_id": 3}, booking("x", "09:00", "10:00"), booking(3, "9am", "10:00"),
                       booking(3, "09:00", "10:00", day="2027-13-01")):
            with self.subTest(booking=broken):
                with self.assertRaises(ValidationError):
                    request(bookings=[broken])


# ---------------------------------------------------------------- AC1: each requirement filters the list

class TestMatchingRequirements(unittest.TestCase):
    def test_no_filters_returns_every_active_venue_in_the_order_given(self):
        venues = [make_venue(id=2), make_venue(id=1), make_venue(id=3)]

        self.assertEqual(found_ids(venues), [2, 1, 3])

    def test_a_deactivated_venue_is_never_returned(self):
        venues = [make_venue(id=1, is_active=False), make_venue(id=2)]

        self.assertEqual(found_ids(venues, attendance=10, location="North wing"), [2])

    def test_attendance_must_fit_within_the_capacity(self):
        venue = make_venue(cap=100)
        for attendance, expected in ((1, [1]), (99, [1]), (100, [1]), (101, [])):
            with self.subTest(attendance=attendance):
                self.assertEqual(found_ids([venue], attendance=attendance), expected)

    def test_location_must_be_the_venues_location_ignoring_case_and_spacing(self):
        venue = make_venue(location=" North wing ")  # older rows may have stray spaces
        for text, expected in (("North wing", [1]), ("NORTH WING", [1]), ("North", []), ("South wing", [])):
            with self.subTest(location=text):
                self.assertEqual(found_ids([venue], location=text), expected)
        self.assertEqual(found_ids([make_venue(location=None)], location="North wing"), [])

    def test_layout_must_be_one_the_venue_supports(self):
        venue = make_venue(layouts=["Theatre", "classroom"])  # older rows may not be lower case
        for layout, expected in (("theatre", [1]), ("CLASSROOM", [1]), ("banquet", [])):
            with self.subTest(layout=layout):
                self.assertEqual(found_ids([venue], layout=layout), expected)

    def test_every_facility_asked_for_must_be_offered(self):
        venue = make_venue(facilities=["Projector", "PA system"])
        for wanted, expected in ((["Projector"], [1]), (["projector", "pa SYSTEM"], [1]),
                                 (["Projector", "Stage"], []), (["Stage"], [])):
            with self.subTest(facilities=wanted):
                self.assertEqual(found_ids([venue], facilities=wanted), expected)

    def test_every_accessibility_feature_asked_for_must_be_offered(self):
        venue = make_venue(accessibility=["Wheelchair Access", "Special Physical Seating"])
        for wanted, expected in ((["Wheelchair Access"], [1]),
                                 (["Special Physical Seating", "Wheelchair Access"], [1]),
                                 (["Wheelchair Access", "Mobility/Facility Arrangements"], []),
                                 (["Mobility/Facility Arrangements"], [])):
            with self.subTest(accessibility=wanted):
                self.assertEqual(found_ids([venue], accessibility=wanted), expected)

    def test_a_venue_with_nothing_recorded_fails_a_requirement_but_passes_when_none_is_asked(self):
        bare = make_venue(layouts=None, facilities=None, accessibility=None)

        self.assertEqual(found_ids([bare]), [1])
        self.assertEqual(found_ids([bare], facilities=["Projector"]), [])
        self.assertEqual(found_ids([bare], accessibility=["Wheelchair Access"]), [])
        self.assertEqual(found_ids([bare], layout="theatre"), [])


# ---------------------------------------------------------------- AC2: several filters at once, cleared one by one

# Each filter, with the request fields that make it up.
FILTER_FIELDS = {
    "timing": ("date", "start", "end"),
    "attendance": ("attendance",),
    "location": ("location",),
    "accessibility": ("accessibility",),
    "layout": ("layout",),
    "facilities": ("facilities",),
}
ALL_FILTERS = dict(
    date=MON, start="10:00", end="12:00", attendance=80, location="North wing",
    accessibility=["Wheelchair Access"], layout="theatre", facilities=["Projector"],
)


# A venue that meets every filter in ALL_FILTERS, and for each filter the one thing that makes a venue fail it.
GOOD = dict(cap=100, location="North wing", layouts=["theatre"], facilities=["Projector"],
            accessibility=["Wheelchair Access"])
FLAWS = {
    "timing": dict(operatingDays=["Tuesday"]),       # closed on Monday
    "attendance": dict(cap=79),                      # too small for 80
    "location": dict(location="South wing"),
    "accessibility": dict(accessibility=[]),
    "layout": dict(layouts=["classroom"]),
    "facilities": dict(facilities=[]),               # no projector
}


def flawed_venues() -> list:
    """Venue 1 meets every filter; venues 2-7 each fail exactly one (in the order of FLAWS)."""
    return [make_venue(id=1, **GOOD)] + [make_venue(id=2 + i, **{**GOOD, **flaw}) for i, flaw in enumerate(FLAWS.values())]


class TestCombinedFilters(unittest.TestCase):
    def test_all_the_filters_together_leave_only_the_venue_that_meets_every_one(self):
        self.assertEqual(found_ids(flawed_venues(), **ALL_FILTERS), [1])

    def test_each_filter_on_its_own_removes_exactly_the_venue_that_fails_it(self):
        for index, (name, fields) in enumerate(FILTER_FIELDS.items()):
            with self.subTest(filter=name):
                only_this = {f: ALL_FILTERS[f] for f in fields}

                self.assertEqual(found_ids(flawed_venues(), **only_this), [v for v in range(1, 8) if v != 2 + index])


class TestClearingFilters(unittest.TestCase):
    def test_clearing_one_filter_brings_back_the_venue_it_was_excluding(self):
        for index, (name, fields) in enumerate(FILTER_FIELDS.items()):
            with self.subTest(cleared=name):
                remaining = {f: v for f, v in ALL_FILTERS.items() if f not in fields}

                self.assertEqual(found_ids(flawed_venues(), **remaining), [1, 2 + index])

    def test_each_filter_is_reported_once_so_that_it_can_be_cleared_by_itself(self):
        applied = venue_search.describe_filters(request(**ALL_FILTERS))

        self.assertEqual([f["key"] for f in applied], list(FILTER_FIELDS))
        for name, fields in FILTER_FIELDS.items():
            with self.subTest(cleared=name):
                remaining = {f: v for f, v in ALL_FILTERS.items() if f not in fields}

                kept = [f["key"] for f in venue_search.describe_filters(request(**remaining))]

                self.assertEqual(kept, [k for k in FILTER_FIELDS if k != name])


# ---------------------------------------------------------------- AC3: only venues free for the period

class TestFreeForPeriod(unittest.TestCase):
    def test_availability_is_only_checked_when_a_period_is_given(self):
        closed_and_booked = make_venue(
            operatingDays=["Tuesday"],
            unavailability=[{"start": "2027-01-04T00:00", "end": "2027-01-05T00:00", "reason": "maintenance"}],
        )

        self.assertEqual(found_ids([closed_and_booked], bookings=[booking(1, "09:00", "17:00")]), [1])

    def test_a_venue_closed_on_that_weekday_is_left_out(self):
        venue = make_venue(operatingDays=["Monday", "Tuesday"])
        for day, expected in ((MON, [1]), (TUE, [1]), (WED, [])):
            with self.subTest(day=day):
                self.assertEqual(found_ids([venue], date=day, start="10:00", end="12:00"), expected)

    def test_a_venue_with_no_operating_days_recorded_is_open_every_day(self):
        for days in ([], None):
            with self.subTest(days=days):
                self.assertEqual(found_ids([make_venue(operatingDays=days)], date=SUN, start="10:00", end="12:00"), [1])

    def test_the_event_itself_must_fall_within_operating_hours(self):
        venue = make_venue(operatingHours="08:00 - 22:00")
        for start, end, expected in (("08:00", "10:00", [1]), ("07:59", "10:00", []),
                                     ("20:00", "22:00", [1]), ("20:00", "22:01", []),
                                     ("08:00", "22:00", [1])):
            with self.subTest(start=start, end=end):
                self.assertEqual(found_ids([venue], date=MON, start=start, end=end), expected)

    def test_setup_or_turnaround_running_outside_operating_hours_does_not_rule_a_venue_out(self):
        venue = make_venue(operatingHours="08:00 - 22:00", setupMinutes=30, turnaroundMinutes=45)

        self.assertEqual(found_ids([venue], date=MON, start="08:00", end="10:00"), [1])  # setup from 07:30
        self.assertEqual(found_ids([venue], date=MON, start="20:00", end="22:00"), [1])  # reset until 22:45

    def test_hours_that_are_missing_or_not_a_valid_range_do_not_limit_the_venue(self):
        for hours in (None, "", "evening only", "22:00 - 08:00", "08:00 - 08:00", "08:00 - 25:00"):
            with self.subTest(hours=hours):
                self.assertEqual(found_ids([make_venue(operatingHours=hours)], date=MON, start="03:00", end="04:00"), [1])

    def test_an_unavailable_period_blocks_the_occupied_window_not_just_the_event(self):
        # Maintenance Monday 10:00-12:00. With 30 min setup and 45 min turnaround an event occupies
        # (start - 30 min) to (end + 45 min); a window that only touches the period is still free.
        venue = make_venue(
            setupMinutes=30, turnaroundMinutes=45,
            unavailability=[{"start": "2027-01-04T10:00", "end": "2027-01-04T12:00", "reason": "maintenance"}],
        )
        for start, end, expected in (
            ("12:30", "14:00", [1]),   # setup starts 12:00, exactly when maintenance ends
            ("12:29", "14:00", []),    # setup starts 11:59, inside maintenance
            ("08:00", "09:15", [1]),   # reset ends 10:00, exactly when maintenance starts
            ("08:00", "09:16", []),    # reset ends 10:01, inside maintenance
            ("10:30", "11:30", []),    # inside
            ("09:00", "13:00", []),    # around it
        ):
            with self.subTest(start=start, end=end):
                self.assertEqual(found_ids([venue], date=MON, start=start, end=end), expected)

    def test_a_period_on_another_day_does_not_matter_and_a_long_one_covers_the_days_between(self):
        long_closure = make_venue(
            unavailability=[{"start": "2027-01-04T20:00", "end": "2027-01-06T09:00", "reason": "renovation"}])

        self.assertEqual(found_ids([long_closure], date=MON, start="10:00", end="12:00"), [1])   # before it began
        self.assertEqual(found_ids([long_closure], date=TUE, start="10:00", end="12:00"), [])    # in the middle
        self.assertEqual(found_ids([long_closure], date=WED, start="09:00", end="11:00"), [1])   # starts as it ends

    def test_period_times_are_read_whatever_their_format(self):
        for start, end in (("2027-01-04T10:00:00", "2027-01-04T12:00:00"),
                           ("2027-01-04T10:00:00+08:00", "2027-01-04T12:00:00Z"),
                           ("2027-01-04 10:00", "2027-01-04 12:00"),
                           ("2027-01-04", "2027-01-05")):  # a bare date means midnight
            with self.subTest(start=start, end=end):
                venue = make_venue(unavailability=[{"start": start, "end": end, "reason": "safety"}])

                self.assertEqual(found_ids([venue], date=MON, start="10:30", end="11:30"), [])

    def test_a_period_that_cannot_be_read_is_ignored(self):
        broken = (
            {"start": "soon", "end": "later"},
            {"start": None, "end": "2027-01-04T12:00"},
            {"start": "2027-01-04T10:00", "end": "not a time"},
            {"start": "2027-02-30T10:00", "end": "2027-02-30T12:00"},   # no such date
            {"start": "2027-01-04T25:00", "end": "2027-01-04T26:00"},   # no such time
            {"reason": "maintenance"},
        )
        for period in broken:
            with self.subTest(period=period):
                venue = make_venue(unavailability=[period])

                self.assertEqual(found_ids([venue], date=MON, start="10:30", end="11:30"), [1])

    def test_a_venue_with_no_unavailability_recorded_is_free(self):
        self.assertEqual(found_ids([make_venue(unavailability=None)], date=MON, start="10:00", end="12:00"), [1])

    def test_an_existing_booking_blocks_the_occupied_window_not_just_the_event(self):
        # Booked Monday 10:00-12:00 with 30 min setup and 45 min turnaround: the room is busy 09:30-12:45.
        venue = make_venue(setupMinutes=30, turnaroundMinutes=45)
        held = [booking(1, "10:00", "12:00")]
        for start, end, expected in (
            ("13:15", "15:00", [1]),   # setup starts 12:45, exactly when the room is reset
            ("13:14", "15:00", []),    # setup starts 12:44
            ("08:00", "08:45", [1]),   # reset ends 09:30, exactly when the booking's setup starts
            ("08:00", "08:46", []),    # reset ends 09:31
            ("10:00", "12:00", []),    # the same time
        ):
            with self.subTest(start=start, end=end):
                self.assertEqual(found_ids([venue], date=MON, start=start, end=end, bookings=held), expected)

    def test_bookings_on_other_days_or_at_other_venues_do_not_matter(self):
        venue = make_venue(id=1)
        for held in ([booking(1, "10:00", "12:00", day=TUE)], [booking(2, "10:00", "12:00")]):
            with self.subTest(held=held):
                self.assertEqual(found_ids([venue], date=MON, start="10:00", end="12:00", bookings=held), [1])

    def test_a_booking_blocks_only_the_venue_it_is_at(self):
        venues = [make_venue(id=1), make_venue(id=2)]

        self.assertEqual(found_ids(venues, date=MON, start="10:00", end="12:00", bookings=[booking(2, "10:00", "12:00")]), [1])

    def test_a_booking_running_past_midnight_blocks_the_start_of_the_next_day(self):
        venue = make_venue(operatingHours=None)  # open all hours, so only the booking is in the way
        held = [booking(1, "22:00", "01:00", day=MON)]

        self.assertEqual(found_ids([venue], date=TUE, start="00:30", end="01:00", bookings=held), [])
        self.assertEqual(found_ids([venue], date=TUE, start="01:00", end="02:00", bookings=held), [1])

    def test_an_event_occupies_its_setup_before_and_its_turnaround_after(self):
        # The Week 7 example: 10:00-12:00 with 30 min setup and 45 min turnaround occupies 09:30-12:45.
        venue = make_venue(setupMinutes=30, turnaroundMinutes=45)
        day = date.fromisoformat(MON).toordinal() * 24 * 60

        window = venue_search.occupied_window(venue_search.event_window(date.fromisoformat(MON), "10:00", "12:00"), venue)

        self.assertEqual(window, (day + 9 * 60 + 30, day + 12 * 60 + 45))

    def test_a_venue_with_no_setup_or_turnaround_recorded_occupies_only_the_event(self):
        venue = make_venue(setupMinutes=None, turnaroundMinutes=None)

        self.assertEqual(venue_search.occupied_window((600, 720), venue), (600, 720))


# ---------------------------------------------------------------- AC4: no match, with the filters shown

class TestAppliedFilters(unittest.TestCase):
    def test_every_filter_is_described_for_display_in_the_order_of_the_story(self):
        applied = venue_search.describe_filters(request(**{**ALL_FILTERS, "accessibility": ["wheelchair access", "special physical seating"],
                                                           "facilities": ["Projector", "Wi-Fi"]}))

        self.assertEqual(applied, [
            {"key": "timing", "label": "Date and time", "value": "04 Jan 2027, 10:00–12:00"},
            {"key": "attendance", "label": "Expected attendance", "value": "80"},
            {"key": "location", "label": "Location", "value": "North wing"},
            {"key": "accessibility", "label": "Accessibility", "value": "Wheelchair Access, Special Physical Seating"},
            {"key": "layout", "label": "Layout", "value": "Theatre"},
            {"key": "facilities", "label": "Facilities", "value": "Projector, Wi-Fi"},
        ])

    def test_the_date_names_the_right_month(self):
        for day, text in (("2027-01-04", "04 Jan 2027"), ("2027-12-25", "25 Dec 2027")):
            with self.subTest(day=day):
                value = venue_search.describe_filters(request(date=day, start="09:00", end="10:00"))[0]["value"]

                self.assertEqual(value, f"{text}, 09:00–10:00")

    def test_no_filters_means_nothing_is_described(self):
        self.assertEqual(venue_search.describe_filters(request()), [])

    def test_held_bookings_are_not_shown_as_a_filter(self):
        self.assertEqual(venue_search.describe_filters(request(bookings=[booking(1, "10:00", "12:00")])), [])


class TestNoMatches(unittest.TestCase):
    def setUp(self):
        self.venues = [make_venue(id=1, cap=100), make_venue(id=2, cap=50)]

    def search(self, venues, **fields):
        db = MagicMock()
        db.query.return_value.filter.return_value.order_by.return_value.all.return_value = venues
        return main.search_venues(request(**fields), db=db, _user=COORDINATOR)

    def test_when_nothing_matches_the_user_is_told_and_the_filters_are_listed(self):
        result = self.search(self.venues, attendance=500, location="North wing")

        self.assertEqual((result.venues, result.total), ([], 0))
        self.assertEqual(result.message, "No venues match the filters applied.")
        self.assertEqual([(f.key, f.value) for f in result.applied_filters], [("attendance", "500"), ("location", "North wing")])

    def test_an_empty_catalogue_with_no_filters_says_so_instead(self):
        result = self.search([])

        self.assertEqual(result.message, "There are no active venues in the catalogue.")
        self.assertEqual(result.applied_filters, [])

    def test_when_venues_match_there_is_no_message_but_the_filters_are_still_listed(self):
        result = self.search(self.venues, attendance=60)

        self.assertEqual((result.total, [v.id for v in result.venues]), (1, [1]))
        self.assertIsNone(result.message)
        self.assertEqual([f.label for f in result.applied_filters], ["Expected attendance"])


# ---------------------------------------------------------------- the endpoint

class TestSearchEndpoint(unittest.TestCase):
    def test_it_searches_active_venues_only_in_id_order(self):
        db = MagicMock()
        query = db.query.return_value.filter.return_value
        query.order_by.return_value.all.return_value = []

        main.search_venues(request(), db=db, _user=COORDINATOR)

        db.query.assert_called_once_with(models.Venue)
        db.query.return_value.filter.assert_called_once()
        self.assertEqual(str(db.query.return_value.filter.call_args.args[0]), str(models.Venue.is_active == True))
        self.assertEqual([str(a) for a in query.order_by.call_args.args], ["Venue.id"])

    def test_it_returns_the_full_details_of_each_match(self):
        venue = make_venue(id=5, name="Seminar Room", cap=40)
        db = MagicMock()
        db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [venue, make_venue(id=6, cap=10)]

        result = main.search_venues(request(attendance=30), db=db, _user=COORDINATOR)

        self.assertEqual(result.total, 1)
        self.assertIsInstance(result.venues[0], schemas.VenueResponse)
        self.assertEqual((result.venues[0].id, result.venues[0].name, result.venues[0].cap), (5, "Seminar Room", 40))

    def test_it_uses_the_bookings_sent_with_the_search(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [make_venue(id=1), make_venue(id=2)]

        result = main.search_venues(
            request(date=MON, start="10:00", end="12:00", bookings=[booking(1, "11:00", "13:00")]),
            db=db, _user=COORDINATOR)

        self.assertEqual([v.id for v in result.venues], [2])


class TestWhoMaySearch(unittest.TestCase):
    def test_only_event_coordinators_pass_the_search_check(self):
        check = require_roles(*main.VENUE_SEARCHERS)
        for role in Role:
            with self.subTest(role=role.value):
                user = SimpleNamespace(role=role)
                if role == Role.coordinator:
                    self.assertIs(check(user=user), user)
                else:
                    with self.assertRaises(HTTPException) as ctx:
                        check(user=user)
                    self.assertEqual(ctx.exception.status_code, 403)

    def test_the_search_route_is_protected_by_that_check(self):
        names = [d.__qualname__ for d in route_dependencies("POST", "/venues/search")]

        self.assertIn("require_roles.<locals>.dependency", names)


# ---------------------------------------------------------------- AC5: within 3 seconds

def large_catalogue(count: int) -> list:
    layouts = ["theatre", "classroom", "banquet", "boardroom"]
    return [
        make_venue(
            id=i, name=f"Room {i}", location=f"Block {i % 40}", cap=20 + i % 500, layouts=[layouts[i % 4]],
            facilities=["Projector", "PA system"] if i % 2 else ["Projector"],
            accessibility=["Wheelchair Access"] if i % 3 else [],
            setupMinutes=i % 60, turnaroundMinutes=i % 45,
            unavailability=[{"start": "2027-01-04T10:00", "end": "2027-01-04T12:00", "reason": "maintenance"}] if i % 5 == 0 else [],
        )
        for i in range(count)
    ]


class TestResponseTime(unittest.TestCase):
    VENUES, BOOKINGS = 2000, 4000  # far more than ConnectSphere's venues
    EVERYTHING = dict(
        date=MON, start="13:00", end="15:00", attendance=60, location="Block 8",
        accessibility=["Wheelchair Access"], layout="theatre", facilities=["Projector"],
    )

    def setUp(self):
        self.venues = large_catalogue(self.VENUES)
        self.bookings = [booking(i % self.VENUES, f"{9 + i % 8:02d}:00", f"{10 + i % 8:02d}:30") for i in range(self.BOOKINGS)]

    def test_a_search_using_every_filter_over_a_very_large_catalogue_takes_well_under_3_seconds(self):
        criteria = request(**self.EVERYTHING, bookings=self.bookings)

        started = time.perf_counter()
        found = venue_search.find_venues(self.venues, criteria)
        elapsed = time.perf_counter() - started

        self.assertLess(elapsed, 3.0)
        self.assertTrue(0 < len(found) < self.VENUES)  # real work was done, not an empty or trivial result

    def test_the_whole_endpoint_including_building_up_the_response_is_within_3_seconds(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.order_by.return_value.all.return_value = self.venues

        started = time.perf_counter()
        result = main.search_venues(request(**self.EVERYTHING, bookings=self.bookings), db=db, _user=COORDINATOR)
        elapsed = time.perf_counter() - started

        self.assertLess(elapsed, 3.0)
        self.assertTrue(0 < result.total < self.VENUES)


# ---------------------------------------------------------------- the page and the backend agree

class TestPageMatchesBackend(unittest.TestCase):
    """Reads the frontend source, since a Python test cannot click through a browser. These guard against
    the page and the backend drifting apart; they are not a full UI test."""

    def source(self, relative):
        return (REPO / relative).read_text(encoding="utf-8")

    def test_the_page_can_clear_every_filter_the_backend_reports(self):
        keys = typing.get_args(schemas.AppliedFilter.model_fields["key"].annotation)
        clearing = self.source("lib/venues/search.ts")

        self.assertEqual(set(keys), set(FILTER_FIELDS))
        for key in keys:
            with self.subTest(filter=key):
                self.assertIn(f'case "{key}":', clearing)

    def test_the_page_sends_the_field_names_the_backend_expects(self):
        # Only the code that builds the request counts, not the form's own state, which uses the same words.
        source = self.source("lib/venues/search.ts")
        building = source[source.index("export function heldBookings"):]

        for model in (schemas.VenueSearchRequest, schemas.BookedPeriod):
            for field in model.model_fields:
                with self.subTest(model=model.__name__, field=field):
                    self.assertRegex(building, rf"\b{field}\s*[:=]")

    def test_the_page_offers_each_applied_filter_a_clear_button_and_uses_the_fixed_accessibility_list(self):
        component = self.source("components/venues/VenueSearch.tsx")

        self.assertIn("applied_filters", component)
        self.assertIn("aria-label={`Clear ${", component)  # one button per applied filter (not "Clear all")
        self.assertIn("VENUE_ACCESSIBILITY_OPTIONS", component)


if __name__ == "__main__":
    unittest.main()

"""
Unit tests for US22 — Submit Venue Booking Request.

"As an Event Coordinator, I want to submit a venue booking request containing the event timing and
venue requirements so that Venue Staff can assess it."

AC1: a request holds the event date, start and end times, setup and teardown periods, expected
     attendance and required layout ................ TestRequestContents, TestBookingRecord
AC2: only an event with "Approved" status can be requested for ............ TestOnlyApprovedEvents
AC3: the request is recorded as "Pending" and the venue provisionally held ... TestPendingAndHeld
AC4: Venue Staff are notified of the new request ...................... TestVenueStaffNotified
AC5: no second pending request for the same venue and time period ..... TestNoSecondPendingRequest
Also (US21 AC4/AC5): going ahead with a venue that is not fully suitable needs the warning to be
     acknowledged, and the override is returned to be recorded against the event ... TestOverride
Who may submit, and the page and backend agreeing ......... TestWhoMaySubmit, TestPageMatchesBackend

The rules are in backend/booking_request.py and the endpoint function in backend/main.py is called
directly, with a MagicMock standing in for the database session. So these tests check what the code
decides and what it returns. Event bookings are not stored in the backend: the page keeps the returned
booking against the event, and sends the other bookings that hold venues with each request. A mock
database cannot show that a request without a login gets a 401; the integration tests check that.

Run from the repo root:
    python -m unittest discover -s tests/unit/venue -p "test_us22_*.py" -v
"""

import os
import sys
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

import booking_request
import main
import models
import schemas
import venue_availability
from login.models import Role
from login.security import require_roles

COORDINATOR = SimpleNamespace(email="priya.tan@connectsphere.edu", role=Role.coordinator)

# 2027-01-04 is a Monday.
MON, TUE = "2027-01-04", "2027-01-05"

# Every status an event can have (EventStatus in lib/types.ts).
EVENT_STATUSES = ("draft", "submitted", "under_review", "pending_clarification", "approved",
                  "planning", "confirmed", "completed", "rejected", "cancelled")


def make_venue(**overrides) -> models.Venue:
    """An active theatre open Monday to Friday 08:00-22:00 with 30 min setup and 45 min turnaround."""
    fields = dict(
        id=1, name="Lecture Theatre 1", location="North wing", cap=100,
        layouts=["theatre", "classroom"], facilities=["Projector", "PA system"],
        accessibility=["Wheelchair Access", "Special Physical Seating"],
        operatingHours="08:00 - 22:00", operatingDays=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        unavailability=[], setupMinutes=30, turnaroundMinutes=45, is_active=True,
        last_updated_by="daniel.ortiz@connectsphere.edu",
        last_updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    fields.update(overrides)
    return models.Venue(**fields)


def request_body(**overrides) -> dict:
    body = dict(event_id="EVT-2030", event_name="Design Week Keynote", event_status="approved",
                date=MON, start="10:00", end="12:00", attendance=50, layout="theatre")
    body.update(overrides)
    return body


def make_request(**overrides) -> schemas.BookingRequestCreate:
    return schemas.BookingRequestCreate(**request_body(**overrides))


def held(**fields) -> dict:
    """Another booking that holds a venue (as the page sends it)."""
    return {"venue_id": 1, "date": MON, "start": "10:00", "end": "12:00", "status": "pending",
            "event_id": "EVT-9", "event_name": "Career Fair", **fields}


def submit(venue=None, venue_id=1, **overrides):
    """Call the endpoint function as the coordinator, with a fake database that holds `venue`."""
    db = MagicMock()
    db.get.return_value = venue if venue is not None else make_venue()
    return main.request_venue_booking(venue_id, make_request(**overrides), db=db, user=COORDINATOR)


def refused(**kwargs):
    """Submit and return the HTTPException that refuses it."""
    with unittest.TestCase().assertRaises(HTTPException) as ctx:
        submit(**kwargs)
    return ctx.exception


# ---------------------------------------------------------------- AC1: what a request contains

class TestRequestContents(unittest.TestCase):
    def test_a_complete_request_is_accepted(self):
        request = make_request()

        self.assertEqual((request.date, request.start, request.end), (date(2027, 1, 4), "10:00", "12:00"))
        self.assertEqual((request.attendance, request.layout), (50, "theatre"))

    def test_the_event_the_timing_the_attendance_and_the_layout_are_all_required(self):
        for field in ("event_id", "event_name", "event_status", "date", "start", "end", "attendance", "layout"):
            with self.subTest(missing=field):
                body = request_body()
                del body[field]
                with self.assertRaises(ValidationError):
                    schemas.BookingRequestCreate(**body)

    def test_blank_text_is_refused_and_the_layout_is_lower_cased(self):
        for field in ("event_id", "event_name", "event_status", "layout"):
            with self.subTest(blank=field):
                with self.assertRaises(ValidationError):
                    make_request(**{field: "   "})
        self.assertEqual(make_request(layout="Theatre").layout, "theatre")

    def test_attendance_must_be_at_least_one(self):
        for attendance, ok in ((0, False), (-1, False), (1, True)):
            with self.subTest(attendance=attendance):
                if ok:
                    self.assertEqual(make_request(attendance=attendance).attendance, 1)
                else:
                    with self.assertRaises(ValidationError):
                        make_request(attendance=attendance)

    def test_times_are_24_hour_and_the_end_must_be_after_the_start(self):
        for start, end, ok in (("10:00", "10:01", True), ("10:00", "10:00", False), ("10:00", "09:59", False),
                               ("00:00", "23:59", True), ("24:00", "23:59", False), ("9:00", "10:00", False)):
            with self.subTest(start=start, end=end):
                if ok:
                    self.assertEqual(make_request(start=start, end=end).end, end)
                else:
                    with self.assertRaises(ValidationError):
                        make_request(start=start, end=end)

    def test_the_date_must_be_a_real_date(self):
        with self.assertRaises(ValidationError):
            make_request(date="2027-02-30")

    def test_facilities_and_accessibility_are_optional_and_accessibility_is_from_the_fixed_set(self):
        self.assertEqual((make_request().facilities, make_request().accessibility), ([], []))
        self.assertEqual(make_request(accessibility=["wheelchair access"]).accessibility, ["Wheelchair Access"])
        with self.assertRaises(ValidationError):
            make_request(accessibility=["Step-free access"])


class TestBookingRecord(unittest.TestCase):
    def test_the_record_holds_the_event_the_timing_the_setup_and_teardown_the_attendance_and_the_layout(self):
        booking = submit().booking

        self.assertEqual((booking.event_id, booking.event_name), ("EVT-2030", "Design Week Keynote"))
        self.assertEqual((booking.venue_id, booking.venue_name), (1, "Lecture Theatre 1"))
        self.assertEqual((booking.date, booking.start, booking.end), (date(2027, 1, 4), "10:00", "12:00"))
        self.assertEqual((booking.setup_minutes, booking.teardown_minutes), (30, 45))
        self.assertEqual((booking.attendance, booking.layout), (50, "theatre"))

    def test_the_setup_and_teardown_are_the_venues_own_and_default_to_none(self):
        booking = submit(venue=make_venue(setupMinutes=None, turnaroundMinutes=None)).booking

        self.assertEqual((booking.setup_minutes, booking.teardown_minutes), (0, 0))
        self.assertEqual((booking.hold_start, booking.hold_end), (datetime(2027, 1, 4, 10, 0), datetime(2027, 1, 4, 12, 0)))

    def test_the_record_says_who_asked_and_when(self):
        before = datetime.now(timezone.utc)

        booking = submit().booking

        self.assertEqual(booking.requested_by, COORDINATOR.email)
        self.assertTrue(before <= booking.requested_at <= datetime.now(timezone.utc))


# ---------------------------------------------------------------- AC2: only an approved event

class TestOnlyApprovedEvents(unittest.TestCase):
    def test_only_an_approved_event_can_ask_for_a_venue(self):
        for status in EVENT_STATUSES:
            with self.subTest(status=status):
                if status == "approved":
                    self.assertEqual(submit(event_status=status).booking.status, "pending")
                else:
                    error = refused(event_status=status)
                    self.assertEqual(error.status_code, 409)
                    self.assertEqual(error.detail, f"A venue can only be requested for an approved event (this event is {status.replace('_', ' ')}).")

    def test_the_status_is_read_ignoring_case_and_spaces(self):
        for status in ("Approved", " APPROVED "):
            with self.subTest(status=status):
                self.assertEqual(submit(event_status=status).booking.status, "pending")

    def test_an_event_that_already_went_through_a_booking_may_ask_again_once_it_is_planning_or_confirmed(self):
        # A replacement venue after the first became unavailable (Week 7 change #2), or a new request after a rejection.
        for status in EVENT_STATUSES:
            with self.subTest(status=status):
                if status in ("approved", "planning", "confirmed"):
                    self.assertEqual(submit(event_status=status, rebooking=True).booking.status, "pending")
                else:
                    self.assertEqual(refused(event_status=status, rebooking=True).status_code, 409)

    def test_a_planning_event_cannot_ask_unless_it_is_a_rebooking(self):
        self.assertEqual(refused(event_status="planning").status_code, 409)


# ---------------------------------------------------------------- AC3: pending, and the venue provisionally held

class TestPendingAndHeld(unittest.TestCase):
    def test_the_request_is_recorded_as_pending(self):
        self.assertEqual(submit().booking.status, "pending")

    def test_the_venue_is_held_from_the_start_of_setup_to_the_end_of_teardown(self):
        booking = submit().booking  # 10:00-12:00 with 30 min setup and 45 min turnaround

        self.assertEqual((booking.hold_start, booking.hold_end), (datetime(2027, 1, 4, 9, 30), datetime(2027, 1, 4, 12, 45)))

    def test_a_hold_that_crosses_midnight_is_shown_on_the_right_days(self):
        booking = submit(venue=make_venue(operatingHours=None, setupMinutes=60, turnaroundMinutes=60),
                         start="00:30", end="23:30").booking

        self.assertEqual((booking.hold_start, booking.hold_end), (datetime(2027, 1, 3, 23, 30), datetime(2027, 1, 5, 0, 30)))

    def test_the_held_venue_is_not_free_for_anyone_else_while_the_request_is_pending(self):
        booking = submit().booking
        hold = schemas.BookedPeriod(venue_id=booking.venue_id, date=booking.date, start=booking.start, end=booking.end,
                                    status=booking.status, event_name=booking.event_name)
        venue = make_venue()

        clash = venue_availability.availability_issues(venue, date(2027, 1, 4), "12:30", "14:00", [hold])
        clear = venue_availability.availability_issues(venue, date(2027, 1, 4), "13:15", "15:00", [hold])

        self.assertEqual([i.level for i in clash], ["block"])
        self.assertIn("Clashes with Design Week Keynote, already requested", clash[0].text)
        self.assertEqual(clear, [])


# ---------------------------------------------------------------- AC4: Venue Staff are told

class TestVenueStaffNotified(unittest.TestCase):
    def test_venue_staff_are_notified_with_the_event_venue_timing_attendance_and_layout(self):
        notification = submit().notification

        self.assertEqual(notification.to, "venue")
        self.assertEqual(notification.title, "Booking request pending")
        self.assertEqual(notification.body, "Lecture Theatre 1 requested for Design Week Keynote on 04 Jan 2027, 10:00–12:00 (50 people, theatre layout).")

    def test_a_request_made_despite_a_warning_says_so(self):
        notification = submit(attendance=500, acknowledged=True).notification

        self.assertTrue(notification.body.endswith(
            "The coordinator went ahead despite: Capacity 100 is below the expected attendance of 500."))

    def test_no_notification_is_returned_for_a_refused_request(self):
        # A refusal raises, so there is nothing to send: nobody is told about a request that was not made.
        self.assertEqual(refused(event_status="draft").status_code, 409)


# ---------------------------------------------------------------- AC5: no second pending request

class TestNoSecondPendingRequest(unittest.TestCase):
    def test_a_pending_request_for_the_same_venue_and_time_blocks_another(self):
        error = refused(bookings=[held()])

        self.assertEqual(error.status_code, 409)
        self.assertEqual(error.detail, "Lecture Theatre 1 already has a pending request for that period (Career Fair).")

    def test_the_other_event_need_not_be_named(self):
        error = refused(bookings=[held(event_name=None)])

        self.assertEqual(error.detail, "Lecture Theatre 1 already has a pending request for that period (another event).")

    def test_the_same_event_asking_twice_for_the_same_venue_is_also_refused(self):
        self.assertEqual(refused(bookings=[held(event_id="EVT-2030", event_name="Design Week Keynote")]).status_code, 409)

    def test_the_time_period_includes_setup_and_turnaround(self):
        # Another event 10:00-12:00 holds the venue 09:30-12:45; this one holds it from 30 min before its start.
        for start, end, expected_free in (("13:15", "15:00", True), ("13:14", "15:00", False),
                                          ("08:30", "08:45", True), ("08:30", "08:46", False)):
            with self.subTest(start=start, end=end):
                if expected_free:
                    self.assertEqual(submit(start=start, end=end, bookings=[held()]).booking.status, "pending")
                else:
                    error = refused(start=start, end=end, bookings=[held()])
                    # Refused as a duplicate request, not merely as an unsuitable venue.
                    self.assertTrue(error.detail.startswith("Lecture Theatre 1 already has a pending request"), error.detail)

    def test_another_day_or_another_venue_is_no_obstacle(self):
        for other in (held(date=TUE), held(venue_id=2)):
            with self.subTest(other=other):
                self.assertEqual(submit(bookings=[other]).booking.status, "pending")

    def test_an_approved_booking_is_not_a_duplicate_pending_request(self):
        # It is a clash, which makes the venue unsuitable (US21): see TestOverride.
        error = refused(bookings=[held(status="approved")])

        self.assertIn("Acknowledge the warning", error.detail)
        self.assertNotIn("pending request", error.detail)

    def test_the_duplicate_rule_cannot_be_overridden_by_acknowledging(self):
        self.assertEqual(refused(bookings=[held()], acknowledged=True).status_code, 409)


# ---------------------------------------------------------------- US21 AC4/AC5: override

class TestOverride(unittest.TestCase):
    def test_a_fully_suitable_venue_needs_no_acknowledgement_and_leaves_no_override(self):
        for acknowledged in (False, True):
            with self.subTest(acknowledged=acknowledged):
                booking = submit(acknowledged=acknowledged).booking

                self.assertEqual((booking.verdict, booking.override), ("suitable", None))

    def test_an_unsuitable_venue_is_refused_until_the_warning_is_acknowledged(self):
        error = refused(attendance=500)

        self.assertEqual(error.status_code, 409)
        self.assertEqual(error.detail, "This venue is unsuitable for the event. Acknowledge the warning to continue. "
                                       "Capacity 100 is below the expected attendance of 500.")

    def test_a_partially_suitable_venue_is_refused_until_the_warning_is_acknowledged(self):
        error = refused(facilities=["Stage"])

        self.assertEqual(error.detail, "This venue is partially suitable for the event. Acknowledge the warning to continue. "
                                       "Stage is not available at this venue.")

    def test_after_acknowledging_the_request_goes_ahead_and_the_override_is_recorded(self):
        for fields, verdict in ((dict(attendance=500), "unsuitable"), (dict(facilities=["Stage"]), "partially_suitable")):
            with self.subTest(verdict=verdict):
                before = datetime.now(timezone.utc)

                booking = submit(acknowledged=True, **fields).booking

                self.assertEqual((booking.status, booking.verdict), ("pending", verdict))
                self.assertEqual(booking.override.verdict, verdict)
                self.assertEqual(booking.override.acknowledged_by, COORDINATOR.email)
                self.assertTrue(before <= booking.override.acknowledged_at <= datetime.now(timezone.utc))

    def test_the_override_lists_every_requirement_that_was_not_met(self):
        booking = submit(attendance=500, layout="banquet", facilities=["Stage"], acknowledged=True).booking

        self.assertEqual([(u.label, u.severity, u.reason) for u in booking.override.unmet], [
            ("Capacity", "block", "Capacity 100 is below the expected attendance of 500."),
            ("Layout", "block", "Does not support a banquet layout."),
            ("Facility: Stage", "warn", "Stage is not available at this venue."),
        ])

    def test_a_clash_with_an_approved_booking_can_be_acknowledged_but_is_recorded(self):
        booking = submit(bookings=[held(status="approved", event_name="Gala")], acknowledged=True).booking

        self.assertEqual(booking.verdict, "unsuitable")
        self.assertIn("Clashes with Gala, already booked", booking.override.unmet[0].reason)

    def test_the_booking_is_judged_against_the_bookings_at_this_venue_only(self):
        self.assertEqual(submit(bookings=[held(venue_id=2, status="approved")]).booking.verdict, "suitable")


# ---------------------------------------------------------------- other refusals

class TestOtherRefusals(unittest.TestCase):
    def test_an_unknown_venue_is_a_404(self):
        db = MagicMock()
        db.get.return_value = None

        with self.assertRaises(HTTPException) as ctx:
            main.request_venue_booking(999, make_request(), db=db, user=COORDINATOR)

        self.assertEqual((ctx.exception.status_code, ctx.exception.detail), (404, "Venue not found"))
        db.get.assert_called_once_with(models.Venue, 999)

    def test_a_deactivated_venue_cannot_be_requested(self):
        error = refused(venue=make_venue(is_active=False), acknowledged=True)

        self.assertEqual((error.status_code, error.detail), (409, "Lecture Theatre 1 has been deactivated and can't be requested."))


# ---------------------------------------------------------------- who may submit

class TestWhoMaySubmit(unittest.TestCase):
    def test_only_event_coordinators_may_submit_a_request(self):
        check = require_roles(*main.BOOKING_REQUESTERS)
        for role in Role:
            with self.subTest(role=role.value):
                user = SimpleNamespace(role=role)
                if role == Role.coordinator:
                    self.assertIs(check(user=user), user)
                else:
                    with self.assertRaises(HTTPException) as ctx:
                        check(user=user)
                    self.assertEqual(ctx.exception.status_code, 403)

    def test_the_route_requires_that_check(self):
        route = next(r for r in main.app.routes
                     if getattr(r, "path", None) == "/venues/{venue_id}/booking-requests" and "POST" in r.methods)
        names = [d.call.__qualname__ for d in route.dependant.dependencies]

        self.assertIn("require_roles.<locals>.dependency", names)


# ---------------------------------------------------------------- the page and the backend agree

class TestPageMatchesBackend(unittest.TestCase):
    """Reads the frontend source, since a Python test cannot click through a browser. These guard against
    the page and the backend drifting apart; they are not a full UI test."""

    def source(self, relative):
        return (REPO / relative).read_text(encoding="utf-8")

    def test_the_page_sends_the_field_names_the_backend_expects(self):
        source = self.source("lib/venues/booking.ts")
        building = source[source.index("export function buildBookingRequest"):]

        for field in schemas.BookingRequestCreate.model_fields:
            with self.subTest(field=field):
                self.assertRegex(building, rf"\b{field}\s*[:=]")

    def test_the_page_posts_to_the_booking_request_route(self):
        context = self.source("lib/state/app-context.tsx")

        self.assertIn("/booking-requests", context)

    def test_the_page_keeps_the_returned_booking_and_override_against_the_event(self):
        context = self.source("lib/state/app-context.tsx")

        for key in ("bookingRequest", "venueOverrides"):
            with self.subTest(key=key):
                self.assertIn(key, context)
                self.assertIn(key, self.source("lib/types.ts"))


if __name__ == "__main__":
    unittest.main()

"""
Unit tests for US22 — Submit Venue Booking Request.

"As an Event Coordinator, I want to submit a venue booking request containing the event timing and
venue requirements so that Venue Staff can assess it."

AC1: a request holds the event date, start and end times, setup and teardown periods, expected
     attendance and required layout ................ TestRequestContents
AC2: only an event with "Approved" status can be requested for ............ TestOnlyApprovedEvents
AC3: the request is recorded as "Pending" and the venue provisionally held ... TestPendingAndHeld
AC4: Venue Staff are notified of the new request ...................... TestVenueStaffNotified
AC5: no second pending request for the same venue and time period ..... TestNoSecondPendingRequest
Also (US21 AC4/AC5): going ahead with a venue that is not fully suitable needs the warning to be
     acknowledged, and the override is saved on the booking .......... TestOverride
And what Venue Staff then do with the request .......................... TestDecision, TestListBookings
Who may do what, and the page and backend agreeing ........... TestWhoMayUse, TestPageMatchesBackend

The booking is saved: these tests use a real in-memory SQLite database (never Supabase), call the
endpoint functions in backend/main.py directly, and check what was stored, including from a second
database session, which is what a page reload is. They cannot show that a request without a login
gets a 401; the integration tests check that.

Run from the repo root:
    python -m unittest discover -s tests/unit/venue -p "test_us22_*.py" -v
"""

import os
import sys
import unittest
from datetime import date, datetime, time, timezone
from pathlib import Path
from types import SimpleNamespace

# main.py builds the database engine when imported, so point it at in-memory SQLite
# first. The real Supabase database is never touched.
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["JWT_SECRET"] = "test-secret-for-us17-unit-tests-only-0123456789"
REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "backend"))

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import booking_request
import main
import models
import schemas
import venue_availability
import venue_bookings
from database import Base
from login.models import Role
from login.security import require_roles

COORDINATOR = SimpleNamespace(id=5, email="priya.tan@connectsphere.edu", role=Role.coordinator)
OTHER_COORDINATOR = SimpleNamespace(id=6, email="marcus.lee@connectsphere.edu", role=Role.coordinator)
STAFF = SimpleNamespace(id=9, email="daniel.ortiz@connectsphere.edu", role=Role.venue)
ORGANISER = SimpleNamespace(id=1, email="maya.rahman@connectsphere.edu", role=Role.organiser)

# 2027-01-04 is a Monday.
MON = date(2027, 1, 4)
Status = models.EventStatus


class DatabaseTestCase(unittest.TestCase):
    """A fresh in-memory database for every test, with helpers to make venues, events and requests."""

    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(bind=self.engine)
        self.sessions = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        self.db = self.sessions()
        self.reloads = []

    def tearDown(self):
        for session in self.reloads:
            session.close()
        self.db.close()
        self.engine.dispose()

    def venue(self, **overrides) -> models.Venue:
        """An active theatre open Monday to Friday 08:00-22:00 with 30 min setup and 45 min turnaround."""
        fields = dict(
            name="Lecture Theatre 1", location="North wing", cap=200, layouts=["theatre"], facilities=["Projector"],
            accessibility=["Wheelchair Access"], operatingHours="08:00 - 22:00",
            operatingDays=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], unavailability=[],
            setupMinutes=30, turnaroundMinutes=45, is_active=True, last_updated_by="daniel.ortiz@connectsphere.edu",
        )
        fields.update(overrides)
        venue = models.Venue(**fields)
        self.db.add(venue)
        self.db.commit()
        return venue

    def event(self, **overrides) -> models.Event:
        """An approved event assigned to COORDINATOR: 50 people, theatre, 10:00-12:00 on a Monday."""
        fields = dict(
            organiser_id=ORGANISER.id, coordinator_id=COORDINATOR.id, status=Status.approved, name="Design Week Keynote",
            expected_attendance=50, date=MON, start_time=time(10, 0), end_time=time(12, 0), layout="theatre",
            facilities=[], accessibility=[],
        )
        fields.update(overrides)
        event = models.Event(**fields)
        self.db.add(event)
        self.db.commit()
        return event

    def request(self, event, venue, acknowledged=False, user=COORDINATOR, session=None):
        body = schemas.BookingRequestCreate(event_id=event.id, acknowledged=acknowledged)
        return main.request_venue_booking(venue.id, body, db=session or self.db, user=user)

    def refused(self, event, venue, **kwargs) -> HTTPException:
        with self.assertRaises(HTTPException) as ctx:
            self.request(event, venue, **kwargs)
        return ctx.exception

    def decide(self, booking_id, outcome, reason="", user=STAFF):
        return main.decide_booking(booking_id, schemas.BookingDecisionIn(outcome=outcome, reason=reason), db=self.db, user=user)

    def bookings(self, session=None) -> list:
        return (session or self.db).query(models.VenueBooking).order_by(models.VenueBooking.id).all()

    def put_booking(self, venue, name="Event", day=MON, start="10:00", end="12:00", status="pending",
                    coordinator_id=COORDINATOR.id, **fields) -> models.VenueBooking:
        """A booking saved straight into the database, whatever the rules would have allowed when it was made:
        a past date, two overlapping pending requests, a hold that has expired. It has an event of its own and
        is held from the start of the venue's setup to the end of its turnaround, as a real request is."""
        event = self.event(name=name, date=day, start_time=time.fromisoformat(start), end_time=time.fromisoformat(end),
                           coordinator_id=coordinator_id)
        hold = venue_availability.occupied_window(venue_availability.event_window(day, start, end), venue)
        values = dict(
            event_id=event.id, event_name=name, venue_id=venue.id, venue_name=venue.name, status=status, date=day,
            start_time=start, end_time=end, setup_minutes=venue.setupMinutes or 0, teardown_minutes=venue.turnaroundMinutes or 0,
            hold_start=venue_availability.to_datetime(hold[0]), hold_end=venue_availability.to_datetime(hold[1]),
            attendance=50, layout="theatre", verdict="suitable", requested_by=COORDINATOR.email,
            requested_at=datetime.now(timezone.utc),
        )
        values.update(fields)
        booking = models.VenueBooking(**values)
        self.db.add(booking)
        self.db.commit()
        venue_bookings.summarise(self.db, event)  # the event's own venue and booking state, as saving a request sets them
        self.db.commit()
        return booking

    def reload(self):
        """A second session on the same database: what a page reload sees.

        Kept until tearDown: all sessions share one in-memory connection (StaticPool), and a session
        left for the garbage collector can reset that connection mid-test, losing rows just saved.
        """
        session = self.sessions()
        self.reloads.append(session)
        return session


# ---------------------------------------------------------------- AC1: what a request contains

class TestRequestContents(DatabaseTestCase):
    def test_a_request_names_only_the_event_and_whether_the_warning_was_acknowledged(self):
        self.assertEqual(schemas.BookingRequestCreate(event_id=3).acknowledged, False)
        for body in ({}, {"event_id": "soon"}, {"event_id": None}):
            with self.subTest(body=body):
                with self.assertRaises(ValidationError):
                    schemas.BookingRequestCreate(**body)

    def test_the_booking_holds_the_event_timing_the_setup_and_teardown_the_attendance_and_the_layout(self):
        venue, event = self.venue(), self.event()

        booking = self.request(event, venue).booking

        self.assertIsNotNone(booking.id)
        self.assertEqual((booking.event_id, booking.event_name), (event.id, "Design Week Keynote"))
        self.assertEqual((booking.venue_id, booking.venue_name), (venue.id, "Lecture Theatre 1"))
        self.assertEqual((booking.date, booking.start, booking.end), (MON, "10:00", "12:00"))
        self.assertEqual((booking.setup_minutes, booking.teardown_minutes), (30, 45))
        self.assertEqual((booking.attendance, booking.layout), (50, "theatre"))

    def test_the_setup_and_teardown_are_the_venues_own_and_none_recorded_means_none(self):
        booking = self.request(self.event(), self.venue(setupMinutes=None, turnaroundMinutes=None)).booking

        self.assertEqual((booking.setup_minutes, booking.teardown_minutes), (0, 0))
        self.assertEqual((booking.hold_start, booking.hold_end), (datetime(2027, 1, 4, 10, 0), datetime(2027, 1, 4, 12, 0)))

    def test_the_booking_says_who_asked_and_when(self):
        venue, event = self.venue(), self.event()
        before = datetime.now(timezone.utc)

        booking = self.request(event, venue).booking

        self.assertEqual(booking.requested_by, COORDINATOR.email)
        self.assertTrue(before <= booking.requested_at <= datetime.now(timezone.utc))

    def test_the_layout_is_taken_from_the_event_in_lower_case(self):
        self.assertEqual(self.request(self.event(layout="Theatre"), self.venue()).booking.layout, "theatre")

    def test_an_event_without_its_date_times_attendance_and_layout_cannot_ask_for_a_venue(self):
        venue = self.venue()
        for field, blank in (("date", None), ("start_time", None), ("end_time", None),
                             ("expected_attendance", None), ("expected_attendance", 0), ("layout", None), ("layout", "")):
            with self.subTest(field=field, blank=blank):
                error = self.refused(self.event(**{field: blank}), venue)

                self.assertEqual(error.status_code, 409)
                self.assertEqual(error.detail, "Complete the event's date, times, attendance and layout before requesting a venue.")
        self.assertEqual(self.bookings(), [])

    def test_the_end_must_be_after_the_start(self):
        venue = self.venue()
        for end, ok in ((time(9, 59), False), (time(10, 0), False), (time(10, 1), True)):
            with self.subTest(end=end):
                if ok:
                    self.assertEqual(self.request(self.event(end_time=end), venue).booking.end, "10:01")
                else:
                    self.assertEqual(self.refused(self.event(end_time=end), venue).detail, "The event's end time must be after its start time.")


class TestEventAndVenueMustExist(DatabaseTestCase):
    def test_an_unknown_venue_or_event_is_a_404(self):
        venue, event = self.venue(), self.event()
        with self.assertRaises(HTTPException) as no_venue:
            main.request_venue_booking(999, schemas.BookingRequestCreate(event_id=event.id), db=self.db, user=COORDINATOR)
        with self.assertRaises(HTTPException) as no_event:
            main.request_venue_booking(venue.id, schemas.BookingRequestCreate(event_id=999), db=self.db, user=COORDINATOR)

        self.assertEqual((no_venue.exception.status_code, no_venue.exception.detail), (404, "Venue not found"))
        self.assertEqual((no_event.exception.status_code, no_event.exception.detail), (404, "Event not found"))

    def test_only_the_coordinator_the_event_is_assigned_to_may_ask(self):
        venue = self.venue()
        for event in (self.event(), self.event(coordinator_id=None)):
            with self.subTest(coordinator_id=event.coordinator_id):
                error = self.refused(event, venue, user=OTHER_COORDINATOR)

                self.assertEqual((error.status_code, error.detail), (403, "You don't have permission to do that"))
        self.assertEqual(self.bookings(), [])

    def test_a_deactivated_venue_cannot_be_requested(self):
        error = self.refused(self.event(), self.venue(is_active=False), acknowledged=True)

        self.assertEqual((error.status_code, error.detail), (409, "Lecture Theatre 1 has been deactivated and can't be requested."))


# ---------------------------------------------------------------- AC2: only an approved event

class TestOnlyApprovedEvents(DatabaseTestCase):
    def test_only_an_approved_event_can_ask_for_a_venue(self):
        venue = self.venue()
        for status in Status:
            with self.subTest(status=status.value):
                event = self.event(status=status)
                if status == Status.approved:
                    self.assertEqual(self.request(event, venue).booking.status, "pending")
                else:
                    error = self.refused(event, venue)
                    self.assertEqual(error.status_code, 409)
                    self.assertEqual(error.detail, f"A venue can only be requested for an approved event (this event is {status.value.replace('_', ' ')}).")

    def test_an_event_that_already_went_through_a_booking_may_ask_again_once_it_is_planning_or_confirmed(self):
        # A replacement venue after the first became unavailable (Week 7 change #2), or a new request after a rejection.
        for status in ("draft", "submitted", "under_review", "pending_clarification", "approved", "planning",
                       "confirmed", "completed", "rejected", "cancelled"):
            with self.subTest(status=status):
                if status in ("approved", "planning", "confirmed"):
                    booking_request.require_bookable_event(status, rebooking=True)
                else:
                    with self.assertRaises(booking_request.BookingRefused):
                        booking_request.require_bookable_event(status, rebooking=True)

    def test_a_confirmed_event_with_an_earlier_booking_can_be_given_a_replacement_venue(self):
        event = self.event(status=Status.confirmed, booking_state="rejected")

        self.assertEqual(self.request(event, self.venue()).booking.status, "pending")

    def test_a_confirmed_event_that_never_had_a_booking_cannot_ask(self):
        self.assertEqual(self.refused(self.event(status=Status.confirmed), self.venue()).status_code, 409)

    def test_the_status_is_read_ignoring_case_and_spaces(self):
        for status in ("Approved", " APPROVED "):
            with self.subTest(status=status):
                booking_request.require_bookable_event(status, rebooking=False)


# ---------------------------------------------------------------- AC3: pending, saved, and the venue provisionally held

class TestPendingAndHeld(DatabaseTestCase):
    def test_the_request_is_recorded_as_pending_and_saved_on_the_server(self):
        venue, event = self.venue(), self.event()

        booking = self.request(event, venue).booking

        self.assertEqual(booking.status, "pending")
        reloaded = self.reload()  # a second session: what a page reload sees
        saved = self.bookings(reloaded)
        self.assertEqual([(b.id, b.status, b.venue_id, b.event_id) for b in saved], [(booking.id, "pending", venue.id, event.id)])
        stored_event = reloaded.get(models.Event, event.id)
        self.assertEqual((stored_event.venue_id, stored_event.booking_state), (venue.id, "pending"))

    def test_the_venue_is_held_from_the_start_of_setup_to_the_end_of_teardown(self):
        booking = self.request(self.event(), self.venue()).booking  # 10:00-12:00 with 30 min setup and 45 min turnaround

        self.assertEqual((booking.hold_start, booking.hold_end), (datetime(2027, 1, 4, 9, 30), datetime(2027, 1, 4, 12, 45)))

    def test_a_hold_that_crosses_midnight_is_shown_on_the_right_days(self):
        venue = self.venue(operatingHours=None, setupMinutes=60, turnaroundMinutes=60)
        booking = self.request(self.event(start_time=time(0, 30), end_time=time(23, 30)), venue, acknowledged=True).booking

        self.assertEqual((booking.hold_start, booking.hold_end), (datetime(2027, 1, 3, 23, 30), datetime(2027, 1, 5, 0, 30)))

    def test_the_held_venue_is_not_free_for_anyone_else_while_the_request_is_pending(self):
        venue = self.venue()
        booking = self.request(self.event(), venue).booking

        held = venue_bookings.held_periods(self.reload())

        self.assertEqual([(h.venue_id, h.status, h.event_name) for h in held], [(venue.id, "pending", "Design Week Keynote")])
        clash = venue_availability.availability_issues(venue, MON, "12:30", "14:00", held)
        clear = venue_availability.availability_issues(venue, MON, "13:15", "15:00", held)
        self.assertIn("Clashes with Design Week Keynote, already requested", clash[0].text)
        self.assertEqual(clear, [])
        self.assertEqual(booking.status, "pending")

    def test_a_search_leaves_out_a_venue_another_coordinator_has_requested(self):
        held, free = self.venue(name="Held Hall"), self.venue(name="Free Hall")
        self.request(self.event(), held)
        criteria = schemas.VenueSearchRequest(date=MON, start="10:00", end="12:00")

        result = main.search_venues(criteria, db=self.db, _user=COORDINATOR)

        self.assertEqual([v.name for v in result.venues], ["Free Hall"])

    def test_suitability_shows_the_clash_to_other_events_but_not_to_the_event_that_holds_the_venue(self):
        venue, holder = self.venue(), self.event()
        self.request(holder, venue)
        needs = dict(attendance=50, layout="theatre", date=MON, start="10:00", end="12:00")

        for_other = main.check_venue_suitability(schemas.SuitabilityRequest(**needs), db=self.db, _user=COORDINATOR)
        for_holder = main.check_venue_suitability(schemas.SuitabilityRequest(**needs, event_id=holder.id), db=self.db, _user=COORDINATOR)

        self.assertEqual(for_other.results[0].verdict, "unsuitable")
        self.assertEqual(for_holder.results[0].verdict, "suitable")

    def test_asking_for_another_venue_adds_a_booking_and_keeps_the_first(self):
        # US41: an event may book several venues, so the earlier request is no longer replaced.
        first, second, event = self.venue(name="First Hall"), self.venue(name="Second Hall"), self.event()
        earlier = self.request(event, first).booking

        later = self.request(event, second).booking

        self.assertEqual([(b.id, b.status) for b in self.bookings()], [(earlier.id, "pending"), (later.id, "pending")])
        self.assertEqual(sorted(h.venue_id for h in venue_bookings.held_periods(self.db)), sorted([first.id, second.id]))
        self.assertEqual(self.db.get(models.Event, event.id).venue_id, first.id)


# ---------------------------------------------------------------- AC4: Venue Staff are told

class TestVenueStaffNotified(DatabaseTestCase):
    def test_venue_staff_are_notified_with_the_event_venue_timing_attendance_and_layout(self):
        notification = self.request(self.event(), self.venue()).notification

        self.assertEqual(notification.to, "venue")
        self.assertEqual(notification.title, "Booking request pending")
        self.assertEqual(notification.body, "Lecture Theatre 1 requested for Design Week Keynote on 04 Jan 2027, 10:00–12:00 (50 people, theatre layout).")

    def test_a_request_made_despite_a_warning_says_so(self):
        notification = self.request(self.event(expected_attendance=500), self.venue(), acknowledged=True).notification

        self.assertTrue(notification.body.endswith(
            "The coordinator went ahead despite: Capacity 200 is below the expected attendance of 500."))

    def test_a_refused_request_saves_nothing_and_tells_nobody(self):
        self.assertEqual(self.refused(self.event(status=Status.draft), self.venue()).status_code, 409)

        self.assertEqual(self.bookings(), [])


# ---------------------------------------------------------------- AC5: no second pending request

class TestNoSecondPendingRequest(DatabaseTestCase):
    def test_a_pending_request_for_the_same_venue_and_time_blocks_another(self):
        venue = self.venue()
        self.request(self.event(name="Career Fair"), venue)

        error = self.refused(self.event(name="Open House"), venue)

        self.assertEqual(error.status_code, 409)
        self.assertEqual(error.detail, "Lecture Theatre 1 already has a pending request for that period (Career Fair).")
        self.assertEqual(len(self.bookings()), 1)

    def test_the_other_event_need_not_be_named(self):
        venue = self.venue()
        held = [schemas.BookedPeriod(venue_id=venue.id, date=MON, start="10:00", end="12:00", status="pending")]
        needs = SimpleNamespace(date=MON, start="10:00", end="12:00")

        with self.assertRaises(booking_request.BookingRefused) as ctx:
            booking_request.require_no_pending_duplicate(venue, needs, held)

        self.assertEqual(ctx.exception.message, "Lecture Theatre 1 already has a pending request for that period (another event).")

    def test_a_pending_request_at_another_venue_is_not_a_duplicate(self):
        venue = self.venue()
        elsewhere = [schemas.BookedPeriod(venue_id=venue.id + 1, date=MON, start="10:00", end="12:00", status="pending", event_name="Fair")]
        needs = SimpleNamespace(date=MON, start="10:00", end="12:00")

        booking_request.require_no_pending_duplicate(venue, needs, elsewhere)  # no error

    def test_the_same_event_asking_twice_for_the_same_venue_is_also_refused(self):
        venue, event = self.venue(), self.event()
        self.request(event, venue)

        self.assertEqual(self.refused(event, venue).status_code, 409)

    def test_the_time_period_includes_setup_and_turnaround(self):
        # The first event 10:00-12:00 holds the venue 09:30-12:45; another holds it from 30 min before its start.
        venue = self.venue()
        self.request(self.event(name="Morning Event"), venue)
        for start, end, expected_free in ((time(13, 15), time(15, 0), True), (time(13, 14), time(15, 0), False),
                                          (time(8, 30), time(8, 45), True), (time(8, 30), time(8, 46), False)):
            with self.subTest(start=start, end=end):
                event = self.event(name=f"Event {start}", start_time=start, end_time=end)
                if expected_free:
                    self.assertEqual(self.request(event, venue).booking.status, "pending")
                else:
                    error = self.refused(event, venue)
                    # Refused as a duplicate request, not merely as an unsuitable venue.
                    self.assertTrue(error.detail.startswith("Lecture Theatre 1 already has a pending request"), error.detail)

    def test_another_day_or_another_venue_is_no_obstacle(self):
        venue = self.venue()
        self.request(self.event(name="First"), venue)

        other_day = self.event(name="Next day", date=date(2027, 1, 5))
        other_venue = self.venue(name="Other Hall")

        self.assertEqual(self.request(other_day, venue).booking.status, "pending")
        self.assertEqual(self.request(self.event(name="Same time"), other_venue).booking.status, "pending")

    def test_an_approved_booking_is_not_a_duplicate_pending_request(self):
        # It is a clash, which makes the venue unsuitable (US21): see TestOverride.
        venue = self.venue()
        first = self.request(self.event(name="Gala"), venue).booking
        self.decide(first.id, "approved")

        error = self.refused(self.event(name="Fair"), venue)

        self.assertIn("Acknowledge the warning", error.detail)
        self.assertNotIn("pending request", error.detail)

    def test_the_duplicate_rule_cannot_be_overridden_by_acknowledging(self):
        venue = self.venue()
        self.request(self.event(name="First"), venue)

        self.assertEqual(self.refused(self.event(name="Second"), venue, acknowledged=True).status_code, 409)


# ---------------------------------------------------------------- US21 AC4/AC5: override

class TestOverride(DatabaseTestCase):
    def test_a_fully_suitable_venue_needs_no_acknowledgement_and_leaves_no_override(self):
        for acknowledged in (False, True):
            with self.subTest(acknowledged=acknowledged):
                booking = self.request(self.event(name=f"Event {acknowledged}", date=date(2027, 1, 5 + acknowledged)), self.venue(name=f"Hall {acknowledged}"), acknowledged=acknowledged).booking

                self.assertEqual((booking.verdict, booking.override), ("suitable", None))

    def test_an_unsuitable_venue_is_refused_until_the_warning_is_acknowledged(self):
        error = self.refused(self.event(expected_attendance=500), self.venue())

        self.assertEqual(error.status_code, 409)
        self.assertEqual(error.detail, "This venue is unsuitable for the event. Acknowledge the warning to continue. "
                                       "Capacity 200 is below the expected attendance of 500.")

    def test_a_partially_suitable_venue_is_refused_until_the_warning_is_acknowledged(self):
        error = self.refused(self.event(facilities=["Stage"]), self.venue())

        self.assertEqual(error.detail, "This venue is partially suitable for the event. Acknowledge the warning to continue. "
                                       "Stage is not available at this venue.")

    def test_after_acknowledging_the_request_goes_ahead_and_the_override_is_saved(self):
        for fields, verdict in ((dict(expected_attendance=500), "unsuitable"), (dict(facilities=["Stage"]), "partially_suitable")):
            with self.subTest(verdict=verdict):
                before = datetime.now(timezone.utc)

                booking = self.request(self.event(**fields), self.venue(name=f"Hall {verdict}"), acknowledged=True).booking

                self.assertEqual((booking.status, booking.verdict), ("pending", verdict))
                self.assertEqual(booking.override.verdict, verdict)
                self.assertEqual(booking.override.acknowledged_by, COORDINATOR.email)
                self.assertTrue(before <= booking.override.acknowledged_at <= datetime.now(timezone.utc))
                # Saved with the booking, so still there for a second session.
                saved = self.reload().get(models.VenueBooking, booking.id)
                self.assertEqual(saved.override["verdict"], verdict)
                self.assertEqual(saved.override["acknowledged_by"], COORDINATOR.email)

    def test_the_override_lists_every_requirement_that_was_not_met(self):
        event = self.event(expected_attendance=500, layout="banquet", facilities=["Stage"])

        booking = self.request(event, self.venue(), acknowledged=True).booking

        self.assertEqual([(u.label, u.severity, u.reason) for u in booking.override.unmet], [
            ("Capacity", "block", "Capacity 200 is below the expected attendance of 500."),
            ("Layout", "block", "Does not support a banquet layout."),
            ("Facility: Stage", "warn", "Stage is not available at this venue."),
        ])

    def test_a_clash_with_an_approved_booking_can_be_acknowledged_but_is_recorded(self):
        venue = self.venue()
        first = self.request(self.event(name="Gala"), venue).booking
        self.decide(first.id, "approved")

        booking = self.request(self.event(name="Fair"), venue, acknowledged=True).booking

        self.assertEqual(booking.verdict, "unsuitable")
        self.assertIn("Clashes with Gala, already booked", booking.override.unmet[0].reason)

    def test_the_booking_is_judged_against_the_bookings_at_this_venue_only(self):
        first, second = self.venue(name="First Hall"), self.venue(name="Second Hall")
        gala = self.request(self.event(name="Gala"), first).booking
        self.decide(gala.id, "approved")

        self.assertEqual(self.request(self.event(name="Fair"), second).booking.verdict, "suitable")

    def test_an_events_own_approved_booking_does_not_make_another_venue_unsuitable_for_it(self):
        first, second, event = self.venue(name="First Hall"), self.venue(name="Second Hall"), self.event()
        self.decide(self.request(event, first).booking.id, "approved")

        # US41: a second venue at the same time is suitable; the event's own booking isn't in its way.
        self.assertEqual(self.request(event, second).booking.verdict, "suitable")

    def test_the_same_event_cannot_book_the_same_venue_twice(self):
        # US41: several venues, each for a different venue.
        venue, event = self.venue(), self.event()
        self.decide(self.request(event, venue).booking.id, "approved")

        refusal = self.refused(event, venue)

        self.assertEqual(refusal.status_code, 409)
        self.assertIn("already has a booking for Lecture Theatre 1", refusal.detail)


# ---------------------------------------------------------------- what Venue Staff then do

class TestDecision(DatabaseTestCase):
    def requested(self, venue=None, event=None, **event_fields):
        venue, event = venue or self.venue(), event or self.event(**event_fields)
        return venue, event, self.request(event, venue).booking

    def test_approving_a_pending_request_confirms_the_booking_and_the_events_venue(self):
        venue, event, booking = self.requested()
        before = datetime.now(timezone.utc)

        approved = self.decide(booking.id, "approved", "See you there.")

        self.assertEqual((approved["status"], approved["decided_by"], approved["decision_reason"]), ("approved", STAFF.email, "See you there."))
        self.assertTrue(before <= approved["decided_at"] <= datetime.now(timezone.utc))
        stored = self.reload().get(models.Event, event.id)
        self.assertEqual((stored.venue_id, stored.booking_state), (venue.id, "approved"))

    def test_rejecting_needs_a_reason(self):
        _, _, booking = self.requested()
        for reason in ("", "   "):
            with self.subTest(reason=repr(reason)):
                with self.assertRaises(HTTPException) as ctx:
                    self.decide(booking.id, "rejected", reason)
                self.assertEqual((ctx.exception.status_code, ctx.exception.detail), (409, "Give a reason for rejecting the request."))
        self.assertEqual(self.db.get(models.VenueBooking, booking.id).status, "pending")

    def test_rejecting_frees_the_slot_and_leaves_the_event_without_a_venue(self):
        venue, event, booking = self.requested()

        rejected = self.decide(booking.id, "rejected", "Held for setup that morning.")

        self.assertEqual((rejected["status"], rejected["decision_reason"]), ("rejected", "Held for setup that morning."))
        stored = self.reload().get(models.Event, event.id)
        self.assertEqual((stored.venue_id, stored.booking_state), (None, "rejected"))
        self.assertEqual(venue_bookings.held_periods(self.db), [])
        # The slot can be requested again, by this or another event.
        self.assertEqual(self.request(self.event(name="Next event"), venue).booking.status, "pending")

    def test_rejecting_a_replacement_hands_the_event_back_to_its_approved_venue(self):
        old, new, event = self.venue(name="Old Hall"), self.venue(name="New Hall"), self.event()
        first = self.request(event, old).booking
        self.decide(first.id, "approved")
        replacement = self.request(event, new).booking

        self.decide(replacement.id, "rejected", "Not available.")

        stored = self.db.get(models.Event, event.id)
        self.assertEqual((stored.venue_id, stored.booking_state), (old.id, "approved"))
        self.assertEqual(self.db.get(models.VenueBooking, first.id).status, "approved")

    def test_approving_a_second_venue_keeps_the_events_first_booking(self):
        # US41: both venues are booked; nothing is released.
        old, new, event = self.venue(name="Old Hall"), self.venue(name="New Hall"), self.event()
        first = self.request(event, old).booking
        self.decide(first.id, "approved")
        second = self.request(event, new).booking

        self.decide(second.id, "approved")

        self.assertEqual([(b.venue_id, b.status) for b in self.bookings()], [(old.id, "approved"), (new.id, "approved")])
        self.assertEqual(sorted(h.venue_id for h in venue_bookings.held_periods(self.db)), sorted([old.id, new.id]))

    def test_a_booking_that_clashes_with_an_approved_one_cannot_be_approved(self):
        venue = self.venue()
        _, _, gala = self.requested(venue, name="Gala")
        self.decide(gala.id, "approved")
        # A second request for the same period (made by acknowledging the clash) can't then be approved.
        fair = self.request(self.event(name="Fair"), venue, acknowledged=True).booking

        with self.assertRaises(HTTPException) as ctx:
            self.decide(fair.id, "approved")

        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(ctx.exception.detail, "Can't approve: Clashes with Gala, already booked on 04 Jan 2027 (venue occupied 09:30–12:45 incl. 30 min setup and 45 min turnaround).")
        self.assertEqual(self.db.get(models.VenueBooking, fair.id).status, "pending")

    def test_approving_one_booking_leaves_the_events_other_pending_booking_pending(self):
        # US41: each booking is decided on its own.
        hall, studio, event = self.venue(name="Hall"), self.venue(name="Studio"), self.event()
        main_room = self.request(event, hall).booking
        breakout = self.request(event, studio).booking

        self.decide(main_room.id, "approved")

        self.assertEqual([(b.id, b.status) for b in self.bookings()], [(main_room.id, "approved"), (breakout.id, "pending")])
        stored = self.db.get(models.Event, event.id)
        self.assertEqual((stored.venue_id, stored.booking_state), (hall.id, "pending"))

    def test_a_deactivated_venue_cannot_be_approved(self):
        venue, _, booking = self.requested()
        venue.is_active = False
        self.db.commit()

        with self.assertRaises(HTTPException) as ctx:
            self.decide(booking.id, "approved")

        self.assertEqual(ctx.exception.detail, "Lecture Theatre 1 has been deactivated and can't be approved.")

    def test_only_a_pending_request_can_be_decided(self):
        _, _, booking = self.requested()
        self.decide(booking.id, "approved")

        with self.assertRaises(HTTPException) as ctx:
            self.decide(booking.id, "rejected", "Too late.")

        self.assertEqual((ctx.exception.status_code, ctx.exception.detail), (409, "This request is no longer pending (it is approved)."))

    def test_an_unknown_request_is_a_404(self):
        with self.assertRaises(HTTPException) as ctx:
            self.decide(999, "approved")

        self.assertEqual((ctx.exception.status_code, ctx.exception.detail), (404, "Booking request not found"))


class TestListBookings(DatabaseTestCase):
    def test_coordinators_and_venue_staff_see_the_bookings_of_the_events_they_are_involved_in(self):
        venue, mine, someone_elses = self.venue(), self.event(name="Mine"), self.event(name="Not mine", coordinator_id=OTHER_COORDINATOR.id, date=date(2027, 1, 5))
        self.request(mine, venue)
        main_booking_id = self.bookings()[0].id
        # The other coordinator's event also has a booking, which Venue Staff can see but this coordinator can't.
        self.request(someone_elses, venue, user=OTHER_COORDINATOR)

        by_coordinator = main.list_bookings(db=self.db, user=COORDINATOR)
        by_staff = main.list_bookings(db=self.db, user=STAFF)

        self.assertEqual([b["id"] for b in by_coordinator], [main_booking_id])
        self.assertEqual([b["event_name"] for b in by_staff], ["Mine", "Not mine"])
        self.assertEqual(by_staff[0]["status"], "pending")

    def test_a_booking_includes_its_override_and_decision(self):
        venue, event = self.venue(), self.event(expected_attendance=500)
        booking = self.request(event, venue, acknowledged=True).booking
        self.decide(booking.id, "approved", "Fine.")

        listed = main.list_bookings(db=self.db, user=COORDINATOR)[0]

        self.assertEqual(listed["override"]["verdict"], "unsuitable")
        self.assertEqual((listed["status"], listed["decided_by"], listed["decision_reason"]), ("approved", STAFF.email, "Fine."))


# ---------------------------------------------------------------- who may do what

class TestWhoMayUse(unittest.TestCase):
    def check(self, roles, allowed):
        dependency = require_roles(*roles)
        for role in Role:
            with self.subTest(role=role.value):
                user = SimpleNamespace(role=role)
                if role in allowed:
                    self.assertIs(dependency(user=user), user)
                else:
                    with self.assertRaises(HTTPException) as ctx:
                        dependency(user=user)
                    self.assertEqual(ctx.exception.status_code, 403)

    def test_only_event_coordinators_may_request_a_booking(self):
        self.check(main.BOOKING_REQUESTERS, {Role.coordinator})

    def test_only_venue_staff_may_approve_or_reject_a_request(self):
        self.check(main.BOOKING_DECIDERS, {Role.venue})

    def test_the_routes_require_those_checks(self):
        for method, path in (("POST", "/venues/{venue_id}/booking-requests"), ("POST", "/bookings/{booking_id}/decision"),
                             ("GET", "/bookings")):
            with self.subTest(route=f"{method} {path}"):
                route = next(r for r in main.app.routes if getattr(r, "path", None) == path and method in r.methods)
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

    def test_the_page_posts_to_the_booking_routes(self):
        context = self.source("lib/state/app-context.tsx")

        for route in ("/booking-requests", "/decision", "/bookings"):
            with self.subTest(route=route):
                self.assertIn(route, context)

    def test_the_page_keeps_the_saved_booking_and_override_against_the_event(self):
        # The page puts the saved bookings onto their events with attachBookings (lib/venues/booking.ts).
        page = self.source("lib/state/app-context.tsx") + self.source("lib/venues/booking.ts")
        self.assertIn("attachBookings(", self.source("lib/state/app-context.tsx"))
        for key in ("bookingRequest", "venueOverrides", "bookings"):
            with self.subTest(key=key):
                self.assertIn(key, page)
                self.assertIn(key, self.source("lib/types.ts"))


if __name__ == "__main__":
    unittest.main()

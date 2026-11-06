"""
Unit tests for US40 — Request Replacement Venue.

"As an Event Coordinator, I want to search for and request a replacement venue for a booking affected by
venue unavailability so that my event can still go ahead."

AC1: can view all of their bookings flagged as needing alternative arrangements ........ TestSeeingFlaggedBookings
AC2: can search for a replacement venue using the original booking's timing and requirements
     TestWhatTheReplacementNeeds
AC3: can submit a booking request for the replacement venue, linked to the original booking
     TestSubmittingTheReplacement, TestWhichBookingsCanBeReplaced
AC4: keeps the original event information and the original booking record for reference ... TestOriginalIsKept
AC5: has the flag cleared once the replacement booking is approved ..................... TestFlagClears
And the page agreeing with the backend ................................................. TestPageMatchesBackend

The rules (backend/bookings/requests.py, backend/bookings/service.py) run on a real in-memory SQLite database, never
Supabase, reusing the US22 test setup; boundaries are tested on both sides of the line. Dates are a Monday at least
60 days ahead, so the holds do not lapse whenever the tests are run. The integration tests check it through the API.

Run from the repo root:
    python -m unittest discover -s tests/unit/venue -p "test_us40_*.py" -v
"""

import sys
import unittest
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import HTTPException

from test_us22_submit_booking_request import COORDINATOR, OTHER_COORDINATOR, REPO, STAFF, DatabaseTestCase
import bookings.requests as booking_request
import main
import notifications.service as messaging
import models
import schemas
import venues.availability as venue_availability
import bookings.service as venue_bookings
import venues.unavailability as venue_unavailability
from auth.models import Role, User
from bookings.requests import BookingRefused, replacement_needs, require_bookable_event, require_replaceable

Status = models.EventStatus


def a_monday_ahead(days=60) -> date:
    day = date.today() + timedelta(days=days)
    return day + timedelta(days=(7 - day.weekday()) % 7)


DAY = a_monday_ahead()
NOW = datetime.now(timezone.utc)
FLAG = {"kind": "venue_unavailable", "message": "Hall A is unavailable (Maintenance). A replacement venue is required."}


def original(**overrides):
    """A booking as the rules read it: flagged, approved, 10:00-12:00 for 40 people."""
    fields = dict(id=1, event_id=7, status="approved", flag=FLAG, date=DAY, start_time="10:00", end_time="12:00",
                  attendance=40, layout="classroom", purpose="Breakout", venue_name="Hall A")
    fields.update(overrides)
    return SimpleNamespace(**fields)


class ReplacementTestCase(DatabaseTestCase):
    def setUp(self):
        super().setUp()
        both = ["theatre", "classroom"]
        self.hall_a = self.venue(name="Hall A", layouts=both)
        self.hall_b = self.venue(name="Hall B", layouts=both)
        self.hall_c = self.venue(name="Hall C", layouts=both)

    def book(self, event, venue, status="approved", attendance=40, layout="theatre", purpose="Main programme", flagged=False, **fields):
        """A booking of `event` at `venue` saved straight into the database, held as a real request would be."""
        start, end = event.start_time.strftime("%H:%M"), event.end_time.strftime("%H:%M")
        hold = venue_availability.occupied_window(venue_availability.event_window(event.date, start, end), venue)
        values = dict(
            event_id=event.id, event_name=event.name, venue_id=venue.id, venue_name=venue.name, status=status, date=event.date,
            start_time=start, end_time=end, setup_minutes=venue.setupMinutes, teardown_minutes=venue.turnaroundMinutes,
            hold_start=venue_availability.to_datetime(hold[0]), hold_end=venue_availability.to_datetime(hold[1]),
            attendance=attendance, layout=layout, purpose=purpose, verdict="suitable", requested_by=COORDINATOR.email,
            requested_at=NOW, flag=FLAG if flagged else None,
        )
        values.update(fields)
        booking = models.VenueBooking(**values)
        self.db.add(booking)
        self.db.commit()
        venue_bookings.summarise(self.db, event)
        self.db.commit()
        return booking

    def flagged_event(self, name="Career Fair", **fields):
        """An approved event whose approved booking at Hall A is flagged as needing alternative arrangements."""
        event = self.event(name=name, date=DAY, **fields)
        return event, self.book(event, self.hall_a, flagged=True)

    def replace(self, event, venue, booking, user=COORDINATOR, **body):
        request = schemas.BookingRequestCreate(event_id=event.id, replaces_booking_id=booking.id if booking else None, **body)
        response = main.request_venue_booking(venue.id, request, db=self.db, user=user)
        return {"booking": response.booking.model_dump(), "notification": response.notification.model_dump()}

    def refused(self, *args, **kwargs) -> HTTPException:
        with self.assertRaises(HTTPException) as ctx:
            self.replace(*args, **kwargs)
        return ctx.exception

    def stored(self, row) -> models.VenueBooking:
        self.db.expire_all()
        return self.db.get(models.VenueBooking, row.id)

    def notices(self):
        self.db.expire_all()
        return [(n.title, n.body) for n in self.db.query(models.Notification).order_by(models.Notification.id)]


# ---------------------------------------------------------------- AC1: seeing the flagged bookings

class TestSeeingFlaggedBookings(ReplacementTestCase):
    def listed(self, user=COORDINATOR) -> dict:
        return {b["venue_name"]: b for b in main.list_bookings(db=self.db, user=user)}

    def test_a_booking_caught_by_an_unavailable_period_comes_with_its_flag(self):
        event, booking = self.flagged_event()
        self.db.query(models.VenueBooking).update({"flag": None})
        self.hall_a.unavailability = [{"start": f"{DAY}T08:00:00", "end": f"{DAY}T20:00:00", "reason": "maintenance", "note": None}]
        venue_unavailability.flag_affected_bookings(self.db, self.hall_a, NOW)
        self.db.commit()

        flagged = self.listed()["Hall A"]

        self.assertEqual(flagged["flag"]["kind"], "venue_unavailable")
        self.assertIn("A replacement venue is required.", flagged["flag"]["message"])
        self.assertEqual((flagged["id"], flagged["status"]), (booking.id, "approved"))

    def test_every_flagged_booking_of_the_coordinator_is_listed_across_their_events(self):
        first, _ = self.flagged_event("First Fair")
        second = self.event(name="Second Fair", date=DAY + timedelta(days=7))
        self.book(second, self.hall_a, flagged=True, status="pending")
        steady = self.event(name="Steady Fair", date=DAY + timedelta(days=14))
        self.book(steady, self.hall_b)

        flagged = [b["event_name"] for b in main.list_bookings(db=self.db, user=COORDINATOR) if b["flag"]]

        self.assertEqual(sorted(flagged), ["First Fair", "Second Fair"])

    def test_a_booking_that_is_not_flagged_has_no_flag(self):
        event = self.event(date=DAY)
        self.book(event, self.hall_b)

        self.assertIsNone(self.listed()["Hall B"]["flag"])

    def test_another_coordinator_does_not_see_them(self):
        self.flagged_event()

        self.assertEqual(main.list_bookings(db=self.db, user=OTHER_COORDINATOR), [])

    def test_venue_staff_see_the_flag_and_which_booking_a_request_replaces(self):
        event, booking = self.flagged_event()
        replacement = self.replace(event, self.hall_b, booking)["booking"]

        staff = {b["venue_name"]: b for b in main.list_bookings(db=self.db, user=STAFF)}

        self.assertEqual(staff["Hall B"]["replaces_booking_id"], booking.id)
        self.assertEqual((staff["Hall A"]["flag"]["kind"], staff["Hall B"]["id"]), ("venue_unavailable", replacement["id"]))


# ---------------------------------------------------------------- AC2: what the search uses

class TestWhatTheReplacementNeeds(ReplacementTestCase):
    def test_the_replacement_takes_the_original_bookings_timing_attendance_and_layout(self):
        event = SimpleNamespace(date=DAY + timedelta(days=1), start_time=time(14, 0), end_time=time(16, 0), expected_attendance=120,
                                layout="banquet", facilities=["Projector"], accessibility=["Wheelchair Access"])

        needs = replacement_needs(original(), event)

        self.assertEqual((needs.date, needs.start, needs.end), (DAY, "10:00", "12:00"))  # the booking's, not the event's now
        self.assertEqual((needs.attendance, needs.layout), (40, "classroom"))
        self.assertEqual((needs.facilities, needs.accessibility), (["Projector"], ["Wheelchair Access"]))

    def test_the_coordinator_can_change_the_attendance_and_layout_but_not_the_timing(self):
        event = SimpleNamespace(date=DAY, start_time=time(10, 0), end_time=time(12, 0), expected_attendance=120, layout="banquet",
                                facilities=[], accessibility=[])

        needs = replacement_needs(original(), event, attendance=75, layout="Theatre")

        self.assertEqual((needs.attendance, needs.layout, needs.date, needs.start, needs.end), (75, "theatre", DAY, "10:00", "12:00"))

    def test_a_replacement_is_requested_for_the_original_timing_even_if_the_event_moved_since(self):
        event, booking = self.flagged_event()
        event.date = DAY + timedelta(days=7)
        self.db.commit()

        replacement = self.replace(event, self.hall_b, booking)["booking"]

        self.assertEqual((replacement["date"], replacement["start"], replacement["end"]), (DAY, "10:00", "12:00"))

    def test_the_replacement_starts_from_the_original_needs_and_purpose(self):
        event, booking = self.flagged_event()
        booking.attendance, booking.layout, booking.purpose = 40, "classroom", "Breakout session"
        self.db.commit()

        saved = self.replace(event, self.hall_b, booking)["booking"]

        self.assertEqual((saved["attendance"], saved["layout"], saved["purpose"]), (40, "classroom", "Breakout session"))

    def test_the_coordinator_can_change_them_for_the_replacement(self):
        event, booking = self.flagged_event()

        saved = self.replace(event, self.hall_b, booking, attendance=30, layout="theatre", purpose="Main stage")["booking"]

        self.assertEqual((saved["attendance"], saved["layout"], saved["purpose"]), (30, "theatre", "Main stage"))

    def test_the_replacement_is_checked_for_suitability_like_any_booking_and_needs_acknowledging_when_it_is_not_suitable(self):
        event, booking = self.flagged_event()
        small = self.venue(name="Small Hall", cap=20)

        refused = self.refused(event, small, booking)
        saved = self.replace(event, small, booking, acknowledged=True)["booking"]

        self.assertEqual(refused.status_code, 409)
        self.assertIn("unsuitable", refused.detail)
        self.assertEqual(saved["override"]["verdict"], "unsuitable")

    def test_a_venue_unavailable_at_that_time_is_refused(self):
        event, booking = self.flagged_event()
        self.hall_b.unavailability = [{"start": f"{DAY}T08:00:00", "end": f"{DAY}T20:00:00", "reason": "maintenance", "note": None}]
        self.db.commit()

        refused = self.refused(event, self.hall_b, booking)

        self.assertEqual(refused.status_code, 409)
        self.assertIn("Hall B is unavailable", refused.detail)


# ---------------------------------------------------------------- AC3: submitting it, linked to the original

class TestSubmittingTheReplacement(ReplacementTestCase):
    def test_the_replacement_is_a_pending_request_linked_to_the_original(self):
        event, booking = self.flagged_event()

        saved = self.replace(event, self.hall_b, booking)["booking"]

        self.assertEqual((saved["status"], saved["replaces_booking_id"], saved["venue_name"], saved["event_id"]), ("pending", booking.id, "Hall B", event.id))
        row = self.stored(self.db.get(models.VenueBooking, saved["id"]))
        self.assertEqual((row.replaces_booking_id, row.requested_by), (booking.id, COORDINATOR.email))

    def test_an_ordinary_request_is_not_linked_to_anything(self):
        event = self.event(date=DAY)

        saved = self.replace(event, self.hall_b, None)["booking"]

        self.assertIsNone(saved["replaces_booking_id"])

    def test_venue_staff_are_told_which_booking_it_replaces(self):
        self.db.add(User(email="daniel@connectsphere.edu", name="Daniel Ortiz", role=Role.venue, password_hash="x", is_active=True,
                         failed_login_attempts=0, session_version=0))
        self.db.commit()
        event, booking = self.flagged_event()

        response = self.replace(event, self.hall_b, booking)

        self.assertIn("It replaces the booking at Hall A, which needs alternative arrangements.", response["notification"]["body"])
        [(title, body)] = self.notices()
        self.assertEqual(title, "Booking request pending")
        self.assertIn("It replaces the booking at Hall A", body)

    def test_an_ordinary_requests_notice_does_not_mention_a_replacement(self):
        event = self.event(date=DAY)

        response = self.replace(event, self.hall_b, None)

        self.assertNotIn("replaces", response["notification"]["body"])

    def test_the_replacement_venue_must_be_a_different_venue_from_the_ones_the_event_holds(self):
        event, booking = self.flagged_event()

        refused = self.refused(event, self.hall_a, booking)

        self.assertEqual(refused.status_code, 409)
        self.assertIn("already has a booking for Hall A", refused.detail)

    def test_only_the_events_own_coordinator_can_ask(self):
        event, booking = self.flagged_event()

        self.assertEqual(self.refused(event, self.hall_b, booking, user=OTHER_COORDINATOR).status_code, 403)
        self.assertEqual(len(self.bookings()), 1)

    def test_an_event_in_its_safety_check_can_still_replace_a_flagged_booking_but_not_book_another_venue(self):
        for status in (Status.pending_safety_review, Status.safety_changes_requested, Status.safety_approved, Status.safety_rejected):
            with self.subTest(status=status.value):
                event, booking = self.flagged_event(f"Safety {status.value}", status=status)

                saved = self.replace(event, self.hall_b, booking)["booking"]
                other = self.refused(event, self.hall_c, None)

                self.assertEqual(saved["replaces_booking_id"], booking.id)
                self.assertIn("A venue can only be requested for an approved event", other.detail)
                self.db.delete(self.db.get(models.VenueBooking, saved["id"]))
                self.db.commit()


class TestWhichBookingsCanBeReplaced(ReplacementTestCase):
    def test_the_booking_must_exist_and_belong_to_the_event_hold_a_venue_and_be_flagged(self):
        cases = (
            (None, None, "The booking to replace was not found."),
            (original(event_id=8), None, "That booking belongs to another event."),
            (original(status="rejected"), None, "That booking is rejected, so it can't be replaced."),
            (original(status="cancelled"), None, "That booking is cancelled, so it can't be replaced."),
            (original(status="expired"), None, "That booking is expired, so it can't be replaced."),
            (original(flag=None), None, "That booking isn't flagged as needing alternative arrangements."),
            (original(), SimpleNamespace(status="pending", venue_name="Hall B"),
             "A replacement for this booking is already pending: Hall B. Cancel it to try another venue."),
            (original(), SimpleNamespace(status="approved", venue_name="Hall B"),
             "A replacement for this booking is already approved: Hall B. Cancel it to try another venue."),
        )
        for booking, open_replacement, message in cases:
            with self.subTest(message=message):
                with self.assertRaises(BookingRefused) as refused:
                    require_replaceable(booking, 7, open_replacement)
                self.assertEqual(refused.exception.message, message)

    def test_a_pending_or_approved_flagged_booking_of_the_event_can_be_replaced(self):
        for status in ("pending", "approved"):
            with self.subTest(status=status):
                require_replaceable(original(status=status), 7, None)

    def test_each_refusal_reaches_the_coordinator_as_a_409(self):
        event, booking = self.flagged_event()
        unflagged = self.book(event, self.hall_b, flagged=False)
        elsewhere_event = self.event(name="Elsewhere", date=DAY + timedelta(days=7))
        elsewhere = self.book(elsewhere_event, self.hall_a, flagged=True)
        missing = SimpleNamespace(id=99999)

        for target, message in ((unflagged, "isn't flagged"), (elsewhere, "belongs to another event"), (missing, "was not found")):
            with self.subTest(message=message):
                refused = self.refused(event, self.hall_c, target)
                self.assertEqual(refused.status_code, 409)
                self.assertIn(message, refused.detail)

    def test_a_booking_that_no_longer_holds_a_venue_cannot_be_replaced(self):
        event, booking = self.flagged_event()
        booking.status = "cancelled"
        self.db.commit()

        self.assertIn("is cancelled, so it can't be replaced", self.refused(event, self.hall_b, booking).detail)

    def test_only_one_replacement_can_be_open_at_a_time(self):
        event, booking = self.flagged_event()
        first = self.replace(event, self.hall_b, booking)["booking"]

        refused = self.refused(event, self.hall_c, booking)

        self.assertIn("A replacement for this booking is already pending: Hall B.", refused.detail)
        self.assertEqual(len(self.bookings()), 2)
        self.assertEqual(venue_bookings.open_replacement(self.db, booking).id, first["id"])

    def test_another_can_be_tried_once_the_first_was_rejected_cancelled_or_expired(self):
        for how in ("rejected", "cancelled", "expired"):
            with self.subTest(how=how):
                event, booking = self.flagged_event(f"Retry {how}")
                first = self.replace(event, self.hall_b, booking)["booking"]
                self.db.get(models.VenueBooking, first["id"]).status = how
                self.db.commit()
                self.assertIsNone(venue_bookings.open_replacement(self.db, booking))

                second = self.replace(event, self.hall_c, booking)["booking"]

                self.assertEqual(second["replaces_booking_id"], booking.id)
                self.db.get(models.VenueBooking, second["id"]).status = "cancelled"
                self.db.commit()

    def test_the_booking_ids_must_be_positive(self):
        with self.assertRaises(Exception):
            schemas.BookingRequestCreate(event_id=1, replaces_booking_id=0)

    def test_which_event_statuses_may_ask(self):
        safety = ("pending_safety_review", "safety_changes_requested", "safety_approved", "safety_rejected")
        cases = (
            # (status, rebooking, replacing, allowed)
            ("approved", False, False, True), ("submitted", False, False, False), ("confirmed", False, False, False),
            ("confirmed", True, False, True), ("planning", True, False, True), ("pending_safety_review", True, False, False),
            ("submitted", True, True, False), ("rejected", True, True, False), ("draft", True, True, False),
            *[(status, True, True, True) for status in safety], ("approved", True, True, True), ("confirmed", True, True, True),
        )
        for status, rebooking, replacing, allowed in cases:
            with self.subTest(status=status, rebooking=rebooking, replacing=replacing):
                if allowed:
                    require_bookable_event(status, rebooking, replacing)
                else:
                    with self.assertRaises(BookingRefused):
                        require_bookable_event(status, rebooking, replacing)

    def test_the_status_is_read_case_insensitively(self):
        require_bookable_event("  Pending_Safety_Review ", True, True)


# ---------------------------------------------------------------- AC4: the original is kept

class TestOriginalIsKept(ReplacementTestCase):
    def snapshot(self, row) -> dict:
        row = self.stored(row)
        return {column.name: getattr(row, column.name) for column in models.VenueBooking.__table__.columns}

    def test_asking_changes_neither_the_original_booking_nor_the_event(self):
        event, booking = self.flagged_event()
        before_booking, before_event = self.snapshot(booking), (event.name, event.status, event.date, event.start_time, event.end_time, event.venue_id)

        self.replace(event, self.hall_b, booking)

        self.assertEqual(self.snapshot(booking), before_booking)
        self.db.expire_all()
        stored = self.db.get(models.Event, event.id)
        self.assertEqual((stored.name, stored.status, stored.date, stored.start_time, stored.end_time, stored.venue_id), before_event)

    def test_when_the_replacement_is_approved_the_original_stays_as_a_cancelled_record_with_its_details(self):
        event, booking = self.flagged_event()
        before = self.snapshot(booking)
        replacement = self.replace(event, self.hall_b, booking)["booking"]

        self.decide(replacement["id"], "approved")

        after = self.snapshot(booking)
        self.assertEqual(after["status"], "cancelled")
        for field in ("event_id", "event_name", "venue_id", "venue_name", "date", "start_time", "end_time", "attendance", "layout",
                      "purpose", "hold_start", "hold_end", "requested_by", "decided_by", "decided_at"):
            self.assertEqual(after[field], before[field], field)

    def test_the_event_keeps_both_bookings_and_its_venue_becomes_the_replacement(self):
        event, booking = self.flagged_event()
        replacement = self.replace(event, self.hall_b, booking)["booking"]
        self.decide(replacement["id"], "approved")

        stored = self.db.get(models.Event, event.id)
        self.db.refresh(stored)

        self.assertEqual([(b.venue_name, b.status) for b in venue_bookings.event_bookings(self.db, event.id)], [("Hall A", "cancelled"), ("Hall B", "approved")])
        self.assertEqual((stored.venue_id, stored.booking_state), (self.hall_b.id, "approved"))
        self.assertEqual(stored.name, "Career Fair")

    def test_a_pending_flagged_booking_is_released_too_when_its_replacement_is_approved(self):
        event = self.event(date=DAY)
        booking = self.book(event, self.hall_a, status="pending", flagged=True)
        replacement = self.replace(event, self.hall_b, booking)["booking"]

        self.decide(replacement["id"], "approved")

        self.assertEqual(self.stored(booking).status, "cancelled")

    def test_the_booking_is_released_for_other_events(self):
        event, booking = self.flagged_event()
        replacement = self.replace(event, self.hall_b, booking)["booking"]
        self.decide(replacement["id"], "approved")

        held = venue_bookings.held_periods(self.db, venue_ids=[self.hall_a.id])

        self.assertEqual(held, [])

    def test_the_records_point_at_each_other_so_the_page_can_show_what_replaced_what(self):
        event, booking = self.flagged_event()
        replacement = self.replace(event, self.hall_b, booking)["booking"]
        self.decide(replacement["id"], "approved")

        listed = {b["venue_name"]: b for b in main.list_bookings(db=self.db, user=COORDINATOR)}

        self.assertEqual((listed["Hall B"]["replaces_booking_id"], listed["Hall A"]["replaces_booking_id"]), (booking.id, None))


# ---------------------------------------------------------------- AC5: the flag is cleared on approval

class TestFlagClears(ReplacementTestCase):
    def test_the_flag_is_cleared_once_the_replacement_is_approved_and_not_before(self):
        event, booking = self.flagged_event()
        replacement = self.replace(event, self.hall_b, booking)["booking"]
        self.assertIsNotNone(self.stored(booking).flag)

        self.decide(replacement["id"], "approved")

        self.assertIsNone(self.stored(booking).flag)
        self.assertEqual([b["venue_name"] for b in main.list_bookings(db=self.db, user=COORDINATOR) if b["flag"]], [])

    def test_the_original_stays_flagged_while_the_replacement_is_pending(self):
        event, booking = self.flagged_event()
        self.replace(event, self.hall_b, booking)

        self.assertEqual(self.stored(booking).flag, FLAG)
        self.assertEqual(self.stored(booking).status, "approved")

    def test_a_rejected_replacement_leaves_the_original_flagged_and_replaceable(self):
        event, booking = self.flagged_event()
        replacement = self.replace(event, self.hall_b, booking)["booking"]

        self.decide(replacement["id"], "rejected", "Hall B is needed for exams.")

        self.assertEqual((self.stored(booking).status, self.stored(booking).flag), ("approved", FLAG))
        self.assertEqual(self.replace(event, self.hall_c, booking)["booking"]["replaces_booking_id"], booking.id)

    def test_an_ordinary_booking_being_approved_releases_nothing(self):
        event, booking = self.flagged_event()
        other = self.event(name="Other", date=DAY + timedelta(days=7))
        ordinary = self.replace(other, self.hall_b, None)["booking"]

        self.decide(ordinary["id"], "approved")

        self.assertEqual((self.stored(booking).status, self.stored(booking).flag), ("approved", FLAG))

    def test_approving_when_the_original_was_cancelled_meanwhile_still_works_and_changes_nothing_else(self):
        event, booking = self.flagged_event()
        replacement = self.replace(event, self.hall_b, booking)["booking"]
        venue_bookings.cancel(self.db, [booking])
        self.db.commit()

        approved = self.decide(replacement["id"], "approved")

        self.assertEqual(approved["status"], "approved")
        self.assertEqual(self.stored(booking).status, "cancelled")

    def test_release_replaced_only_acts_on_a_booking_that_still_holds_a_venue(self):
        event, booking = self.flagged_event()
        linked = self.book(event, self.hall_b, status="approved", replaces_booking_id=booking.id)

        released = venue_bookings.release_replaced(self.db, linked)
        again = venue_bookings.release_replaced(self.db, linked)

        self.assertEqual((released.id, released.status, released.flag), (booking.id, "cancelled", None))
        self.assertIsNone(again)
        self.assertIsNone(venue_bookings.release_replaced(self.db, self.book(event, self.hall_c)))  # replaces nothing

    def test_a_replacement_that_points_at_a_booking_that_does_not_exist_releases_nothing(self):
        event, _ = self.flagged_event()
        stray = self.book(event, self.hall_b, status="approved", replaces_booking_id=None)
        stray.replaces_booking_id = 424242

        self.assertIsNone(venue_bookings.release_replaced(self.db, stray))

    def test_the_coordinator_is_told_the_replacement_is_approved_and_the_original_released(self):
        event, booking = self.flagged_event()
        replacement = self.replace(event, self.hall_b, booking)["booking"]

        self.decide(replacement["id"], "approved")

        approved = [body for title, body in self.notices() if title == "Venue booking approved"]
        self.assertEqual(len(approved), 1)
        self.assertIn("Hall B is confirmed for Career Fair", approved[0])
        self.assertIn("It replaces the booking at Hall A, which has been released and no longer needs alternative arrangements.", approved[0])

    def test_an_ordinary_approval_and_a_rejection_say_nothing_about_a_replacement(self):
        first = self.event(name="First", date=DAY)
        second = self.event(name="Second", date=DAY + timedelta(days=7))
        a = self.replace(first, self.hall_b, None)["booking"]
        b = self.replace(second, self.hall_c, None)["booking"]

        self.decide(a["id"], "approved")
        self.decide(b["id"], "rejected", "No staff that day.")

        notices = dict(self.notices())
        self.assertNotIn("replaces", notices["Venue booking approved"])
        self.assertIn("No staff that day.", notices["Venue booking rejected"])

    def test_a_flag_for_a_new_period_on_the_replacement_can_be_replaced_again(self):
        event, booking = self.flagged_event()
        first = self.replace(event, self.hall_b, booking)["booking"]
        self.decide(first["id"], "approved")
        second_row = self.db.get(models.VenueBooking, first["id"])
        second_row.flag = FLAG
        self.db.commit()

        again = self.replace(event, self.hall_c, second_row)["booking"]
        self.decide(again["id"], "approved")

        self.assertEqual([(b.venue_name, b.status) for b in venue_bookings.event_bookings(self.db, event.id)],
                         [("Hall A", "cancelled"), ("Hall B", "cancelled"), ("Hall C", "approved")])


# ---------------------------------------------------------------- the page and the backend agree

class TestPageMatchesBackend(unittest.TestCase):
    """Reads the frontend source, since a Python test cannot click through a browser. These guard against the
    page and the backend drifting apart; they are not a full UI test."""

    def source(self, relative) -> str:
        return (REPO / relative).read_text(encoding="utf-8")

    def test_the_page_knows_the_link_between_a_replacement_and_its_original(self):
        types = self.source("lib/types.ts")
        self.assertIn("replaces_booking_id", types[types.index("export interface VenueBookingRecord"):types.index("export interface BookingFlag")])
        self.assertIn("replaces_booking_id", schemas.VenueBooking.model_fields)
        self.assertIn("replaces_booking_id", schemas.BookingRequestCreate.model_fields)

    def test_the_request_the_page_sends_names_the_booking_it_replaces(self):
        booking = self.source("lib/venues/booking.ts")
        self.assertIn("replaces_booking_id", booking)
        self.assertIn("details.replaces", booking)

    def test_the_coordinator_can_see_find_and_request_a_replacement(self):
        venue_tab = self.source("components/queue/tabs/VenueTab.tsx")
        for text in ("Bookings needing a replacement venue", "Find a replacement venue", "Replacement for the booking at", "Replaced by the booking at"):
            with self.subTest(text=text):
                self.assertIn(text, venue_tab)
        self.assertIn("Find a replacement venue", self.source("components/queue/EventWorkspace.tsx"))

    def test_the_queue_has_a_filter_for_events_that_need_a_venue(self):
        self.assertIn('"replacement"', self.source("lib/types.ts"))
        self.assertIn("Needs a venue", self.source("components/queue/QueueList.tsx"))
        self.assertIn("hasFlaggedBooking", self.source("lib/events/review/review.ts"))

    def test_venue_staff_see_that_a_request_is_a_replacement(self):
        card = self.source("components/bookings/BookingRequestCard.tsx")
        self.assertIn("Replacement venue.", card)
        self.assertIn("originalOf", card)


if __name__ == "__main__":
    unittest.main()

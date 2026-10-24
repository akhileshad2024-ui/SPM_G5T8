"""
Unit tests for US41 — Manage Multiple Venue Bookings for an Event.

"As an Event Coordinator, I want one event to have bookings at several venues so that larger events
can use several spaces at the same time."

AC1: more than one booking request for the same event, each for a different venue ... TestSeveralVenues
AC2: attendance, layout and purpose set for each booking separately .............. TestEachBookingsNeeds
AC3: each booking checked on its own for suitability and availability ............ TestCheckedOnItsOwn
AC4: all of an event's bookings and their statuses together ...................... TestSeenTogether
AC5: change or cancel one booking without affecting the others, or cancel all ... TestChangeOne, TestCancel
Who may change or cancel ........................................................... TestWhoMay

The endpoint functions in backend/main.py are called directly on a real in-memory SQLite database
(never Supabase), reusing the US22 test setup. The integration tests check the same through the API.

Run from the repo root:
    python -m unittest discover -s tests/unit/venue -p "test_us41_*.py" -v
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import HTTPException

from test_us22_submit_booking_request import COORDINATOR, OTHER_COORDINATOR, STAFF, DatabaseTestCase
import main
import models
import schemas
import venue_bookings


class US41TestCase(DatabaseTestCase):
    def book(self, event, venue, acknowledged=False, **details):
        body = schemas.BookingRequestCreate(event_id=event.id, acknowledged=acknowledged, **details)
        return main.request_venue_booking(venue.id, body, db=self.db, user=COORDINATOR).booking

    def change(self, booking_id, user=COORDINATOR, **fields):
        return main.change_booking(booking_id, schemas.BookingChange(**fields), db=self.db, user=user)

    def refusal(self, call, *args, **kwargs) -> HTTPException:
        with self.assertRaises(HTTPException) as ctx:
            call(*args, **kwargs)
        return ctx.exception

    def statuses(self):
        return [(b.venue_id, b.status) for b in self.bookings()]

    def stored_event(self, event):
        self.db.expire_all()
        return self.db.get(models.Event, event.id)


class TestSeveralVenues(US41TestCase):
    def test_one_event_can_request_several_venues_at_once(self):
        hall, studio, event = self.venue(name="Hall"), self.venue(name="Studio"), self.event()

        self.book(event, hall)
        self.book(event, studio)

        self.assertEqual(self.statuses(), [(hall.id, "pending"), (studio.id, "pending")])

    def test_each_booking_must_be_for_a_different_venue(self):
        hall, event = self.venue(name="Hall"), self.event()
        self.book(event, hall)

        refused = self.refusal(self.book, event, hall)

        self.assertEqual(refused.status_code, 409)
        self.assertIn("already has a booking for Hall", refused.detail)
        self.assertEqual(len(self.bookings()), 1)

    def test_the_same_venue_can_be_asked_for_again_once_its_booking_is_cancelled(self):
        hall, event = self.venue(name="Hall"), self.event()
        first = self.book(event, hall)
        main.cancel_booking(first.id, db=self.db, user=COORDINATOR)

        self.assertEqual(self.book(event, hall).status, "pending")


class TestEachBookingsNeeds(US41TestCase):
    def test_attendance_layout_and_purpose_are_saved_per_booking(self):
        hall = self.venue(name="Hall", layouts=["theatre"])
        room = self.venue(name="Seminar Room", cap=40, layouts=["classroom"])
        event = self.event(expected_attendance=150, layout="theatre")

        main_room = self.book(event, hall, purpose="Main programme")
        breakout = self.book(event, room, attendance=30, layout="classroom", purpose="Breakout session")

        self.assertEqual((main_room.attendance, main_room.layout, main_room.purpose), (150, "theatre", "Main programme"))
        self.assertEqual((breakout.attendance, breakout.layout, breakout.purpose), (30, "classroom", "Breakout session"))

    def test_without_its_own_needs_a_booking_uses_the_events(self):
        booking = self.book(self.event(expected_attendance=60, layout="theatre"), self.venue())

        self.assertEqual((booking.attendance, booking.layout, booking.purpose), (60, "theatre", None))


class TestCheckedOnItsOwn(US41TestCase):
    def test_suitability_uses_the_bookings_own_attendance_and_layout(self):
        # A 40-seat classroom is unsuitable for the whole 150-person theatre event, but fine for a 30-person breakout.
        room = self.venue(name="Seminar Room", cap=40, layouts=["classroom"])
        event = self.event(expected_attendance=150, layout="theatre")

        self.assertEqual(self.refusal(self.book, event, room).status_code, 409)  # not acknowledged: refused
        breakout = self.book(event, room, attendance=30, layout="classroom")

        self.assertEqual(breakout.verdict, "suitable")
        self.assertIsNone(breakout.override)

    def test_a_venue_held_by_another_event_is_not_free_for_this_one(self):
        hall, studio = self.venue(name="Hall"), self.venue(name="Studio")
        other = self.event(name="Other Event")
        self.decide(self.book(other, studio).id, "approved")
        event = self.event(name="Our Event")

        self.book(event, hall)  # free
        refused = self.refusal(self.book, event, studio)

        self.assertEqual(refused.status_code, 409)
        self.assertIn("Clashes with Other Event", refused.detail)

    def test_each_booking_is_decided_on_its_own(self):
        hall, studio, event = self.venue(name="Hall"), self.venue(name="Studio"), self.event()
        a, b = self.book(event, hall), self.book(event, studio)

        self.decide(a.id, "approved")
        self.decide(b.id, "rejected", "Studio is closed for filming.")

        self.assertEqual(self.statuses(), [(hall.id, "approved"), (studio.id, "rejected")])
        stored = self.stored_event(event)
        self.assertEqual((stored.venue_id, stored.booking_state), (hall.id, "approved"))


class TestSeenTogether(US41TestCase):
    def test_the_coordinator_sees_all_the_events_bookings_with_their_statuses(self):
        hall, studio, lounge, event = self.venue(name="Hall"), self.venue(name="Studio"), self.venue(name="Lounge"), self.event()
        a, b, c = self.book(event, hall), self.book(event, studio), self.book(event, lounge)
        self.decide(a.id, "approved")
        main.cancel_booking(c.id, db=self.db, user=COORDINATOR)

        listed = [(row["venue_name"], row["status"]) for row in main.list_bookings(db=self.db, user=COORDINATOR)
                  if row["event_id"] == event.id]

        self.assertEqual(listed, [("Hall", "approved"), ("Studio", "pending"), ("Lounge", "cancelled")])

    def test_the_events_summary_follows_its_bookings(self):
        hall, studio, event = self.venue(name="Hall"), self.venue(name="Studio"), self.event()
        a, b = self.book(event, hall), self.book(event, studio)
        self.assertEqual((self.stored_event(event).venue_id, self.stored_event(event).booking_state), (hall.id, "pending"))

        self.decide(b.id, "approved")  # the approved one becomes the main venue; one still pending
        self.assertEqual((self.stored_event(event).venue_id, self.stored_event(event).booking_state), (studio.id, "pending"))

        self.decide(a.id, "approved")
        self.assertEqual(self.stored_event(event).booking_state, "approved")


class TestChangeOne(US41TestCase):
    def test_changing_one_pending_booking_leaves_the_others_alone(self):
        hall, studio, event = self.venue(name="Hall"), self.venue(name="Studio"), self.event()
        a, b = self.book(event, hall), self.book(event, studio, purpose="Breakout")

        changed = self.change(b.id, attendance=20, layout="theatre", purpose="Workshop")

        self.assertEqual((changed["attendance"], changed["purpose"], changed["status"]), (20, "Workshop", "pending"))
        untouched = self.db.get(models.VenueBooking, a.id)
        self.assertEqual((untouched.attendance, untouched.purpose, untouched.status), (a.attendance, None, "pending"))

    def test_changing_an_approved_booking_sends_it_back_to_venue_staff(self):
        hall, studio, event = self.venue(name="Hall"), self.venue(name="Studio"), self.event()
        a, b = self.book(event, hall), self.book(event, studio)
        self.decide(a.id, "approved")
        self.decide(b.id, "approved")

        changed = self.change(b.id, attendance=40)

        self.assertEqual((changed["status"], changed["decided_by"]), ("pending", None))
        self.assertEqual(self.statuses(), [(hall.id, "approved"), (studio.id, "pending")])

    def test_a_change_that_makes_the_venue_unsuitable_needs_acknowledging(self):
        room, event = self.venue(name="Room", cap=60), self.event(expected_attendance=50)
        booking = self.book(event, room)

        refused = self.refusal(self.change, booking.id, attendance=80)
        self.assertEqual(refused.status_code, 409)
        self.assertIn("Acknowledge the warning", refused.detail)
        self.assertEqual(self.db.get(models.VenueBooking, booking.id).attendance, 50)

        changed = self.change(booking.id, attendance=80, acknowledged=True)
        self.assertEqual((changed["attendance"], changed["verdict"]), (80, "unsuitable"))
        self.assertIsNotNone(changed["override"])

    def test_a_cancelled_booking_cannot_be_changed(self):
        booking = self.book(self.event(), self.venue())
        main.cancel_booking(booking.id, db=self.db, user=COORDINATOR)

        self.assertEqual(self.refusal(self.change, booking.id, attendance=10).status_code, 409)


class TestCancel(US41TestCase):
    def test_cancelling_one_booking_keeps_the_others(self):
        hall, studio, event = self.venue(name="Hall"), self.venue(name="Studio"), self.event()
        a, b = self.book(event, hall), self.book(event, studio)
        self.decide(a.id, "approved")

        main.cancel_booking(a.id, db=self.db, user=COORDINATOR)

        self.assertEqual(self.statuses(), [(hall.id, "cancelled"), (studio.id, "pending")])
        stored = self.stored_event(event)
        self.assertEqual((stored.venue_id, stored.booking_state), (studio.id, "pending"))
        self.assertEqual([h.venue_id for h in venue_bookings.held_periods(self.db)], [studio.id])

    def test_cancel_all_cancels_every_booking_still_holding_a_venue(self):
        hall, studio, lounge, event = self.venue(name="Hall"), self.venue(name="Studio"), self.venue(name="Lounge"), self.event()
        a, b, c = self.book(event, hall), self.book(event, studio), self.book(event, lounge)
        self.decide(a.id, "approved")
        self.decide(c.id, "rejected", "Not available that day.")

        cancelled = main.cancel_all_bookings(event.id, db=self.db, user=COORDINATOR)

        self.assertEqual(sorted(r["venue_name"] for r in cancelled), ["Hall", "Studio"])
        self.assertEqual(self.statuses(), [(hall.id, "cancelled"), (studio.id, "cancelled"), (lounge.id, "rejected")])
        stored = self.stored_event(event)
        self.assertEqual((stored.venue_id, stored.booking_state), (None, None))

    def test_cancel_all_with_nothing_to_cancel_is_refused(self):
        event = self.event()
        self.assertEqual(self.refusal(main.cancel_all_bookings, event.id, db=self.db, user=COORDINATOR).status_code, 409)

    def test_a_booking_can_only_be_cancelled_once(self):
        booking = self.book(self.event(), self.venue())
        main.cancel_booking(booking.id, db=self.db, user=COORDINATOR)

        self.assertEqual(self.refusal(main.cancel_booking, booking.id, db=self.db, user=COORDINATOR).status_code, 409)


class TestWhoMay(US41TestCase):
    def test_only_the_events_coordinator_may_change_or_cancel(self):
        event = self.event()
        booking = self.book(event, self.venue())

        for call in (lambda: self.change(booking.id, user=OTHER_COORDINATOR, attendance=10),
                     lambda: main.cancel_booking(booking.id, db=self.db, user=OTHER_COORDINATOR),
                     lambda: main.cancel_all_bookings(event.id, db=self.db, user=OTHER_COORDINATOR)):
            with self.subTest():
                with self.assertRaises(HTTPException) as ctx:
                    call()
                self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(self.db.get(models.VenueBooking, booking.id).status, "pending")

    def test_an_unknown_booking_is_not_found(self):
        self.assertEqual(self.refusal(main.cancel_booking, 999, db=self.db, user=COORDINATOR).status_code, 404)


if __name__ == "__main__":
    unittest.main()

"""
Unit tests for US49 — Reassess Venue Bookings After an Accepted Change (split from US35, CR-W7-3).

"As an Event Coordinator, I want the event's venue bookings to be re-evaluated and flagged for reassessment
when a change is accepted so that venue information remains consistent."

AC1: each of the event's venue bookings re-evaluated automatically when a change is accepted ... TestReEvaluated
AC2: bookings that are no longer valid flagged as "Requires Reassessment" ....................... TestFlagged
AC3: the responsible Venue Staff notified of each flagged booking ................................ TestVenueStaffNotified
AC4: confirming the event prevented while flagged arrangements remain unresolved (US50/US51 too) . TestConfirmationBlocked
Clearing a flag: Venue Staff find the booking still valid, or it stops holding the venue ......... TestResolved

The rules (backend/change_reassessment.py) and the endpoint functions in backend/main.py run on a real
in-memory SQLite database (never Supabase), reusing the US44 set-up (tests/unit/safety/safety_testcase.py).

Run from the repo root:
    python -m unittest discover -s tests/unit/accepted_change -v
"""

import sys
import unittest
from datetime import date, datetime, time, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "safety"))

from fastapi import HTTPException

from safety_testcase import NOW, S, SafetyTestCase
import change_reassessment
import event_confirmation
import main
import models
import schemas
import venue_bookings
import venue_reassessment
from booking_request import BookingRefused
from event_changes import ChangeRequestError
from login.models import Role

SAT = date(2027, 1, 9)
TUE = date(2027, 1, 5)


class ChangeTestCase(SafetyTestCase):
    def booked_event(self, name="Career Fair", **fields) -> models.Event:
        """An approved event of Priya's (50 people, theatre, Monday 10:00-12:00) with one approved booking."""
        self.hall = self.venue(name=f"Hall for {name}", cap=fields.pop("cap", 200), layouts=fields.pop("layouts", ["theatre"]))
        return self.ready_event(name, venue=self.hall, **fields)

    def proposal(self, event, text="Move the event and expect more people.") -> models.EventChangeRequest:
        request = models.EventChangeRequest(event_id=event.id, requested_by_id=self.maya.id, requested_at=NOW,
                                            proposed_changes=text, status="pending")
        self.db.add(request)
        self.db.commit()
        return request

    def accept(self, event, request=None, user=None, outcome="accepted", **changes):
        request = request or self.proposal(event)
        body = schemas.EventChangeDecisionIn(outcome=outcome, changes=schemas.AcceptedChangesIn(**changes) if changes else None)
        return main.review_event_change(event.id, request.id, body, db=self.db, user=user or self.priya)

    def bookings_of(self, event) -> list:
        self.db.expire_all()
        return venue_bookings.event_bookings(self.db, event.id)

    def flag(self, booking) -> dict:
        self.db.expire_all()
        return self.db.get(models.VenueBooking, booking.id).reassessment

    def resolve(self, booking, note="The hall takes the extra rows of seating.", user=None):
        return main.resolve_booking_reassessment(booking.id, schemas.ReassessmentResolutionIn(note=note), db=self.db,
                                                 user=user or self.daniel)


class TestReEvaluated(ChangeTestCase):
    """AC1 (CR-W7-3): accepting a change re-checks every booking of the event that holds a venue."""

    def test_US49_AC1_every_booking_is_checked_and_each_result_recorded(self):
        event = self.booked_event()
        breakout = self.book(event, self.venue(name="Seminar Room"), status="pending", attendance=20)

        saved = self.accept(event, pax=60)

        rows = saved.venue_reassessment["bookings"]
        self.assertEqual([r["booking_id"] for r in rows], [b.id for b in self.bookings_of(event)])
        self.assertEqual({r["outcome"] for r in rows}, {"still_valid"})
        self.assertIn(breakout.id, [r["booking_id"] for r in rows])
        self.assertTrue(saved.venue_reassessment["checked_at"])

    def test_US49_AC1_the_accepted_values_are_saved_but_the_event_is_not_edited(self):
        # US34 boundary: accepting records the decision; the event's own details stay as they are.
        event = self.booked_event()
        before = {c.name: getattr(event, c.name) for c in models.Event.__table__.columns}

        saved = self.accept(event, date=TUE, start="14:00", end="16:00", pax=80, layout="Classroom")

        self.assertEqual(saved.accepted_changes, {"date": "2027-01-05", "start": "14:00", "end": "16:00", "pax": 80, "layout": "classroom"})
        stored = self.stored(event)
        self.assertEqual({c.name: getattr(stored, c.name) for c in models.Event.__table__.columns}, before)

    def test_US49_AC1_values_equal_to_the_current_ones_are_not_changes(self):
        event = self.booked_event()
        saved = self.accept(event, date=event.date, start="10:00", pax=50, layout="theatre")
        self.assertEqual(saved.accepted_changes, {})
        self.assertEqual(saved.venue_reassessment["bookings"][0]["outcome"], "still_valid")

    def test_US49_AC1_accepting_without_values_checks_the_bookings_and_flags_nothing(self):
        event = self.booked_event()
        saved = self.accept(event)
        self.assertEqual(saved.accepted_changes, {})
        self.assertEqual(len(saved.venue_reassessment["bookings"]), 1)
        self.assertIsNone(self.flag(self.bookings_of(event)[0]))

    def test_US49_AC1_bookings_that_hold_nothing_are_not_checked(self):
        event = self.booked_event()
        for status in ("cancelled", "rejected", "expired"):
            self.book(event, self.venue(name=f"Room {status}"), status=status)
        saved = self.accept(event, date=TUE)
        self.assertEqual([r["venue_name"] for r in saved.venue_reassessment["bookings"]], [self.hall.name])

    def test_US49_AC1_a_rejected_change_checks_nothing(self):
        event = self.booked_event()
        saved = self.accept(event, outcome="rejected")
        self.assertIsNone(saved.accepted_changes)
        self.assertIsNone(saved.venue_reassessment)

    def test_US49_AC1_B01_values_on_a_rejected_change_are_refused(self):
        event = self.booked_event()
        request = self.proposal(event)
        error = self.refusal(self.accept, event, request, outcome="rejected", pax=80)
        self.assertEqual((error.status_code, error.detail), (422, "Only an accepted change can say what it changes."))
        self.db.expire_all()
        self.assertEqual(self.db.get(models.EventChangeRequest, request.id).status, "pending")

    def test_US49_AC1_B02_a_new_time_must_end_after_it_starts(self):
        event = self.booked_event()
        for changes in ({"start": "13:00"}, {"end": "09:00"}, {"start": "11:00", "end": "11:00"}):
            with self.subTest(changes=changes):
                error = self.refusal(self.accept, event, **changes)
                self.assertEqual((error.status_code, error.detail), (422, "The changed end time must be after the start time."))

    def test_US49_AC1_B03_only_the_coordinator_who_reviews_the_request_triggers_it(self):
        event = self.booked_event()
        error = self.refusal(self.accept, event, user=self.marcus, pax=500)
        self.assertEqual(error.status_code, 403)
        self.assertIsNone(self.flag(self.bookings_of(event)[0]))

    def test_US49_AC1_B04_an_unknown_event_or_request_checks_nothing(self):
        event = self.booked_event()
        body = schemas.EventChangeDecisionIn(outcome="accepted", changes=schemas.AcceptedChangesIn(pax=500))
        for event_id, request_id, detail in ((9999, 1, "Event not found"), (event.id, 9999, "Change request not found")):
            with self.subTest(detail=detail):
                error = self.refusal(main.review_event_change, event_id, request_id, body, db=self.db, user=self.priya)
                self.assertEqual((error.status_code, error.detail), (404, detail))
        self.assertIsNone(self.flag(self.bookings_of(event)[0]))

    def test_US49_AC1_accepted_values_rule_on_its_own(self):
        event = self.booked_event()
        self.assertIsNone(change_reassessment.accepted_values(event, "rejected", None))
        self.assertEqual(change_reassessment.accepted_values(event, "accepted", {"pax": None, "layout": ""}), {})
        with self.assertRaises(ChangeRequestError):
            change_reassessment.accepted_values(event, "rejected", {"pax": 3})


class TestFlagged(ChangeTestCase):
    """AC2: a booking the change makes invalid is "Requires Reassessment", saying why; the others are not."""

    def test_US49_AC2_moving_the_event_flags_its_booking(self):
        event = self.booked_event()
        booking = self.bookings_of(event)[0]

        saved = self.accept(event, date=TUE, start="14:00", end="16:00")

        flag = self.flag(booking)
        self.assertEqual(flag["reason"], "accepted_change")
        self.assertEqual(flag["change_request_id"], saved.id)
        self.assertEqual(flag["problems"], ["The booking holds 04 Jan 2027, 10:00–12:00, but the event moves to 05 Jan 2027, 14:00–16:00."])
        self.assertEqual(flag["message"], (
            f"An accepted change to Career Fair (change request #{saved.id}) means the booking at {self.hall.name} no longer fits: "
            "The booking holds 04 Jan 2027, 10:00–12:00, but the event moves to 05 Jan 2027, 14:00–16:00. "
            "The booking is kept; it needs to be reassessed."))
        self.assertEqual(saved.venue_reassessment["bookings"][0]["outcome"], "requires_reassessment")

    def test_US49_AC2_the_flagged_booking_is_kept_as_it_was(self):
        event = self.booked_event()
        self.accept(event, start="11:00")
        booking = self.bookings_of(event)[0]
        self.assertEqual((booking.status, booking.date, booking.start_time), ("approved", event.date, "10:00"))

    def test_US49_AC2_more_people_than_the_venue_holds_flags_the_whole_event_booking_only(self):
        event = self.booked_event(cap=120)
        breakout = self.book(event, self.venue(name="Seminar Room", cap=40), attendance=30)

        self.accept(event, pax=150)

        main_booking = next(b for b in self.bookings_of(event) if b.id != breakout.id)
        self.assertEqual(self.flag(main_booking)["problems"], ["Capacity 120 is below the expected attendance of 150."])
        self.assertIsNone(self.flag(breakout), "a breakout keeps its own attendance")

    def test_US49_AC2_a_layout_the_venue_does_not_support_is_flagged(self):
        event = self.booked_event(layouts=["theatre"])
        self.accept(event, layout="banquet")
        self.assertEqual(self.flag(self.bookings_of(event)[0])["problems"], ["Does not support a banquet layout."])

    def test_US49_AC2_a_booking_with_its_own_layout_keeps_it(self):
        event = self.booked_event(layouts=["theatre"])
        own = self.book(event, self.venue(name="Studio", layouts=["classroom"]), layout="classroom", attendance=20)
        self.accept(event, layout="banquet")
        self.assertIsNone(self.flag(own))

    def test_US49_AC2_a_new_time_clashing_with_another_event_is_flagged(self):
        event = self.booked_event()
        other = self.event(name="Gala Dinner", date=TUE, start_time=time(11, 0), end_time=time(13, 0),
                           organiser_id=self.maya.id, coordinator_id=self.marcus.id)
        self.book(other, self.hall)

        self.accept(event, date=TUE)

        problems = self.flag(self.bookings_of(event)[0])["problems"]
        self.assertEqual(len(problems), 2)
        self.assertTrue(problems[1].startswith("Clashes with Gala Dinner, already booked on 05 Jan 2027"), problems)

    def test_US49_AC2_a_day_the_venue_is_closed_is_flagged(self):
        event = self.booked_event()
        self.accept(event, date=SAT)
        self.assertIn(f"{self.hall.name} is closed on Saturdays.", self.flag(self.bookings_of(event)[0])["problems"])

    def test_US49_AC2_hours_outside_the_venue_opening_are_flagged(self):
        event = self.booked_event()
        self.accept(event, start="20:00", end="23:00")
        self.assertIn(f"20:00–23:00 is outside {self.hall.name}'s operating hours (08:00 - 22:00).",
                      self.flag(self.bookings_of(event)[0])["problems"])

    def test_US49_AC2_a_problem_the_booking_already_had_is_not_raised_again(self):
        # US21: the coordinator went ahead with a hall too small for the 50 people; a new layout doesn't change that.
        event = self.booked_event(cap=30, layouts=["theatre", "classroom"])
        self.accept(event, layout="classroom")
        self.assertIsNone(self.flag(self.bookings_of(event)[0]))

    def test_US49_AC2_the_flag_reaches_the_api_for_venue_staff_and_the_coordinator(self):
        event = self.booked_event()
        self.accept(event, date=TUE)
        booking = self.bookings_of(event)[0]
        for staff in (True, False):
            with self.subTest(staff=staff):
                record = schemas.VenueBooking(**venue_bookings.to_record(booking, staff=staff))
                self.assertEqual(record.reassessment.reason, "accepted_change")
                self.assertEqual(len(record.reassessment.problems), 1)

    def test_US49_AC2_a_US38_flag_keeps_its_own_shape(self):
        # The shared field still reads a venue-time flag (US38).
        flag = schemas.BookingReassessment(reason="venue_time_changed", message="m", setup_minutes=30,
                                           turnaround_minutes=45, flagged_at=NOW)
        self.assertEqual((flag.problems, flag.change_request_id), ([], None))


class TestVenueStaffNotified(ChangeTestCase):
    """AC3: every Venue Staff member is told of each booking that needs reassessing."""

    def test_US49_AC3_venue_staff_are_told_of_each_flagged_booking(self):
        event = self.booked_event(cap=120)
        self.book(event, self.venue(name="Annex", cap=100))
        alex = self.user("Alex Koh", Role.venue)

        self.accept(event, pax=150)

        for staff in (self.daniel, alex):
            with self.subTest(staff=staff.name):
                titles = [t for t, _ in self.notices(staff) if t == "Booking requires reassessment"]
                self.assertEqual(len(titles), 2)
        bodies = [b for t, b in self.notices(self.daniel) if t == "Booking requires reassessment"]
        self.assertEqual(bodies[0], f"Career Fair: an accepted change means the {self.hall.name} booking for 2027-01-04 needs "
                                    "reassessing. Review it in Bookings.")

    def test_US49_AC3_nobody_is_told_when_every_booking_still_fits(self):
        event = self.booked_event()
        self.accept(event, pax=60)
        self.assertNotIn("Booking requires reassessment", [t for t, _ in self.notices(self.daniel)])

    def test_US49_AC3_inactive_staff_and_uninvolved_people_are_not_told(self):
        event = self.booked_event()
        retired = self.user("Old Staff", Role.venue, active=False)
        self.accept(event, date=TUE)
        for person in (retired, self.wei, self.marcus, self.hannah):
            with self.subTest(person=person.name):
                self.assertNotIn("Booking requires reassessment", [t for t, _ in self.notices(person)])


class TestConfirmationBlocked(ChangeTestCase):
    """AC4: while a flag is unresolved the event can't be confirmed (US14), including flags from US50 and US51."""

    def safety_approved(self, **fields) -> models.Event:
        event = self.booked_event(**fields)
        self.send_to_check(event, self.priya)
        self.decide_check(event, "approved")
        return self.stored(event)

    def test_US49_AC4_a_flagged_booking_is_outstanding_and_confirming_is_refused(self):
        event = self.safety_approved()
        saved = self.accept(event, date=TUE)

        items = event_confirmation.outstanding(self.db, self.stored(event), NOW)
        self.assertEqual(items, [f"The booking at {self.hall.name} requires reassessment after change request #{saved.id}: "
                                 "The booking holds 04 Jan 2027, 10:00–12:00, but the event moves to 05 Jan 2027, 10:00–12:00."])
        error = self.refusal(main.confirm_event, event.id, db=self.db, user=self.priya)
        self.assertEqual(error.status_code, 409)
        self.assertIn("requires reassessment after change request", error.detail)
        self.assertEqual(self.stored(event).status, S.safety_approved)

    def test_US49_AC4_once_reassessed_the_event_can_be_confirmed(self):
        event = self.safety_approved()
        self.accept(event, date=TUE)
        self.resolve(self.bookings_of(event)[0])
        main.confirm_event(event.id, db=self.db, user=self.priya)
        self.assertEqual(self.stored(event).status, S.confirmed)

    def test_US49_AC4_an_equipment_reservation_flagged_by_US50_blocks_confirmation(self):
        event = self.safety_approved()
        stored = self.stored(event)
        stored.equipment = [{"id": "E2", "qty": 2, "status": "reserved", "reassessment": {
            "reason": "accepted_change", "message": "the new time clashes with another reservation.",
            "problems": [], "change_request_id": 1, "flagged_at": NOW.isoformat()}}]
        self.db.commit()
        items = event_confirmation.outstanding(self.db, self.stored(event), NOW)
        self.assertEqual(len(items), 1)
        self.assertTrue(items[0].endswith("requires reassessment: the new time clashes with another reservation."), items)

    def test_US49_AC4_an_unflagged_equipment_line_is_not_outstanding(self):
        event = self.safety_approved()
        self.assertEqual(change_reassessment.change_flags(self.stored(event)), [])


class TestResolved(ChangeTestCase):
    """A flag stays until Venue Staff find the booking still valid, or the booking stops holding the venue."""

    def flagged(self):
        event = self.booked_event()
        saved = self.accept(event, pax=60, start="10:30")
        return event, saved, self.bookings_of(event)[0]

    def test_US49_venue_staff_clear_the_flag_and_the_outcome_is_recorded(self):
        event, saved, booking = self.flagged()

        record = self.resolve(booking)

        self.assertIsNone(record["reassessment"])
        self.assertIsNone(self.flag(booking))
        row = self.db.get(models.EventChangeRequest, saved.id).venue_reassessment["bookings"][0]
        self.assertEqual(row["outcome"], "still_valid")
        self.assertEqual((row["resolution"]["note"], row["resolution"]["by"]), ("The hall takes the extra rows of seating.", "Daniel Ortiz"))
        self.assertEqual(self.bookings_of(event)[0].status, "approved")

    def test_US49_the_coordinator_is_told_the_booking_was_reassessed(self):
        event, _, booking = self.flagged()
        self.resolve(booking, note="Fine at 10:30.")
        self.assertIn(("Booking reassessed", f"Career Fair: Daniel Ortiz reassessed the {self.hall.name} booking for 2027-01-04 "
                                             "after the accepted change and found it still fits: \"Fine at 10:30.\""),
                      self.notices(self.priya))

    def test_US49_B01_a_reason_is_needed(self):
        _, _, booking = self.flagged()
        error = self.refusal(self.resolve, booking, note="   ")
        self.assertEqual((error.status_code, error.detail), (409, "Say why the booking still fits after the change."))
        self.assertIsNotNone(self.flag(booking))

    def test_US49_B02_nothing_to_resolve(self):
        event = self.booked_event()
        booking = self.bookings_of(event)[0]
        self.assertEqual(self.refusal(self.resolve, booking).detail, "This booking doesn't require reassessment.")
        self.assertEqual(self.refusal(main.resolve_booking_reassessment, 9999, schemas.ReassessmentResolutionIn(note="x"),
                                      db=self.db, user=self.daniel).status_code, 404)

    def test_US49_B03_a_US38_flag_clears_only_when_its_clash_is_gone(self):
        event = self.booked_event()
        booking = self.bookings_of(event)[0]
        booking.reassessment = {"reason": "venue_time_changed", "message": "m", "setup_minutes": 30, "turnaround_minutes": 45,
                                "clashes_with": [], "flagged_at": NOW.isoformat()}
        self.db.commit()
        error = self.refusal(self.resolve, booking)
        self.assertEqual(error.detail, "This booking's flag clears itself once the clash with the other booking is gone.")

    def test_US49_B04_a_booking_that_holds_nothing_has_nothing_to_reassess(self):
        _, _, booking = self.flagged()
        booking.status = "cancelled"
        self.db.commit()
        with self.assertRaises(BookingRefused):
            change_reassessment.resolve(self.db, booking, "note", self.daniel, NOW)

    def test_US49_cancelling_the_flagged_booking_drops_its_flag(self):
        # The coordinator replaces the venue: the old booking is cancelled and stops being outstanding.
        _, _, booking = self.flagged()
        venue_bookings.cancel(self.db, [booking])
        self.db.commit()
        self.assertIsNone(self.flag(booking))

    def test_US49_a_venue_time_change_check_keeps_the_accepted_change_flag(self):
        # US38 re-checks bookings whenever one at the venue is decided; it only clears its own flags (and any flag
        # on a booking that is over, so this runs before the event, unlike NOW).
        _, _, booking = self.flagged()
        venue_reassessment.reconcile(self.db, {booking.venue_id}, datetime.now(timezone.utc))
        self.db.commit()
        self.assertEqual(self.flag(booking)["reason"], "accepted_change")


if __name__ == "__main__":
    unittest.main()

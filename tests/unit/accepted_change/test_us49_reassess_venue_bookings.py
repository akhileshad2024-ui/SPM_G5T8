"""
Unit tests for US49 — Reassess Venue Bookings After an Accepted Change (split from US35, CR-W7-3).

"As an Event Coordinator, I want the event's venue bookings to be re-evaluated and flagged for reassessment
when a change is accepted so that venue information remains consistent."

AC1: each of the event's venue bookings re-evaluated automatically when a change is accepted ... TestReEvaluated
AC2: bookings that are no longer valid flagged as "Requires Reassessment" ....................... TestFlagged
AC3: the responsible Venue Staff notified of each flagged booking ................................ TestVenueStaffNotified
AC4: confirming the event prevented while flagged arrangements remain unresolved (US50/US51 too) . TestConfirmationBlocked

US49's venue check (backend/change_reassessment.py) runs inside the shared reassessment of an accepted change
(backend/arrangement_reassessment.py, US50/US51/US45), which saves the flags and resolves them. The endpoint
functions in backend/main.py and backend/reassessment_routes.py run on a real in-memory SQLite database (never
Supabase), reusing the US44 set-up (tests/unit/safety/safety_testcase.py).

Run from the repo root:
    python -m unittest discover -s tests/unit/accepted_change -v
"""

import sys
import unittest
from datetime import date, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "safety"))

from safety_testcase import NOW, S, SafetyTestCase
import arrangement_reassessment
import change_reassessment
import event_confirmation
import main
import models
import reassessment_routes
import schemas
import venue_bookings
from login.models import Role

TUE = date(2027, 1, 5)
SAT = date(2027, 1, 9)


class ChangeTestCase(SafetyTestCase):
    def booked_event(self, name="Career Fair", **fields) -> models.Event:
        """An approved event of Priya's (50 people, theatre, Monday 10:00-12:00) with one approved booking."""
        venue = {key: fields.pop(key) for key in ("cap", "layouts", "accessibility") if key in fields}
        self.hall = self.venue(name=f"Hall for {name}", **venue)
        return self.ready_event(name, venue=self.hall, **fields)

    def proposal(self, event, text="Move the event and expect more people.") -> models.EventChangeRequest:
        request = models.EventChangeRequest(event_id=event.id, requested_by_id=self.maya.id, requested_at=NOW,
                                            proposed_changes=text, status="pending")
        self.db.add(request)
        self.db.commit()
        return request

    def accept(self, event, request=None, user=None, outcome="accepted", **changes) -> models.EventChangeRequest:
        """The coordinator's decision, through the endpoint, naming the reviewed values (`effective_changes`)."""
        request = request or self.proposal(event)
        body = schemas.EventChangeDecisionIn(outcome=outcome, effective_changes=schemas.EventDetailsUpdate(**changes) if changes else None)
        return main.review_event_change(event.id, request.id, body, db=self.db, user=user or self.priya)

    def evaluation(self, request) -> dict:
        self.db.expire_all()
        return self.db.get(models.EventChangeRequest, request.id).decision["reassessment"]

    def flags(self, event) -> list:
        """The event's open venue flags, oldest first."""
        self.db.expire_all()
        return [f for f in arrangement_reassessment.open_flags(self.db, event.id) if f.target_type == "venue"]

    def reasons(self, booking) -> str:
        return " ".join(f.reason for f in self.flags(self.db.get(models.Event, booking.event_id)) if f.target_id == booking.id)

    def main_booking(self, event) -> models.VenueBooking:
        return venue_bookings.event_bookings(self.db, event.id)[0]

    def apply(self, event, request):
        return reassessment_routes.apply_reviewed_changes(event.id, request.id, db=self.db, user=self.priya)

    def resolve(self, event, flag, user=None, note="The hall takes the extra rows of seating."):
        return reassessment_routes.resolve_reassessment(event.id, flag.id, schemas.ReassessmentResolutionIn(note=note),
                                                        db=self.db, user=user or self.daniel)


class TestReEvaluated(ChangeTestCase):
    """AC1 (CR-W7-3): accepting a change re-checks every booking of the event that holds a venue."""

    def test_US49_AC1_every_booking_that_holds_a_venue_is_checked(self):
        event = self.booked_event()
        self.book(event, self.venue(name="Seminar Room"), status="pending", attendance=20)
        for status in ("cancelled", "rejected", "expired"):
            self.book(event, self.venue(name=f"Room {status}"), status=status)

        saved = self.accept(event, pax=60)

        self.assertEqual(self.evaluation(saved)["venue_checked"], 2)
        self.assertEqual(self.flags(event), [])

    def test_US49_AC1_the_event_itself_is_not_edited(self):
        # US34 boundary: the reviewed values are kept with the decision; the event's own details stay as they are.
        event = self.booked_event()
        before = {c.name: getattr(event, c.name) for c in models.Event.__table__.columns}
        saved = self.accept(event, date=TUE, start=time(14), end=time(16), pax=80, layout="classroom")
        self.assertEqual(self.evaluation(saved)["effective_changes"]["pax"], 80)
        stored = self.stored(event)
        self.assertEqual({c.name: getattr(stored, c.name) for c in models.Event.__table__.columns}, before)

    def test_US49_AC1_accepting_without_values_checks_against_the_saved_details_and_flags_nothing(self):
        event = self.booked_event()
        saved = self.accept(event)
        self.assertEqual((self.evaluation(saved)["basis"], self.evaluation(saved)["venue_checked"]), ("saved_details", 1))
        self.assertEqual(self.flags(event), [])

    def test_US49_AC1_a_change_that_doesnt_concern_the_venue_flags_nothing(self):
        event = self.booked_event()
        self.accept(event, name="Career Fair 2027", purpose="Now with alumni talks.")
        self.assertEqual(self.flags(event), [])

    def test_US49_AC1_a_rejected_change_checks_nothing(self):
        event = self.booked_event()
        saved = self.accept(event, outcome="rejected")
        self.assertNotIn("reassessment", self.db.get(models.EventChangeRequest, saved.id).decision)
        self.assertEqual(self.flags(event), [])

    def test_US49_AC1_B01_only_the_assigned_coordinator_triggers_it(self):
        event = self.booked_event()
        error = self.refusal(self.accept, event, user=self.marcus, pax=500)
        self.assertEqual(error.status_code, 403)
        self.assertEqual(self.flags(event), [])

    def test_US49_AC1_B02_an_unknown_event_or_request_checks_nothing(self):
        event = self.booked_event()
        body = schemas.EventChangeDecisionIn(outcome="accepted", effective_changes=schemas.EventDetailsUpdate(pax=500))
        for event_id, request_id, detail in ((9999, 1, "Event not found"), (event.id, 9999, "Change request not found")):
            with self.subTest(detail=detail):
                error = self.refusal(main.review_event_change, event_id, request_id, body, db=self.db, user=self.priya)
                self.assertEqual((error.status_code, error.detail), (404, detail))
        self.assertEqual(self.flags(event), [])


class TestFlagged(ChangeTestCase):
    """AC2: a booking the change makes invalid is "Requires Reassessment", saying why; the others are not."""

    def test_US49_AC2_moving_the_event_flags_its_booking(self):
        event = self.booked_event()
        saved = self.accept(event, date=TUE, start=time(14), end=time(16))

        [flag] = self.flags(event)
        self.assertEqual((flag.target_id, flag.source, flag.source_id), (self.main_booking(event).id, "change_request", saved.id))
        self.assertTrue(flag.reason.startswith(
            "The booking holds 04 Jan 2027, 10:00–12:00, but the event as reviewed is on 05 Jan 2027, 14:00–16:00."), flag.reason)
        self.assertEqual(self.evaluation(saved)["flag_ids"], [flag.id])

    def test_US49_AC2_the_flagged_booking_is_kept_as_it_was(self):
        event = self.booked_event()
        self.accept(event, start=time(11), end=time(12))
        booking = self.main_booking(event)
        self.assertEqual((booking.status, booking.date, booking.start_time), ("approved", event.date, "10:00"))

    def test_US49_AC2_more_people_than_the_venue_holds_flags_the_whole_event_booking_only(self):
        event = self.booked_event(cap=120)
        breakout = self.book(event, self.venue(name="Seminar Room", cap=40), attendance=30)

        self.accept(event, pax=150)

        self.assertEqual(self.reasons(self.main_booking(event)), "Capacity 120 is below the expected attendance of 150.")
        self.assertEqual(self.reasons(breakout), "", "a breakout keeps its own attendance")

    def test_US49_AC2_a_layout_the_venue_does_not_support_is_flagged(self):
        event = self.booked_event(layouts=["theatre"])
        self.accept(event, layout="banquet")
        self.assertEqual(self.reasons(self.main_booking(event)), "Does not support a banquet layout.")

    def test_US49_AC2_a_booking_with_its_own_layout_keeps_it(self):
        event = self.booked_event(layouts=["theatre"])
        own = self.book(event, self.venue(name="Studio", layouts=["classroom"]), layout="classroom", attendance=20)
        self.accept(event, layout="banquet")
        self.assertEqual(self.reasons(own), "")

    def test_US49_AC2_a_newly_needed_accessibility_feature_is_flagged(self):
        event = self.booked_event(accessibility=["Wheelchair Access"])
        self.accept(event, access=["Wheelchair Access", "Hearing Loop"])
        self.assertEqual(self.reasons(self.main_booking(event)), "Hearing Loop is not provided at this venue.")

    def test_US49_AC2_a_new_time_clashing_with_another_event_is_flagged(self):
        event = self.booked_event()
        other = self.event(name="Gala Dinner", date=TUE, start_time=time(11), end_time=time(13),
                           organiser_id=self.maya.id, coordinator_id=self.marcus.id)
        self.book(other, self.hall)

        self.accept(event, date=TUE)

        reasons = self.reasons(self.main_booking(event))
        self.assertIn("but the event as reviewed is on 05 Jan 2027, 10:00–12:00.", reasons)
        self.assertIn("Clashes with Gala Dinner, already booked on 05 Jan 2027", reasons)

    def test_US49_AC2_a_day_the_venue_is_closed_is_flagged(self):
        event = self.booked_event()
        self.accept(event, date=SAT)
        self.assertIn(f"{self.hall.name} is closed on Saturdays.", self.reasons(self.main_booking(event)))

    def test_US49_AC2_hours_outside_the_venue_opening_are_flagged(self):
        event = self.booked_event()
        self.accept(event, start=time(20), end=time(23))
        self.assertIn(f"20:00–23:00 is outside {self.hall.name}'s operating hours (08:00 - 22:00).", self.reasons(self.main_booking(event)))

    def test_US49_AC2_a_problem_the_booking_already_had_is_not_raised_again(self):
        # US21: the coordinator went ahead with a hall too small for the 50 people; a new layout doesn't change that.
        event = self.booked_event(cap=30, layouts=["theatre", "classroom"])
        self.accept(event, layout="classroom")
        self.assertEqual(self.flags(event), [])

    def test_US49_AC2_venue_staff_see_the_flag_with_its_reasons(self):
        event = self.booked_event(cap=120)
        self.accept(event, pax=150)
        summary = reassessment_routes.list_reassessments(event.id, db=self.db, user=self.daniel)
        [flag] = summary["flags"]
        self.assertEqual((flag["targetType"], flag["status"], flag["reason"]),
                         ("venue", "Requires Reassessment", "Capacity 120 is below the expected attendance of 150."))

    def test_US49_AC2_the_rule_on_its_own_without_a_full_reviewed_period(self):
        # A legacy event without a date keeps the booking's own period: nothing to compare it with.
        event = self.booked_event()
        before = arrangement_reassessment.facts(event)
        after = {**before, "date": None}
        self.assertEqual(change_reassessment.booking_problems(self.db, event, self.main_booking(event), before, after, NOW), [])


class TestVenueStaffNotified(ChangeTestCase):
    """AC3: every Venue Staff member is told of each booking that needs reassessing."""

    def test_US49_AC3_venue_staff_are_told_of_each_flagged_booking(self):
        event = self.booked_event(cap=120)
        self.book(event, self.venue(name="Annex", cap=100))
        alex = self.user("Alex Koh", Role.venue)

        self.accept(event, pax=150)

        for staff in (self.daniel, alex):
            with self.subTest(staff=staff.name):
                bodies = sorted(b for t, b in self.notices(staff) if t == "Booking requires reassessment")
                self.assertEqual(bodies, [
                    "Career Fair: an accepted change means the Annex booking for 2027-01-04 needs reassessing. Review it in Bookings.",
                    f"Career Fair: an accepted change means the {self.hall.name} booking for 2027-01-04 needs reassessing. Review it in Bookings.",
                ])

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
        event = self.safety_approved(cap=120)
        self.accept(event, pax=150)
        booking = self.main_booking(event)

        items = event_confirmation.outstanding(self.db, self.stored(event), NOW)
        self.assertIn(f"Venue {booking.id}: Requires Reassessment — Capacity 120 is below the expected attendance of 150.", items)
        error = self.refusal(main.confirm_event, event.id, db=self.db, user=self.priya)
        self.assertEqual(error.status_code, 409)
        self.assertIn("Requires Reassessment", error.detail)
        self.assertEqual(self.stored(event).status, S.safety_approved)

    def test_US49_AC4_once_applied_and_reassessed_the_flag_no_longer_blocks(self):
        event = self.safety_approved(cap=120)
        saved = self.accept(event, pax=150)
        [flag] = self.flags(event)

        # The reviewed values have to be applied first (the event then needs a fresh safety check, US45).
        self.assertEqual(self.refusal(self.resolve, event, flag).status_code, 409)
        self.apply(event, saved)
        self.resolve(event, flag)

        self.assertEqual(self.flags(event), [])
        items = event_confirmation.outstanding(self.db, self.stored(event), NOW)
        self.assertFalse([i for i in items if "Requires Reassessment" in i], items)

    def test_US49_AC4_B01_a_resolution_needs_a_note_and_the_responsible_staff(self):
        event = self.booked_event(cap=120)
        saved = self.accept(event, pax=150)
        self.apply(event, saved)
        [flag] = self.flags(event)
        self.assertEqual(self.refusal(self.resolve, event, flag, note="   ").status_code, 422)
        self.assertEqual(self.refusal(self.resolve, event, flag, user=self.wei).status_code, 403)
        self.assertEqual(len(self.flags(event)), 1)

    def test_US49_AC4_a_flag_from_another_story_blocks_confirmation_too(self):
        # US50/US51 save their flags in the same table; every open one is outstanding.
        event = self.safety_approved()
        arrangement_reassessment.add_flag(self.db, event, "change_request", 1, "registration", event.id,
                                          ["Registration capacity is below the number already registered."], {}, NOW)
        self.db.commit()
        items = event_confirmation.outstanding(self.db, self.stored(event), NOW)
        self.assertIn(f"Registration {event.id}: Requires Reassessment — Registration capacity is below the number already registered.", items)


if __name__ == "__main__":
    unittest.main()

"""
Unit tests for US14 — Confirm Event (Week 7 changes CR-W7-2, CR-W7-3, CR-W7-6).

"As an Event Coordinator, I want to confirm an event once its essential arrangements are complete so that
the Event Organiser knows the arrangements are finalised."

AC1: only when every venue booking is approved and all required equipment is reserved ...... TestArrangementsComplete
AC2: refused while arrangements are outstanding, with each outstanding item listed .......... TestOutstandingListed
AC3: status set to Confirmed with a timestamp recorded ...................................... TestConfirmed
AC4: the organiser and all involved staff are notified ...................................... TestNotified
AC5: specified event fields locked from further editing after confirmation .................. TestLocked
AC6: refused while any venue booking is flagged as needing alternative arrangements ......... TestFlaggedBookings
AC7: only after the Safety Officer has approved the Operational Safety Check (US44) ......... TestSafetyApproved

The rules (backend/event_review/confirmation.py) and the endpoint functions in backend/main.py run on a real in-memory
SQLite database (never Supabase), reusing the US44 set-up (safety_testcase.py).

Run from the repo root:
    python -m unittest discover -s tests/unit/safety -p "test_us14_*.py" -v
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from safety_testcase import NOW, S, SafetyTestCase
import event_review.confirmation as event_confirmation
import main
import models
import schemas
from equipment.service import RequestIn, save_request
from event_review.service import ReviewError
from auth.models import Role


class ConfirmTestCase(SafetyTestCase):
    def safety_approved(self, name="Career Fair", **fields) -> models.Event:
        """An event of Priya's with its one venue booking approved, sent to and approved by the safety check."""
        event = self.waiting_event(name, **fields)
        self.decide_check(event, "approved")
        return event

    def confirm(self, event, user=None):
        return main.confirm_event(event.id, db=self.db, user=user or self.priya)

    def outstanding(self, event):
        return event_confirmation.outstanding(self.db, self.stored(event), NOW)

    def with_equipment(self, event, *lines, tech=None):
        """Give the event equipment lines (as US25/US28 store them) and an assigned technician."""
        event = self.stored(event)
        event.equipment = [dict(line) for line in lines]
        event.equipment_state = "reserved" if all(l.get("status") in ("reserved", "fulfilled") for l in lines) else "requested"
        self.db.add(models.EquipmentAssignment(event_id=event.id, tech_id=(tech or self.wei).id))
        self.db.commit()
        return event


class TestArrangementsComplete(ConfirmTestCase):
    def test_US14_AC1_an_event_with_every_arrangement_complete_can_be_confirmed(self):
        event = self.safety_approved()

        self.assertEqual(self.outstanding(event), [])
        self.assertEqual(self.confirm(event).status, "confirmed")

    def test_US14_AC1_every_one_of_several_venue_bookings_must_be_approved(self):
        # CR-W7-3: an event with a main hall and a breakout room needs both approved.
        event = self.safety_approved("Research Conference")
        self.book(event, self.venue(name="Breakout Room"), status="pending")

        self.assertEqual(self.outstanding(event),
                         ["The booking at Breakout Room is still waiting for Venue Staff's approval."])
        self.assertEqual(self.refusal(self.confirm, event).status_code, 409)

    def test_US14_AC1_an_event_with_no_venue_booked_cannot_be_confirmed(self):
        event = self.safety_approved()
        booking = self.db.query(models.VenueBooking).filter_by(event_id=event.id).one()
        booking.status = "cancelled"
        self.db.commit()

        self.assertIn("No venue is booked for this event.", self.outstanding(event))

    def test_US14_AC1_rejected_and_cancelled_bookings_are_not_counted(self):
        event = self.safety_approved()
        self.book(event, self.venue(name="Rejected Room"), status="rejected")
        self.book(event, self.venue(name="Cancelled Room"), status="cancelled")

        self.assertEqual(self.outstanding(event), [])

    def test_US14_AC1_all_required_equipment_must_be_reserved(self):
        event = self.with_equipment(self.safety_approved(),
                                    {"id": "E1", "qty": 2, "status": "reserved"}, {"id": "E2", "qty": 1, "status": "pending"})

        self.assertEqual(self.outstanding(event), ["1 × Projector is not yet reserved by Technical Support."])

    def test_US14_AC1_fulfilled_equipment_counts_as_reserved(self):
        event = self.with_equipment(self.safety_approved(),
                                    {"id": "E1", "qty": 2, "status": "fulfilled"}, {"id": "E2", "qty": 1, "status": "reserved"})

        self.assertEqual(self.outstanding(event), [])
        self.assertEqual(self.confirm(event).status, "confirmed")

    def test_US14_AC1_an_event_that_needs_no_equipment_has_nothing_to_reserve(self):
        self.assertEqual(self.outstanding(self.safety_approved()), [])

    def test_US14_AC1_only_the_events_assigned_coordinator_can_confirm(self):
        event = self.safety_approved()
        for user in (self.marcus, self.maya, self.grace, self.hannah, self.daniel, self.wei):
            with self.subTest(user=user.name):
                self.assertEqual(self.refusal(self.confirm, event, user).status_code, 403)
        self.assertEqual(self.stored(event).status, S.safety_approved)

    def test_US14_AC1_the_rule_itself_checks_who_is_confirming(self):
        # Defence in depth: called without the route's role check.
        event = self.safety_approved()
        with self.assertRaises(ReviewError) as ctx:
            event_confirmation.confirm(self.db, event, self.grace, NOW)
        self.assertEqual((ctx.exception.status_code, ctx.exception.message),
                         (403, "Only the event's assigned coordinator can confirm it."))

    def test_US14_AC1_the_confirm_route_admits_only_coordinators(self):
        route = next(r for r in main.app.routes if getattr(r, "path", None) == "/events/{event_id}/confirm" and "POST" in r.methods)
        guard = next(d.call for d in route.dependant.dependencies if d.call.__qualname__ == "require_roles.<locals>.dependency")
        self.assertIs(guard(user=self.priya), self.priya)
        for user in (self.maya, self.grace, self.hannah, self.daniel, self.wei):
            with self.subTest(role=user.role.value):
                self.assertEqual(self.refusal(guard, user=user).status_code, 403)

    def test_US14_AC1_an_unknown_event_is_not_found(self):
        self.assertEqual(self.refusal(main.confirm_event, 9999, db=self.db, user=self.priya).status_code, 404)


class TestOutstandingListed(ConfirmTestCase):
    def test_US14_AC2_every_outstanding_item_is_listed_in_order(self):
        # An approved event, not yet through the safety check: a pending booking and unreserved equipment.
        event = self.ready_event("Open House")
        self.book(event, self.venue(name="Overflow Hall"), status="pending")
        event = self.with_equipment(event, {"id": "E3", "qty": 2, "status": "pending"})

        self.assertEqual(self.outstanding(event), [
            "The booking at Overflow Hall is still waiting for Venue Staff's approval.",
            "2 × PA system is not yet reserved by Technical Support.",
            "The Safety Officer hasn't approved the Operational Safety Check yet (the event is Approved).",
        ])

    def test_US14_AC2_the_refusal_names_each_item_and_nothing_is_saved(self):
        event = self.ready_event("Open House")
        self.book(event, self.venue(name="Overflow Hall"), status="pending")

        err = self.refusal(self.confirm, event)

        self.assertEqual(err.status_code, 409)
        self.assertEqual(err.detail, "Can't confirm yet. Outstanding: "
                                     "(1) The booking at Overflow Hall is still waiting for Venue Staff's approval. "
                                     "(2) The Safety Officer hasn't approved the Operational Safety Check yet (the event is Approved).")
        self.assertEqual(self.stored(event).status, S.approved)
        self.assertIsNone(self.stored(event).confirmed_at)

    def test_US14_AC2_the_readiness_view_lists_the_same_items(self):
        event = self.ready_event("Open House")

        shown = main.event_confirmation_status(event.id, db=self.db, user=self.priya)

        self.assertEqual((shown.ready, shown.confirmed), (False, False))
        self.assertEqual(shown.outstanding, ["The Safety Officer hasn't approved the Operational Safety Check yet (the event is Approved)."])

    def test_US14_AC2_a_ready_event_shows_as_ready(self):
        shown = main.event_confirmation_status(self.safety_approved().id, db=self.db, user=self.priya)

        self.assertEqual((shown.ready, shown.outstanding), (True, []))

    def test_US14_AC2_the_readiness_view_is_only_for_people_involved(self):
        event = self.safety_approved()
        self.assertEqual(self.refusal(main.event_confirmation_status, event.id, db=self.db, user=self.marcus).status_code, 403)
        self.assertEqual(self.refusal(main.event_confirmation_status, 9999, db=self.db, user=self.priya).status_code, 404)

    def test_US14_AC2_events_not_yet_approved_cannot_be_confirmed(self):
        for status in (S.submitted, S.under_review, S.pending_clarification, S.rejected, S.cancelled):
            with self.subTest(status=status.value):
                event = self.event(name=f"Early {status.value}", status=status, organiser_id=self.maya.id, coordinator_id=self.priya.id)
                with self.assertRaises(ReviewError) as ctx:
                    event_confirmation.confirm(self.db, event, self.priya, NOW)
                self.assertEqual(ctx.exception.status_code, 409)
                self.assertTrue(ctx.exception.message.startswith("Only an approved event can be confirmed"))


class TestConfirmed(ConfirmTestCase):
    def test_US14_AC3_the_status_is_confirmed_with_who_and_when_recorded(self):
        event = self.safety_approved()

        self.confirm(event)

        stored = self.stored(event)
        self.assertEqual((stored.status, stored.confirmed_by_id), (S.confirmed, self.priya.id))
        self.assertIsNotNone(stored.confirmed_at)

    def test_US14_AC3_the_change_is_in_the_status_history(self):
        event = self.safety_approved()

        self.confirm(event)

        self.assertEqual(self.history(event)[-1][:3], (S.safety_approved, S.confirmed, self.priya.id))

    def test_US14_AC3_the_readiness_view_shows_when_and_by_whom(self):
        event = self.safety_approved()
        self.confirm(event)

        shown = main.event_confirmation_status(event.id, db=self.db, user=self.maya)

        self.assertEqual((shown.confirmed, shown.ready, shown.outstanding, shown.confirmedBy), (True, False, [], "Priya Tan"))
        self.assertIsNotNone(shown.confirmedAt.tzinfo)

    def test_US14_AC3_a_confirmed_event_cannot_be_confirmed_again(self):
        event = self.safety_approved()
        self.confirm(event)

        err = self.refusal(self.confirm, event)

        self.assertEqual((err.status_code, err.detail), (409, "This event is already confirmed."))


class TestNotified(ConfirmTestCase):
    def test_US14_AC4_the_organiser_venue_staff_and_technician_are_told(self):
        event = self.with_equipment(self.safety_approved(), {"id": "E1", "qty": 2, "status": "reserved"})

        self.confirm(event)

        for person in (self.maya, self.daniel, self.wei):
            with self.subTest(person=person.name):
                self.assertIn("Event confirmed", [title for title, _ in self.notices(person)])
        body = dict(self.notices(self.maya))["Event confirmed"]
        self.assertTrue(body.startswith("Career Fair on ") and body.endswith("is confirmed. All arrangements are final."))

    def test_US14_AC4_the_coordinator_who_confirmed_is_not_notified_of_their_own_action(self):
        event = self.safety_approved()

        self.confirm(event)

        self.assertNotIn("Event confirmed", [title for title, _ in self.notices(self.priya)])

    def test_US14_AC4_a_refused_confirmation_notifies_nobody(self):
        event = self.ready_event("Open House")

        self.refusal(self.confirm, event)

        self.assertNotIn("Event confirmed", [title for title, _ in self.notices(self.maya)])


class TestLocked(ConfirmTestCase):
    def test_US14_AC5_the_locked_fields_are_the_event_details_and_equipment(self):
        self.assertEqual(set(event_confirmation.LOCKED_AFTER_CONFIRMATION), {
            "name", "purpose", "eventType", "pax", "date", "start", "end", "venueLocation", "venueCapacity",
            "layout", "facilities", "access", "equip", "reg", "regCap", "regClose", "equipment",
        })

    def test_US14_AC5_event_details_cannot_be_edited_once_confirmed(self):
        event = self.safety_approved()
        self.confirm(event)

        err = self.refusal(main.update_event_details, event.id, schemas.EventDetailsUpdate(pax=999), db=self.db, user=self.priya)

        self.assertEqual(err.status_code, 409)
        self.assertNotEqual(self.stored(event).expected_attendance, 999)

    def test_US14_AC5_the_equipment_request_cannot_be_edited_once_confirmed(self):
        event = self.safety_approved()
        self.confirm(event)

        body = RequestIn(techId=self.wei.id, lines=[{"id": "E1", "qty": 3, "technicalRequirements": ""}])
        err = self.refusal(save_request, event.id, body, db=self.db, user=self.priya)

        self.assertEqual(err.status_code, 409)

    def test_US14_AC5_the_readiness_view_names_the_locked_fields(self):
        shown = main.event_confirmation_status(self.safety_approved().id, db=self.db, user=self.priya)

        self.assertEqual(shown.lockedFields, list(event_confirmation.LOCKED_AFTER_CONFIRMATION))


class TestFlaggedBookings(ConfirmTestCase):
    def test_US14_AC6_a_booking_whose_venue_became_unavailable_blocks_confirmation(self):
        event = self.safety_approved()
        booking = self.db.query(models.VenueBooking).filter_by(event_id=event.id).one()
        booking.flag = {"kind": "venue_unavailable", "message": "Hall for Career Fair is unavailable (maintenance)."}
        self.db.commit()

        self.assertEqual(self.outstanding(event), [
            "The booking at Hall for Career Fair needs alternative arrangements: Hall for Career Fair is unavailable (maintenance).",
        ])
        self.assertEqual(self.refusal(self.confirm, event).status_code, 409)

    def test_US14_AC6_a_booking_requiring_reassessment_blocks_confirmation(self):
        event = self.safety_approved()
        booking = self.db.query(models.VenueBooking).filter_by(event_id=event.id).one()
        booking.reassessment = {"message": "The venue's setup time changed."}
        self.db.commit()

        self.assertEqual(self.outstanding(event),
                         ["The booking at Hall for Career Fair requires reassessment: The venue's setup time changed."])

    def test_US14_AC6_a_flag_without_a_message_is_still_listed(self):
        event = self.safety_approved()
        booking = self.db.query(models.VenueBooking).filter_by(event_id=event.id).one()
        booking.flag, booking.reassessment = {"kind": "venue_unavailable"}, {"reason": "venue_time_changed"}
        self.db.commit()

        self.assertEqual(self.outstanding(event), [
            "The booking at Hall for Career Fair needs alternative arrangements: its venue became unavailable.",
            "The booking at Hall for Career Fair requires reassessment: its venue times changed.",
        ])

    def test_US14_AC6_a_lapsed_tentative_hold_does_not_count_as_a_booking(self):
        event = self.safety_approved()
        self.book(event, self.venue(name="Old Hold"), status="pending")
        hold = self.db.query(models.VenueBooking).filter_by(event_id=event.id, venue_name="Old Hold").one()
        hold.hold_expires_at = NOW.replace(year=2026)  # long past
        self.db.commit()

        self.assertEqual(self.outstanding(event), [])


class TestSafetyApproved(ConfirmTestCase):
    def test_US14_AC7_an_approved_event_cannot_skip_the_safety_check(self):
        # The status table still allows Approved -> Confirmed (US13/US44); US14's rule refuses it.
        event = self.ready_event()

        err = self.refusal(self.confirm, event)

        self.assertEqual(err.status_code, 409)
        self.assertIn("The Safety Officer hasn't approved the Operational Safety Check yet (the event is Approved).", err.detail)
        self.assertEqual(self.stored(event).status, S.approved)

    def test_US14_AC7_every_step_of_the_safety_check_short_of_approval_is_refused(self):
        waiting = self.waiting_event("Waiting")
        changes = self.waiting_event("Changes")
        self.decide_check(changes, "changes_requested", "Add a second exit marshal.")
        rejected = self.waiting_event("Rejected")
        self.decide_check(rejected, "rejected", "Over capacity for the fire exits.")
        for event, shown in ((waiting, "Pending Safety Review"), (changes, "Safety Changes Requested"), (rejected, "Safety Rejected")):
            with self.subTest(status=shown):
                self.assertEqual(self.outstanding(event),
                                 [f"The Safety Officer hasn't approved the Operational Safety Check yet (the event is {shown})."])
                self.assertEqual(self.refusal(self.confirm, event).status_code, 409)

    def test_US14_AC7_once_the_safety_officer_approves_it_can_be_confirmed(self):
        event = self.waiting_event()
        self.assertEqual(self.refusal(self.confirm, event).status_code, 409)

        self.decide_check(event, "approved")

        self.assertEqual(self.confirm(event).status, "confirmed")


if __name__ == "__main__":
    unittest.main()

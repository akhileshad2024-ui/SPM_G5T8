"""
Unit tests for US12 — Reassign Event Coordinator (Week 7 change CR-W7-5).

"As an Event Coordinator Lead, I want to reassign an event to another Event Coordinator so that
coordination can continue when staff availability or responsibilities change."

AC1: the Lead can change the assigned coordinator on an existing event ........ TestReassign
AC2: a reason must be recorded ................................................ TestReasonRequired
AC3: the previous coordinator loses access and the new one gains it .......... TestAccessMoves
AC4: outgoing and incoming coordinators and the organiser are notified ........ TestNotified
AC5: the Lead can view the complete assignment history ........................ TestHistory

The rules (backend/event_review.py) and the endpoint functions in backend/main.py are called directly on
a real in-memory SQLite database (never Supabase), reusing the US11/US43 set-up (lead_testcase.py).

Run from the repo root:
    python -m unittest discover -s tests/unit/lead_assignment -p "test_us12_*.py" -v
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lead_testcase import CLOSED, NOW, LeadTestCase, S
import event_review
import main
import models
import schemas
from event_access import is_involved
from login.models import Role

REASON = "Priya is on leave for the next two weeks."


class ReassignTestCase(LeadTestCase):
    def reassign(self, event, coordinator, reason=REASON, user=None):
        body = schemas.ReassignCoordinatorIn(coordinatorId=coordinator.id, reason=reason)
        return main.reassign_coordinator(event.id, body, db=self.db, user=user or self.grace)

    def assigned(self, name="Charity Gala", status=S.under_review):
        """An event the Lead has assigned to Priya (through US11, so its first assignment is recorded)."""
        event = self.request(name, status=S.submitted)
        self.assign(event, self.priya)
        if status != S.submitted:
            event.status = status
            self.db.commit()
        return event

    def notices(self, user):
        self.db.expire_all()
        return [(n.title, n.body) for n in self.db.query(models.Notification).filter(models.Notification.recipient_id == user.id)]


class TestReassign(ReassignTestCase):
    def test_US12_AC1_the_lead_moves_an_assigned_event_to_another_coordinator(self):
        event = self.assigned()

        shown = self.reassign(event, self.marcus)

        self.assertEqual((shown.coordinator, shown.coordinatorId), ("Marcus Lee", self.marcus.id))
        self.db.expire_all()
        self.assertEqual(self.db.get(models.Event, event.id).coordinator_id, self.marcus.id)

    def test_US12_AC1_the_event_keeps_its_status_and_details(self):
        event = self.assigned(status=S.approved)

        shown = self.reassign(event, self.marcus)

        self.assertEqual((shown.status, shown.name), ("approved", "Charity Gala"))

    def test_US12_AC1_the_event_shows_the_new_assignment(self):
        event = self.assigned()

        shown = self.reassign(event, self.marcus)

        self.assertEqual(shown.assignedBy, "Grace Ong")

    def test_US12_AC1_every_live_status_can_be_reassigned(self):
        for status in (S.submitted, S.under_review, S.pending_clarification, S.approved, S.confirmed):
            with self.subTest(status=status):
                event = self.assigned(f"Event {status.value}", status=status)
                self.assertEqual(self.reassign(event, self.marcus).coordinator, "Marcus Lee")

    def test_US12_AC1_closed_events_cannot_be_reassigned(self):
        # Drafts, rejected and cancelled events aren't live, so the Lead can't even see them (US43).
        for status in CLOSED:
            with self.subTest(status=status):
                event = self.request(f"Closed {status.value}", status=status, coordinator=self.priya)
                self.assertEqual(self.refusal(self.reassign, event, self.marcus).status_code, 403)
                self.db.expire_all()
                self.assertEqual(self.db.get(models.Event, event.id).coordinator_id, self.priya.id)

    def test_US12_AC1_only_the_lead_can_reassign(self):
        event = self.assigned()
        # The route allows only the Lead; the rule checks again, so even the event's own coordinator is refused.
        for person in (self.priya, self.maya, self.daniel):
            with self.subTest(role=person.role):
                self.assertEqual(self.refusal(self.reassign, event, self.marcus, user=person).status_code, 403)
        self.db.expire_all()
        self.assertEqual(self.db.get(models.Event, event.id).coordinator_id, self.priya.id)

    def test_US12_AC1_the_rule_itself_refuses_closed_events(self):
        # Defence in depth: called without the route (which already hides closed events from the Lead).
        for status in (S.rejected, S.cancelled):
            with self.subTest(status=status):
                event = self.request(f"Rule {status.value}", status=status, coordinator=self.priya)
                with self.assertRaises(event_review.ReviewError) as ctx:
                    event_review.reassign(self.db, event, self.grace, self.marcus.id, REASON, NOW)
                self.assertEqual((ctx.exception.status_code, ctx.exception.message),
                                 (409, f"A coordinator can't be reassigned while the event is {status.value}."))

    def test_US12_AC1_the_reassign_route_admits_only_the_lead(self):
        # The web layer's own check, taken from the route itself: everyone but the Lead gets 403 before the rule runs.
        route = next(r for r in main.app.routes if getattr(r, "path", None) == "/events/{event_id}/reassign" and "POST" in r.methods)
        guard = next(d.call for d in route.dependant.dependencies if d.call.__qualname__ == "require_roles.<locals>.dependency")
        self.assertIs(guard(user=self.grace), self.grace)
        for person in (self.priya, self.maya, self.daniel):
            with self.subTest(role=person.role):
                self.assertEqual(self.refusal(guard, user=person).status_code, 403)

    def test_US12_AC1_an_unassigned_event_must_be_assigned_not_reassigned(self):
        event = self.request("Open Day")

        err = self.refusal(self.reassign, event, self.marcus)

        self.assertEqual((err.status_code, err.detail), (409, "This event has no coordinator yet. Assign one instead."))

    def test_US12_AC1_cannot_reassign_to_the_current_coordinator(self):
        event = self.assigned()

        err = self.refusal(self.reassign, event, self.priya)

        self.assertEqual((err.status_code, err.detail), (409, "Priya Tan is already coordinating this event."))

    def test_US12_AC1_only_an_active_event_coordinator_can_take_over(self):
        event = self.assigned()
        retired = self.user("Aisha Noor", Role.coordinator, active=False)
        for person in (self.maya, self.grace, self.daniel, retired):
            with self.subTest(person=person.name):
                err = self.refusal(self.reassign, event, person)
                self.assertEqual((err.status_code, err.detail), (422, f"{person.name} is not an Event Coordinator."))

    def test_US12_AC1_an_unknown_event_is_not_found(self):
        body = schemas.ReassignCoordinatorIn(coordinatorId=self.marcus.id, reason=REASON)

        err = self.refusal(main.reassign_coordinator, 9999, body, db=self.db, user=self.grace)

        self.assertEqual(err.status_code, 404)


class TestReasonRequired(ReassignTestCase):
    def test_US12_AC2_a_reason_is_required(self):
        event = self.assigned()
        for blank in ("", "   "):
            with self.subTest(reason=repr(blank)):
                err = self.refusal(self.reassign, event, self.marcus, reason=blank)
                self.assertEqual((err.status_code, err.detail), (422, "Reassignment reason is required."))
        self.db.expire_all()
        self.assertEqual(self.db.get(models.Event, event.id).coordinator_id, self.priya.id)

    def test_US12_AC2_B01_a_reason_of_1000_characters_is_accepted(self):
        event = self.assigned()

        self.assertEqual(self.reassign(event, self.marcus, reason="a" * 1000).coordinator, "Marcus Lee")

    def test_US12_AC2_B02_a_reason_of_1001_characters_is_refused(self):
        event = self.assigned()

        err = self.refusal(self.reassign, event, self.marcus, reason="a" * 1001)

        self.assertEqual((err.status_code, err.detail), (422, "Reassignment reason must be 1000 characters or fewer."))

    def test_US12_AC2_the_reason_is_saved_trimmed_with_who_and_when(self):
        event = self.assigned()

        self.reassign(event, self.marcus, reason=f"  {REASON}  ")

        self.db.expire_all()
        row = self.db.query(models.EventAssignment).filter_by(event_id=event.id).order_by(models.EventAssignment.id.desc()).first()
        self.assertEqual((row.coordinator_id, row.previous_coordinator_id, row.assigned_by_id, row.reason),
                         (self.marcus.id, self.priya.id, self.grace.id, REASON))
        self.assertIsNotNone(row.assigned_at)


class TestAccessMoves(ReassignTestCase):
    def test_US12_AC3_the_previous_coordinator_loses_access_and_the_new_one_gains_it(self):
        event = self.assigned()
        self.assertTrue(is_involved(event, self.priya))
        self.assertFalse(is_involved(event, self.marcus))

        self.reassign(event, self.marcus)

        self.db.expire_all()
        event = self.db.get(models.Event, event.id)
        self.assertFalse(is_involved(event, self.priya))
        self.assertTrue(is_involved(event, self.marcus))

    def test_US12_AC3_the_queues_follow_the_reassignment(self):
        event = self.assigned()

        self.reassign(event, self.marcus)

        self.assertNotIn("Charity Gala", self.visible(self.priya))
        self.assertIn("Charity Gala", self.visible(self.marcus))
        self.assertIn("Charity Gala", self.visible(self.grace))  # the Lead still oversees it

    def test_US12_AC3_the_previous_coordinator_can_no_longer_act_on_it(self):
        event = self.assigned(status=S.under_review)
        self.reassign(event, self.marcus)

        err = self.refusal(main.request_clarification, event.id,
                           schemas.ClarificationIn(kind="clarification", message="Any update?"), db=self.db, user=self.priya)

        self.assertEqual(err.status_code, 403)

    def test_US12_AC3_the_new_coordinator_can_continue_the_review(self):
        event = self.assigned(status=S.under_review)
        self.reassign(event, self.marcus)

        shown = main.decide_request(event.id, schemas.DecisionIn(outcome="approved", reason=""), db=self.db, user=self.marcus)

        self.assertEqual(shown.status, "approved")

    def test_US12_AC3_a_refused_reassignment_changes_nobodys_access(self):
        event = self.assigned()

        self.refusal(self.reassign, event, self.marcus, reason="")

        self.assertIn("Charity Gala", self.visible(self.priya))
        self.assertNotIn("Charity Gala", self.visible(self.marcus))


class TestNotified(ReassignTestCase):
    def test_US12_AC4_the_outgoing_coordinator_is_notified(self):
        event = self.assigned()

        self.reassign(event, self.marcus)

        self.assertIn(("Event reassigned",
                       "Charity Gala: Grace Ong reassigned this event to another coordinator. You no longer manage it."),
                      self.notices(self.priya))

    def test_US12_AC4_the_incoming_coordinator_is_notified(self):
        event = self.assigned()

        self.reassign(event, self.marcus)

        self.assertIn(("Event assigned to you",
                       "Charity Gala: Grace Ong reassigned this event to you. Open it from your queue to continue planning."),
                      self.notices(self.marcus))

    def test_US12_AC4_the_organiser_is_notified(self):
        event = self.assigned()

        self.reassign(event, self.marcus)

        self.assertIn(("New coordinator", "Charity Gala: a new Event Coordinator is now handling your event."), self.notices(self.maya))

    def test_US12_AC4_a_refused_reassignment_notifies_nobody(self):
        event = self.assigned()
        before = {p.id: len(self.notices(p)) for p in (self.priya, self.marcus, self.maya)}

        self.refusal(self.reassign, event, self.marcus, reason="")

        self.assertEqual({p.id: len(self.notices(p)) for p in (self.priya, self.marcus, self.maya)}, before)


class TestHistory(ReassignTestCase):
    def history(self, event, user=None):
        return main.event_assignment_history(event.id, db=self.db, user=user or self.grace)

    def test_US12_AC5_the_history_lists_every_assignment_oldest_first(self):
        event = self.assigned()
        self.reassign(event, self.marcus)
        self.reassign(event, self.priya, reason="Back from leave.")

        rows = self.history(event)

        self.assertEqual([(r["coordinator"], r["previousCoordinator"], r["assignedBy"], r["reason"]) for r in rows], [
            ("Priya Tan", None, "Grace Ong", None),
            ("Marcus Lee", "Priya Tan", "Grace Ong", REASON),
            ("Priya Tan", "Marcus Lee", "Grace Ong", "Back from leave."),
        ])
        self.assertTrue(all(r["assignedAt"].tzinfo is not None for r in rows))

    def test_US12_AC5_an_event_never_assigned_has_an_empty_history(self):
        self.assertEqual(self.history(self.request("Open Day")), [])

    def test_US12_AC5_the_current_coordinator_and_organiser_can_see_it_too(self):
        event = self.assigned()
        self.reassign(event, self.marcus)

        for person in (self.marcus, self.maya):
            with self.subTest(person=person.name):
                self.assertEqual(len(self.history(event, user=person)), 2)

    def test_US12_AC5_the_previous_coordinator_and_others_cannot(self):
        event = self.assigned()
        self.reassign(event, self.marcus)

        for person in (self.priya, self.daniel):
            with self.subTest(person=person.name):
                self.assertEqual(self.refusal(self.history, event, user=person).status_code, 403)

    def test_US12_AC5_an_unknown_event_is_not_found(self):
        err = self.refusal(main.event_assignment_history, 9999, db=self.db, user=self.grace)

        self.assertEqual(err.status_code, 404)


if __name__ == "__main__":
    unittest.main()

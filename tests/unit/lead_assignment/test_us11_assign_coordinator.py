"""
Unit tests for US11 — Assign Event Coordinator.

"As an Event Coordinator Lead, I want to assign an Event Coordinator to a submitted event so that the
event has a responsible internal contact."

AC1: only the Event Coordinator accounts can be chosen ............... TestCoordinatorList
AC2: the Lead assigns a coordinator to a submitted event ............. TestAssign
AC3: the assigning user and the time are recorded .................... TestAssignmentRecorded
AC4: the assigned coordinator is given access ........................ TestAssignedCoordinatorGetsAccess
AC5: someone who isn't an Event Coordinator can't be assigned ........ TestOnlyCoordinators

The rules (backend/event_review.py) and the endpoint functions in backend/main.py are called directly on
a real in-memory SQLite database (never Supabase). Who may assign (only the Lead) and what each role sees
is US43 (test_us43_lead_oversight.py). The "Event assigned to you" notice is a frontend unit test
(tests/unit/event-review/lead.unit.test.ts).

Run from the repo root:
    python -m unittest discover -s tests/unit/lead_assignment -p "test_us11_*.py" -v
"""

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lead_testcase import NOW, LeadTestCase, S
import event_review
import main
import models
import schemas
from event_access import LIVE, is_involved
from login.models import Role


class TestCoordinatorList(LeadTestCase):
    def test_lists_only_active_coordinator_accounts_by_name(self):
        self.user("Aisha Noor", Role.coordinator, active=False)

        listed = main.list_coordinators(db=self.db, _user=self.grace)

        self.assertEqual([(c.id, c.name) for c in listed], [(self.marcus.id, "Marcus Lee"), (self.priya.id, "Priya Tan")])

    def test_leaves_out_the_lead_and_every_other_role(self):
        names = [c.name for c in main.list_coordinators(db=self.db, _user=self.grace)]

        for person in (self.maya, self.grace, self.daniel):
            self.assertNotIn(person.name, names)


class TestAssign(LeadTestCase):
    def test_the_lead_assigns_a_coordinator_to_a_submitted_request(self):
        event = self.request("Charity Gala")

        shown = self.assign(event, self.priya)

        self.assertEqual((shown.coordinator, shown.coordinatorId, shown.status), ("Priya Tan", self.priya.id, "submitted"))
        self.db.expire_all()
        self.assertEqual(self.db.get(models.Event, event.id).coordinator_id, self.priya.id)

    def test_any_live_request_can_be_assigned(self):
        for status in LIVE:
            event = self.request(f"Live {status.value}", status=status)
            event_review.assign(self.db, event, self.grace, self.priya.id, NOW)
            self.assertEqual(event.coordinator_id, self.priya.id, status)

    def test_a_closed_request_cant_be_assigned(self):
        for status in (S.rejected, S.cancelled):
            event = self.request(status=status)
            with self.assertRaises(event_review.ReviewError) as ctx:
                event_review.assign(self.db, event, self.grace, self.priya.id, NOW)
            self.assertEqual((ctx.exception.status_code, ctx.exception.message),
                             (409, f"A coordinator can't be assigned while the event is {status.value}."))

    def test_an_assigned_request_cant_be_assigned_again(self):
        event = self.request("Workshop", coordinator=self.priya)

        refused = self.refusal(self.assign, event, self.marcus)

        self.assertEqual((refused.status_code, refused.detail), (409, "Priya Tan is already coordinating this event."))
        self.assertEqual(self.db.get(models.Event, event.id).coordinator_id, self.priya.id)

    def test_a_draft_cant_be_assigned_the_lead_cant_see_it(self):
        draft = self.request("Draft", status=S.draft)

        refused = self.refusal(self.assign, draft, self.priya)

        self.assertEqual((refused.status_code, refused.detail), (403, "You don't have permission to do that"))
        self.assertIsNone(self.db.get(models.Event, draft.id).coordinator_id)

    def test_assigning_a_missing_event_is_not_found(self):
        body = schemas.AssignCoordinatorIn(coordinatorId=self.priya.id)

        refused = self.refusal(main.assign_coordinator, 999, body, db=self.db, user=self.grace)

        self.assertEqual((refused.status_code, refused.detail), (404, "Event not found"))


class TestAssignmentRecorded(LeadTestCase):
    def test_records_the_assigning_user_and_the_time(self):
        event = self.request("Alumni Talk")

        event_review.assign(self.db, event, self.grace, self.priya.id, NOW)
        self.db.commit()

        [row] = self.db.query(models.EventAssignment).all()
        self.assertEqual((row.event_id, row.coordinator_id, row.assigned_by_id), (event.id, self.priya.id, self.grace.id))
        self.assertEqual(main.utc(row.assigned_at), NOW)

    def test_the_event_shows_who_assigned_it_and_when(self):
        event = self.request("Alumni Talk")
        before = datetime.now(timezone.utc)

        self.assign(event, self.priya)
        shown = main.event_response(self.db, event)

        self.assertEqual(shown.assignedBy, "Grace Ong")
        self.assertEqual(shown.assignedAt.tzinfo, timezone.utc)
        self.assertGreaterEqual(shown.assignedAt, before - timedelta(seconds=1))

    def test_an_event_with_no_recorded_assignment_shows_none(self):
        for event in (self.request("Unassigned"), self.request("Assigned before US11", coordinator=self.priya)):
            shown = main.event_response(self.db, event)
            self.assertEqual((shown.assignedBy, shown.assignedAt), (None, None), event.name)

    def test_shows_the_assignment_of_the_current_coordinator(self):
        event = self.request("Workshop")
        for coordinator in (self.marcus, self.priya):
            self.db.add(models.EventAssignment(event_id=event.id, coordinator_id=coordinator.id,
                                               assigned_by_id=self.grace.id, assigned_at=NOW))
        event.coordinator_id = self.marcus.id
        self.db.commit()

        self.assertEqual(main.event_response(self.db, event).assignedBy, "Grace Ong")
        self.assertEqual(main.event_response(self.db, event).coordinator, "Marcus Lee")

    def test_a_refused_assignment_records_nothing(self):
        event = self.request("Workshop", coordinator=self.priya)

        self.refusal(self.assign, event, self.marcus)

        self.assertEqual(self.db.query(models.EventAssignment).count(), 0)


class TestAssignedCoordinatorGetsAccess(LeadTestCase):
    def test_the_coordinator_can_see_the_event_only_after_being_assigned(self):
        event = self.request("Hackathon")
        self.assertFalse(is_involved(event, self.priya))

        self.assign(event, self.priya)

        self.assertTrue(is_involved(self.db.get(models.Event, event.id), self.priya))
        self.assertEqual(self.visible(self.priya), ["Hackathon"])

    def test_another_coordinator_still_cant(self):
        event = self.request("Hackathon")

        self.assign(event, self.priya)

        self.assertFalse(is_involved(self.db.get(models.Event, event.id), self.marcus))


class TestOnlyCoordinators(LeadTestCase):
    def test_someone_who_isnt_a_coordinator_cant_be_assigned(self):
        for person in (self.maya, self.grace, self.daniel):
            event = self.request(f"For {person.name}")
            refused = self.refusal(self.assign, event, person)
            self.assertEqual((refused.status_code, refused.detail), (422, f"{person.name} is not an Event Coordinator."))
            self.assertIsNone(self.db.get(models.Event, event.id).coordinator_id)

    def test_a_deactivated_coordinator_cant_be_assigned(self):
        aisha = self.user("Aisha Noor", Role.coordinator, active=False)

        refused = self.refusal(self.assign, self.request(), aisha)

        self.assertEqual(refused.detail, "Aisha Noor is not an Event Coordinator.")

    def test_an_unknown_account_cant_be_assigned(self):
        event = self.request()

        with self.assertRaises(event_review.ReviewError) as ctx:
            event_review.assign(self.db, event, self.grace, 999, NOW)

        self.assertEqual((ctx.exception.status_code, ctx.exception.message), (422, "That person is not an Event Coordinator."))


if __name__ == "__main__":
    unittest.main()

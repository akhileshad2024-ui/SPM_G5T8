"""
Unit tests for US43 — Event Coordinator Lead Oversight.

"As an Event Coordinator Lead, I want to oversee coordinator assignments and active events so that every
event request is handled by a suitable coordinator."

AC1: a Lead role exists and sees the unassigned requests ............ TestLeadRole, TestLeadQueue
AC2: the Lead sees each coordinator's current assignments ........... TestLeadSeesEveryLiveEvent
AC3: the Lead sees a request's basic information before assigning ... TestWhatTheLeadSees
AC4: coordinators see and manage only the events assigned to them ... TestCoordinatorSeesOnlyTheirs
AC5: every permission check is on the server ........................ TestServerChecks
The other roles' visibility rules, in the same module ............... TestEveryRolesVisibility

The rules (backend/event_access.py, event_fields.py) and the endpoint functions in backend/main.py are
called directly on a real in-memory SQLite database (never Supabase). Assigning itself is US11
(test_us11_assign_coordinator.py). The integration and functional tests check the same through the API
and the browser.

Run from the repo root:
    python -m unittest discover -s tests/unit/lead_assignment -p "test_us43_*.py" -v
"""

import sys
import unittest
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lead_testcase import CLOSED, NOW, LeadTestCase, S
import main
import models
from event_access import LIVE, is_involved
from event_fields import VISIBLE_FIELDS, for_role
from login.models import Role, User
from login.security import require_roles


class TestLeadRole(unittest.TestCase):
    def test_the_lead_is_a_role_of_its_own(self):
        self.assertEqual(Role.lead.value, "lead")
        self.assertNotEqual(Role.lead, Role.coordinator)

    def test_only_the_lead_assigns_coordinators(self):
        self.assertEqual(main.COORDINATOR_ASSIGNERS, (Role.lead,))

    def test_the_lead_is_not_one_of_the_event_reviewers(self):
        self.assertNotIn(Role.lead, main.EVENT_REVIEWERS)


class TestLeadQueue(LeadTestCase):
    def test_lists_the_live_requests_with_no_coordinator(self):
        self.request("Open Day")
        self.request("In Review", status=S.under_review)
        self.request("Workshop", coordinator=self.priya)

        self.assertEqual([e.name for e in main.lead_queue(db=self.db, user=self.grace)], ["Open Day", "In Review"])

    def test_leaves_out_drafts_and_closed_requests(self):
        for status in CLOSED:
            self.request(f"Closed {status.value}", status=status)

        self.assertEqual(main.lead_queue(db=self.db, user=self.grace), [])

    def test_oldest_submission_first(self):
        self.request("Newer", submitted_at=NOW)
        self.request("Older", submitted_at=NOW - timedelta(days=2))

        self.assertEqual([e.name for e in main.lead_queue(db=self.db, user=self.grace)], ["Older", "Newer"])

    def test_a_request_leaves_the_queue_once_assigned(self):
        event = self.request("Charity Gala")
        self.assign(event, self.priya)

        self.assertEqual(main.lead_queue(db=self.db, user=self.grace), [])


class TestLeadSeesEveryLiveEvent(LeadTestCase):
    def test_sees_every_live_event_assigned_or_not(self):
        for status in LIVE:
            self.request(f"Unassigned {status.value}", status=status)
            self.request(f"Priya {status.value}", status=status, coordinator=self.priya)

        self.assertEqual(len(self.visible(self.grace)), 2 * len(LIVE))

    def test_does_not_see_drafts_or_closed_events(self):
        for status in CLOSED:
            event = self.request(status=status, coordinator=self.priya if status != S.draft else None)
            self.assertFalse(is_involved(event, self.grace), status)

        self.assertEqual(self.visible(self.grace), [])

    def test_the_single_event_rule_matches_the_list_rule(self):
        events = [self.request(f"E{i} {s.value}", status=s, coordinator=c)
                  for i, (s, c) in enumerate((s, c) for s in S for c in (None, self.priya))]
        for user in (self.grace, self.priya, self.marcus):
            listed = set(self.visible(user))
            self.assertEqual({e.name for e in events if is_involved(e, user)}, listed, user.name)


class TestWhatTheLeadSees(LeadTestCase):
    def test_the_queue_shows_each_requests_basic_information(self):
        self.request("Open Day", purpose="Campus tours", expected_attendance=120)

        [shown] = main.lead_queue(db=self.db, user=self.grace)

        self.assertEqual((shown.name, shown.status, shown.organiser, shown.purpose, shown.pax),
                         ("Open Day", "submitted", "Maya Rahman", "Campus tours", 120))
        self.assertIsNone(shown.coordinator)

    def test_sees_what_a_coordinator_sees_except_the_review_notes(self):
        self.assertEqual(VISIBLE_FIELDS[Role.coordinator] - VISIBLE_FIELDS[Role.lead], {"clarification", "decision"})
        self.assertLessEqual(VISIBLE_FIELDS[Role.lead], VISIBLE_FIELDS[Role.coordinator])

    def test_the_review_notes_are_left_out_not_blanked(self):
        event = {"name": "Open Day", "clarification": {"message": "?"}, "decision": {"outcome": "approved"}}

        self.assertEqual(for_role(event, self.grace), {"name": "Open Day"})

    def test_the_lead_coordinator_and_organiser_see_who_assigned_and_when(self):
        for role in (Role.lead, Role.coordinator, Role.organiser):
            self.assertLessEqual({"assignedBy", "assignedAt"}, VISIBLE_FIELDS[role], role)
        for role in (Role.venue, Role.tech, Role.attendee):
            self.assertFalse({"assignedBy", "assignedAt"} & VISIBLE_FIELDS[role], role)


class TestCoordinatorSeesOnlyTheirs(LeadTestCase):
    def test_sees_only_the_events_assigned_to_them(self):
        self.request("Unassigned")
        self.request("Priya's", coordinator=self.priya)
        self.request("Marcus's", coordinator=self.marcus)

        self.assertEqual(self.visible(self.priya), ["Priya's"])
        self.assertEqual(self.visible(self.marcus), ["Marcus's"])

    def test_never_sees_a_draft_even_if_assigned(self):
        draft = self.request("Draft", status=S.draft, coordinator=self.priya)

        self.assertFalse(is_involved(draft, self.priya))
        self.assertEqual(self.visible(self.priya), [])

    def test_still_sees_their_closed_events(self):
        for status in (S.rejected, S.cancelled):
            self.assertTrue(is_involved(self.request(status=status, coordinator=self.priya), self.priya), status)

    def test_cant_review_an_unassigned_request_or_someone_elses(self):
        for event in (self.request("Unassigned"), self.request("Marcus's", coordinator=self.marcus)):
            refused = self.refusal(main.start_review, event.id, db=self.db, user=self.priya)
            self.assertEqual(refused.status_code, 403, event.name)
            self.assertEqual(self.db.get(models.Event, event.id).status, S.submitted)

    def test_can_review_once_assigned(self):
        event = self.request("Charity Gala")
        self.assign(event, self.priya)

        self.assertEqual(main.start_review(event.id, db=self.db, user=self.priya).status, "under_review")


class TestEveryRolesVisibility(LeadTestCase):
    """The rest of event_access.py (US02/US13), which the Lead and coordinator rules were added to."""

    def setUp(self):
        super().setUp()
        self.wei = self.user("Wei Lim", Role.tech)
        self.sam = self.user("Sam Adeyemi", Role.attendee)
        self.venue_id = self.venue().id
        self.request("Draft", status=S.draft, venue_id=self.venue_id, equipment_state="requested")
        self.request("Booked", status=S.approved, venue_id=self.venue_id)
        equipment_event = self.request("Equipment", equipment_state="requested")
        self.db.add(models.EquipmentAssignment(event_id=equipment_event.id, tech_id=self.wei.id))
        self.db.commit()
        self.request("Open", status=S.confirmed, registration_required=True)
        self.request("Closed registration", status=S.confirmed, registration_required=False)

    def test_each_role_sees_its_events(self):
        expected = {
            self.maya: ["Draft", "Booked", "Equipment", "Open", "Closed registration"],  # all hers, drafts included
            self.daniel: ["Booked"],
            self.wei: ["Equipment"],
            self.sam: ["Open"],
            self.grace: ["Booked", "Equipment", "Open", "Closed registration"],
            self.priya: [],
        }
        for user, names in expected.items():
            self.assertEqual(self.visible(user), names, user.name)
            events = self.db.query(models.Event).order_by(models.Event.id).all()
            self.assertEqual([e.name for e in events if is_involved(e, user)], names, user.name)

    def test_an_organiser_doesnt_see_another_organisers_events(self):
        alex = self.user("Alex Chen", Role.organiser)

        self.assertEqual(self.visible(alex), [])
        self.assertFalse(is_involved(self.db.query(models.Event).first(), alex))

    def test_an_unknown_role_sees_nothing(self):
        stranger = User(id=99, name="Nobody", role="unknown")

        self.assertEqual(self.visible(stranger), [])
        self.assertFalse(is_involved(self.db.query(models.Event).filter_by(name="Open").one(), stranger))


class TestServerChecks(LeadTestCase):
    def test_only_the_lead_passes_the_assigners_check(self):
        check = require_roles(*main.COORDINATOR_ASSIGNERS)
        self.assertIs(check(self.grace), self.grace)
        for user in (self.maya, self.priya, self.daniel):
            refused = self.refusal(check, user)
            self.assertEqual((refused.status_code, refused.detail), (403, "You don't have permission to do that"))

    def test_the_lead_cant_open_a_draft(self):
        draft = self.request("Draft", status=S.draft)

        self.assertFalse(is_involved(draft, self.grace))
        self.assertNotIn("Draft", [e.name for e in main.lead_queue(db=self.db, user=self.grace)])


if __name__ == "__main__":
    unittest.main()

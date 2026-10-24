"""Pure event_changes module tests; US33-TC01 covers the visible request flow."""
import os
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from datetime import datetime, timezone

BACKEND = Path(__file__).resolve().parents[3] / "backend"
sys.path.insert(0, str(BACKEND))
from event_changes import ChangeRequestError, prepare_request, prepare_decision


class TestEventChanges(unittest.TestCase):
    def setUp(self):
        self.event = SimpleNamespace(organiser_id=1, status="submitted", attendance=85)
        self.user = SimpleNamespace(id=1, role="organiser")

    def test_ac1_ac2_proposal_does_not_edit_event(self):
        # US33-TC01: 90 is proposed, but the actual attendance remains 85.
        for status in ["submitted", "under_review", "pending_clarification", "approved", "confirmed"]:
            with self.subTest(status=status):
                self.event.status = status
                before = vars(self.event).copy()
                self.assertEqual(prepare_request(self.event, self.user, "  Attendance 90  "),
                                 {"proposed_changes": "Attendance 90", "status": "pending"})
                self.assertEqual(vars(self.event), before)

    def test_ac1_ownership_and_role_are_required(self):
        for user in [SimpleNamespace(id=2, role="organiser"), SimpleNamespace(id=1, role="coordinator")]:
            with self.subTest(user=user), self.assertRaises(ChangeRequestError) as raised:
                prepare_request(self.event, user, "Attendance 90")
            self.assertEqual(raised.exception.status_code, 403)

    def test_drafts_and_closed_events_do_not_use_this_workflow(self):
        for status in ["draft", "cancelled", "rejected"]:
            self.event.status = status
            with self.subTest(status=status), self.assertRaises(ChangeRequestError) as raised:
                prepare_request(self.event, self.user, "Attendance 90")
            self.assertEqual(raised.exception.status_code, 409)

    def test_empty_proposal_is_not_a_request_but_no_separate_reason_is_needed(self):
        with self.assertRaises(ChangeRequestError) as raised:
            prepare_request(self.event, self.user, " \n ")
        self.assertEqual(raised.exception.status_code, 422)

    def test_pure_module_import_needs_no_database_configuration(self):
        # CI unittest discovery has no database env or pytest conftest.
        env = {k: v for k, v in os.environ.items() if k not in {"DATABASE_URL", "JWT_SECRET"}}
        result = subprocess.run([sys.executable, "-c", "import event_changes, sys; assert 'database' not in sys.modules"],
                                cwd=BACKEND, env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)


class TestChangeDecisions(unittest.TestCase):
    """US34 AC3/AC4: pure rules; TC01/TC02 exercise the matching UI outcomes."""
    def setUp(self):
        self.event = SimpleNamespace(coordinator_id=2, status="confirmed", attendance=85)
        self.request = SimpleNamespace(status="pending", proposed_changes="Attendance 90")
        self.user = SimpleNamespace(id=2, role="coordinator", name="Coordinator")
        self.now = datetime(2026, 10, 24, 8, 30, tzinfo=timezone.utc)

    def decide(self, outcome="accepted", reason=""):
        return prepare_decision(self.event, self.request, self.user, outcome, reason, self.now)

    def test_accept_and_reject_allow_blank_reason_without_mutating_event_or_request(self):
        # Given: an assigned reviewer and a pending proposal; the clock is fixed.
        before = vars(self.event).copy(), vars(self.request).copy()
        for outcome in ["accepted", "rejected"]:
            with self.subTest(outcome=outcome):
                result = self.decide(outcome)
                self.assertEqual(result, {"status": outcome, "decision": {
                    "outcome": outcome, "reason": "", "by": "Coordinator", "by_id": 2,
                    "at": "2026-10-24T08:30:00+00:00"}})
                self.assertEqual((vars(self.event), vars(self.request)), before)

    def test_optional_reason_is_trimmed(self):
        self.assertEqual(self.decide(reason="  Review complete  ")["decision"]["reason"], "Review complete")

    def test_only_assigned_coordinator_can_decide(self):
        for role, user_id in [("organiser", 2), ("coordinator", 3)]:
            self.user.role, self.user.id = role, user_id
            with self.subTest(role=role, user_id=user_id), self.assertRaises(ChangeRequestError) as error:
                self.decide()
            self.assertEqual(error.exception.status_code, 403)

    def test_reviewed_request_cannot_be_overwritten(self):
        for status in ["accepted", "rejected"]:
            self.request.status = status
            with self.subTest(status=status), self.assertRaises(ChangeRequestError) as error:
                self.decide()
            self.assertEqual(error.exception.status_code, 409)

    def test_unknown_outcome_is_rejected(self):
        with self.assertRaises(ChangeRequestError) as error:
            self.decide("approved")
        self.assertEqual(error.exception.status_code, 422)

"""Pure event_changes module tests; US33-TC01 covers the visible request flow."""
import os
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

BACKEND = Path(__file__).resolve().parents[3] / "backend"
sys.path.insert(0, str(BACKEND))
from event_changes import ChangeRequestError, prepare_request


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

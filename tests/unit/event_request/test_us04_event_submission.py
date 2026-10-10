"""Unit tests for event_submission; API/database behaviour is tested separately."""

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "backend"))
from event_submission import prepare_submission


class TestEventSubmission(unittest.TestCase):
    def test_tc01_prepares_submitted_status_without_direct_assignment(self):
        # US04-TC01: submission is Submitted, not assigned to a coordinator.
        now = datetime(2026, 10, 10, 10, 30, tzinfo=timezone.utc)
        result = prepare_submission({"name": "Submission test"}, now)
        self.assertEqual(result["status"], "submitted")
        self.assertIsNone(result["coordinator_id"])
        self.assertEqual(result["submitted_at"], now)

    def test_tc01_preserves_information_without_mutating_nested_inputs(self):
        # Technical isolation: preparing submission must not edit the form.
        information = {"name": "Submission test", "equip": {"microphone": 2}}
        result = prepare_submission(information, datetime.now(timezone.utc))
        self.assertEqual(result["draft_form"], information)
        result["draft_form"]["equip"]["microphone"] = 3
        self.assertEqual(information["equip"]["microphone"], 2)

    def test_does_not_invent_a_mandatory_field_list(self):
        # Approved evidence policy: listed fields are not automatically required.
        result = prepare_submission({}, datetime.now(timezone.utc))
        self.assertEqual(result["draft_form"], {})
        self.assertEqual(result["status"], "submitted")


if __name__ == "__main__":
    unittest.main()

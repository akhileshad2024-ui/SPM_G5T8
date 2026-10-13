"""Unit tests for event_drafts.can_edit_draft, traced to US06-TC01/TC02.

Only the module's ownership/status rule is tested here. API and database
behaviour belongs to the integration file, not these unit tests.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "backend"))
from event_drafts import can_edit_draft


class TestDraftEditingPermission(unittest.TestCase):
    def test_ac3_owner_can_continue_editing_a_draft(self):
        # US06-TC01: saved, unsubmitted information remains editable by its owner.
        self.assertTrue(can_edit_draft("draft", 1, 1))

    def test_ac4_another_organiser_cannot_edit_the_draft(self):
        # US06-TC02: a valid login does not grant access to someone else's draft.
        self.assertFalse(can_edit_draft("draft", 1, 2))

    def test_ac3_owner_cannot_use_draft_editing_after_submission(self):
        # US06-TC02: this module grants editing before submission only.
        self.assertFalse(can_edit_draft("submitted", 1, 1))


if __name__ == "__main__":
    unittest.main()

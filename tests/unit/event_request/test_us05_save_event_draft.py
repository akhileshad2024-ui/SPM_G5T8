"""Unit tests for US05 — Save Event Request as Draft.

Module under test: ``backend/event_drafts.py`` → ``prepare_draft``.
Story-level test case traced here: ``US05-TC01`` (save an incomplete event
request as a draft). Each method below identifies its matching acceptance
criterion and the condition it checks.

They do not use FastAPI, SQLAlchemy, Supabase, or a real database, so a failure
points directly to the draft business module.

Run from the project root:
    python -m unittest tests.unit.event_request.test_us05_save_event_draft -v
"""

import sys
import unittest
from pathlib import Path


# The backend is a plain Python folder rather than an installed package.
# Adding it to Python's import path lets this test import its business modules.
REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "backend"))


def prepare_draft(saved_event_information):
    """Call the US05 module function being tested."""
    from event_drafts import prepare_draft as prepare

    return prepare(saved_event_information)


class TestUS05SaveEventRequestAsDraft(unittest.TestCase):
    """Module tests for Test Case US05-TC01."""

    def test_ac1_incomplete_event_information_can_be_prepared_as_a_draft(self):
        # US05-TC01 / AC1: test whether even empty information can be a draft.
        result = prepare_draft({})

        self.assertEqual(result["status"], "draft")

    def test_ac2_saved_request_is_identified_as_draft_not_submitted(self):
        # US05-TC01 / AC2: test whether Draft is distinguishable from Submitted.
        result = prepare_draft({"name": "Welcome Session"})

        self.assertEqual(result["status"], "draft")
        self.assertNotEqual(result["status"], "submitted")

    def test_ac3_explicitly_saved_event_information_is_retained(self):
        # US05-TC01 / AC3: test whether every explicitly saved value is retained.
        saved_information = {
            "name": "Welcome Session",
            "purpose": "Welcome new students",
            "expected_attendance": 80,
        }

        result = prepare_draft(saved_information)

        self.assertEqual(result["draft_form"], saved_information)


if __name__ == "__main__":
    unittest.main()

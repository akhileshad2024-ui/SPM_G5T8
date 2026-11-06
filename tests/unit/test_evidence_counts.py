"""Runner summaries must not be confused with scenario text."""
import unittest
from scripts.test_evidence import test_counts as counts


class TestEvidenceCounts(unittest.TestCase):
    def test_playwright_ignores_the_failed_login_attempts_in_a_passed_title(self):
        output = "✓ 11 [TC-007] 4 failed attempts do not lock the account\n  1 skipped\n  237 passed (9.5m)"
        self.assertEqual(counts(output), {"passed": 237, "skipped": 1})

    def test_pytest_counts_the_summary_not_subtests_or_scenario_names(self):
        self.assertEqual(counts("test_4_failed_attempts PASSED\n==== 2133 passed, 1 skipped, 1037 subtests passed in 131.65s ===="), {"passed": 2133, "skipped": 1})

    def test_vitest_preserves_a_real_failure_count(self):
        self.assertEqual(counts(" Tests  2 failed | 10 passed (12)\n"), {"passed": 10, "failed": 2})

    def test_no_summary_does_not_invent_counts(self):
        self.assertEqual(counts("4 failed attempts do not lock the account"), {})

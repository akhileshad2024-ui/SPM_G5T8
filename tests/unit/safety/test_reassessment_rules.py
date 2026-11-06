"""US50/US51 pure validity comparisons; implementation choices documented in delivery notes."""
import unittest
import sys
from pathlib import Path
from datetime import date, datetime, time
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).resolve().parent))
import safety_testcase  # establishes the existing isolated backend import environment
from event_changes.reassessment import equipment_reasons, registration_reasons


class TestReassessmentComparisons(unittest.TestCase):
    def setUp(self):
        self.values = {"date": date(2027, 1, 4), "start": time(10), "end": time(12),
                       "reg": True, "regCap": 2, "regClose": date(2027, 1, 4)}
        self.reservation = SimpleNamespace(quantity=2, start=datetime(2027, 1, 4, 10), end=datetime(2027, 1, 4, 12))
        self.line = {"id": "E2", "qty": 2}

    def test_US50_AC1_AC2_matching_period_quantity_and_stock_remain_valid(self):
        self.assertEqual(equipment_reasons(self.reservation, self.line, self.values, 2), [])

    def test_US50_AC2_removed_item_is_invalid(self):
        self.assertIn("no longer requested", equipment_reasons(self.reservation, None, self.values)[0])

    def test_US50_AC2_quantity_period_and_stock_are_independent_reasons(self):
        values = {**self.values, "start": time(11)}
        self.assertEqual(len(equipment_reasons(self.reservation, {**self.line, "qty": 3}, values, 2)), 3)

    def test_US51_AC1_AC2_capacity_equal_registered_and_close_equal_event_are_valid(self):
        self.assertEqual(registration_reasons(self.values, 2), [])

    def test_US51_AC2_capacity_below_registered_is_invalid(self):
        self.assertEqual(len(registration_reasons(self.values, 3)), 1)

    def test_US51_AC2_closing_after_event_is_invalid(self):
        self.assertEqual(len(registration_reasons({**self.values, "regClose": date(2027, 1, 5)}, 0)), 1)

    def test_US51_AC2_disabled_without_registered_attendees_is_valid(self):
        self.assertEqual(registration_reasons({**self.values, "reg": False}, 0), [])
        self.assertEqual(len(registration_reasons({**self.values, "reg": False}, 1)), 1)

    def test_US51_AC2_unlimited_capacity_has_no_numeric_shortfall(self):
        self.assertEqual(registration_reasons({**self.values, "regCap": None}, 1000), [])

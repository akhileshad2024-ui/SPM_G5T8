"""US45-AC4 confirmation portion, reusing US14 and US44 endpoints.

This verifies the backend gate, not a new preparation workflow. Event setup and
safety decisions use real API calls and isolated SQLite, without mocked flags.
"""
from tests.integration import test_us44_operational_safety_check_integration as safety
import models


class TestSafetyConfirmationGate(safety.US44TestCase):
    def confirmation(self, event_id):
        response = self.coordinator.get(f"/events/{event_id}/confirmation")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def assert_refused_without_effects(self, event_id):
        self.db.expire_all()
        event = self.db.get(models.Event, event_id)
        status = event.status
        counts = tuple(self.db.query(model).filter_by(event_id=event_id).count()
                       for model in (models.EventStatusChange, models.Notification, models.SafetyReview))
        checklist = self.confirmation(event_id)
        self.assertFalse(checklist["ready"])
        self.assertTrue(any("Safety Officer" in reason for reason in checklist["outstanding"]))
        response = self.coordinator.post(f"/events/{event_id}/confirm")
        self.assertEqual(response.status_code, 409, response.text)
        self.assertIn("Safety Officer", response.json()["detail"])
        self.db.expire_all()
        event = self.db.get(models.Event, event_id)
        self.assertEqual(event.status, status)
        self.assertIsNone(event.confirmed_at)
        self.assertIsNone(event.confirmed_by_id)
        self.assertEqual(tuple(self.db.query(model).filter_by(event_id=event_id).count()
                               for model in (models.EventStatusChange, models.Notification, models.SafetyReview)), counts)

    def test_both_rework_outcomes_and_resubmission_need_new_safety_approval(self):
        for outcome in ("rejected", "changes_requested"):
            with self.subTest(outcome=outcome):
                event_id = self.ready_event(f"Confirm gate {outcome}")["event_id"]
                # Existing table allows approved -> confirmed; the actual API must
                # enforce US14's safety rule even when no browser is involved.
                self.assert_refused_without_effects(event_id)
                self.assertEqual(self.send(event_id).status_code, 200)
                self.assert_refused_without_effects(event_id)
                result = self.decide_check(event_id, outcome, "Review arrangements.")
                self.assertEqual(result.status_code, 200, result.text)
                self.assert_refused_without_effects(event_id)
                self.assertEqual(self.send(event_id).status_code, 200)
                self.assert_refused_without_effects(event_id)
                result = self.decide_check(event_id, "approved", client=self.ravi)
                self.assertEqual(result.status_code, 200, result.text)
                self.assertTrue(self.confirmation(event_id)["ready"])
                confirmed = self.coordinator.post(f"/events/{event_id}/confirm")
                self.assertEqual(confirmed.status_code, 200, confirmed.text)
                self.assertEqual(confirmed.json()["status"], "confirmed")
                self.assertIsNotNone(self.confirmation(event_id)["confirmedAt"])

    def test_safety_approval_does_not_bypass_the_existing_venue_reassessment_gate(self):
        hall = self.flat_venue("Confirmation shared hall")
        bookings = [self.requested("Morning", "10:00", "12:00", venue_id=hall),
                    self.requested("Afternoon", "12:30", "14:00", venue_id=hall)]
        for booking in bookings:
            self.assertEqual(self.decide(booking["id"], "approved").status_code, 200)
        event_id = bookings[0]["event_id"]
        self.assertEqual(self.send(event_id).status_code, 200)
        self.assertEqual(self.decide_check(event_id, "approved").status_code, 200)
        changed = self.staff.put(f"/venues/{hall}", json={"setupMinutes": 60})
        self.assertEqual(changed.status_code, 200, changed.text)
        checklist = self.confirmation(event_id)
        self.assertFalse(checklist["ready"])
        self.assertTrue(any("requires reassessment" in reason for reason in checklist["outstanding"]))
        refused = self.coordinator.post(f"/events/{event_id}/confirm")
        self.assertEqual(refused.status_code, 409, refused.text)
        self.assertEqual(self.status_of(event_id), "safety_approved")
        resolved = self.staff.put(f"/venues/{hall}", json={"setupMinutes": 0})
        self.assertEqual(resolved.status_code, 200, resolved.text)
        self.assertTrue(self.confirmation(event_id)["ready"])
        self.assertEqual(self.coordinator.post(f"/events/{event_id}/confirm").status_code, 200)

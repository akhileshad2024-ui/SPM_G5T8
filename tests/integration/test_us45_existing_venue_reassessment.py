"""US45-AC3 partial integration: existing US38 flags gate real US44 resubmission.

Flag setup below is an explicit persisted fixture, not a claim that US45 creates
named safety flags. No new flag schema, safety target or invalidity rule is used.
"""
from tests.integration import test_us44_operational_safety_check_integration as safety
import models
from login.models import Role


class TestExistingVenueReassessment(safety.US44TestCase):
    def test_real_venue_change_flags_and_resolution_gate_both_rework_outcomes(self):
        # Real API flow: US38 creates/clears its own flag; no injected flag here.
        for outcome in ("rejected", "changes_requested"):
            with self.subTest(outcome=outcome):
                hall = self.flat_venue(f"Shared hall {outcome}")
                own = self.requested(f"Own {outcome}", "10:00", "12:00", venue_id=hall)
                neighbour = self.requested(f"Neighbour {outcome}", "12:30", "14:00", venue_id=hall)
                for booking in (own, neighbour):
                    response = self.decide(booking["id"], "approved")
                    self.assertEqual(response.status_code, 200, response.text)
                event_id = own["event_id"]
                self.assertEqual(self.send(event_id).status_code, 200)
                self.assertEqual(self.decide_check(event_id, outcome, "Review arrangements.").status_code, 200)
                changed = self.staff.put(f"/venues/{hall}", json={"setupMinutes": 60})
                self.assertEqual(changed.status_code, 200, changed.text)
                self.assertEqual(len(changed.json()["reassessed_bookings"]), 2)
                self.assertEqual(self.send(event_id).status_code, 409)
                self.assertEqual(self.status_of(event_id), f"safety_{outcome}")
                resolved = self.staff.put(f"/venues/{hall}", json={"setupMinutes": 0})
                self.assertEqual(resolved.status_code, 200, resolved.text)
                self.db.expire_all()
                self.assertIsNone(self.db.get(models.VenueBooking, own["id"]).reassessment)
                self.assertEqual(self.send(event_id).status_code, 200)

    def rework_booking(self, outcome):
        booking = self.ready_event(f"Rework {outcome}")
        event_id = booking["event_id"]
        self.assertEqual(self.send(event_id).status_code, 200)
        result = self.decide_check(event_id, outcome, "Review the venue arrangement.")
        self.assertEqual(result.status_code, 200, result.text)
        return self.db.get(models.VenueBooking, booking["id"])

    def flag(self, booking):
        # Existing US38-shaped fixture. Flag creation/resolution is not under test.
        booking.reassessment = {
            "reason": "venue_time_changed", "message": "Existing venue clash.",
            "setup_minutes": 30, "turnaround_minutes": 0,
            "clashes_with": [], "flagged_at": "2026-11-03T00:00:00+00:00",
        }
        self.db.commit()

    def counts(self, event_id):
        self.db.expire_all()
        return tuple(self.db.query(model).filter_by(event_id=event_id).count()
                     for model in (models.EventStatusChange, models.Notification, models.SafetyReview))

    def test_both_nonapproval_outcomes_refuse_flags_without_side_effects_then_resubmit(self):
        for outcome in ("rejected", "changes_requested"):
            with self.subTest(outcome=outcome):
                booking = self.rework_booking(outcome)
                event_id = booking.event_id
                self.flag(booking)
                previous = self.counts(event_id)
                refused = self.send(event_id)
                self.assertEqual(refused.status_code, 409, refused.text)
                self.assertIn("Requires Reassessment", refused.json()["detail"])
                self.assertEqual(self.status_of(event_id), f"safety_{outcome}")
                self.assertEqual(self.counts(event_id), previous)
                self.db.refresh(booking)
                self.assertIsNotNone(booking.reassessment)

                # Simulate the existing flag's resolution, not a new resolution API.
                booking.reassessment = None
                self.db.commit()
                resent = self.send(event_id)
                self.assertEqual(resent.status_code, 200, resent.text)
                self.assertEqual(resent.json()["status"], "pending_safety_review")
                self.assertEqual(self.counts(event_id)[0], previous[0] + 1)

    def test_other_events_flags_do_not_block_this_event(self):
        other = self.rework_booking("rejected")
        self.flag(other)
        own = self.rework_booking("changes_requested")
        self.assertEqual(self.send(own.event_id).status_code, 200)

    def test_resubmission_still_rejects_other_coordinators_and_roles(self):
        booking = self.rework_booking("rejected")
        self.flag(booking)
        before = self.counts(booking.event_id)
        for actor in (self.organiser, self.hannah,
                      self.client(Role.coordinator, "unassigned@test.edu")):
            with self.subTest(actor=actor):
                self.assertEqual(self.send(booking.event_id, actor).status_code, 403)
        self.assertEqual(self.counts(booking.event_id), before)

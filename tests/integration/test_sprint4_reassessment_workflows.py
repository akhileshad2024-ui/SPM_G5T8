"""US50/51/45 real FastAPI workflows; isolated SQLite, actual saved flags/notices.

These are implementation-level acceptance cases, not customer approval of the
documented validity/impact choices. No fake evaluator or mocked service calls.
"""
from datetime import timedelta
from unittest.mock import patch
from tests.integration import test_us44_operational_safety_check_integration as base
import equipment.service as equipment
import models
from auth.models import Role


class TestReassessmentWorkflows(base.US44TestCase):
    def equipped(self, name="Equipment reassessment", second=False):
        equipment.seed_catalogue(self.db)
        booking = self.ready_event(name)
        event_id = booking["event_id"]
        tech_id = self.tech.get("/auth/me").json()["id"]
        lines = [{"id": "E2", "qty": 1, "technicalRequirements": "Front"}]
        if second:
            lines.append({"id": "E1", "qty": 1, "technicalRequirements": "Stage"})
        response = self.coordinator.put(f"/events/{event_id}/equipment", json={"techId": tech_id, "lines": lines})
        self.assertEqual(response.status_code, 200, response.text)
        for line in lines:
            response = self.tech.patch(f"/events/{event_id}/equipment/{line['id']}", json={"status": "reserved"})
            self.assertEqual(response.status_code, 200, response.text)
        return booking

    def proposal(self, event_id):
        response = self.organiser.post(f"/events/{event_id}/change-requests", json={"proposed_changes": "Reviewed arrangement change"})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["id"]

    def decision(self, event_id, request_id, changes=None, outcome="accepted", client=None):
        body = {"outcome": outcome}
        if changes is not None:
            body["effective_changes"] = changes
        return (client or self.coordinator).post(f"/events/{event_id}/change-requests/{request_id}/decision", json=body)

    def flags(self, event_id, client=None):
        response = (client or self.coordinator).get(f"/events/{event_id}/reassessments")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["flags"]

    def resolve(self, event_id, flag_id, client=None, note="Revised arrangement checked"):
        return (client or self.coordinator).post(f"/events/{event_id}/reassessments/{flag_id}/resolve", json={"note": note})

    def test_US50_AC1_AC2_AC3_accept_checks_each_reservation_flags_and_notifies_without_applying(self):
        event_id = self.equipped(second=True)["event_id"]
        self.db.expire_all()
        before = {c.name: getattr(self.db.get(models.Event, event_id), c.name) for c in models.Event.__table__.columns}
        request_id = self.proposal(event_id)
        response = self.decision(event_id, request_id, {"equip": [{"id": "E2", "qty": 2, "technicalRequirements": "Rear"}]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["decision"]["reassessment"]["equipment_checked"], 2)
        flags = self.flags(event_id)
        self.assertEqual(len(flags), 2)
        self.assertTrue(all(f["status"] == "Requires Reassessment" for f in flags))
        notices = [body for title, body in self.notices(self.tech) if title == "Equipment requires reassessment"]
        self.assertEqual(len(notices), 2)
        for flag in flags:
            self.assertTrue(any(f"reservation #{flag['targetId']}" in body for body in notices))
        self.db.expire_all()
        self.assertEqual({c.name: getattr(self.db.get(models.Event, event_id), c.name) for c in models.Event.__table__.columns}, before)
        self.assertEqual(self.decision(event_id, request_id, {}).status_code, 409)
        self.assertEqual(len(self.flags(event_id)), 2)

    def test_US50_valid_saved_values_and_rejection_do_not_create_false_flags(self):
        event_id = self.equipped()["event_id"]
        request_id = self.proposal(event_id)
        response = self.decision(event_id, request_id)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["decision"]["reassessment"]["basis"], "saved_details")
        self.assertEqual(self.flags(event_id), [])
        request_id = self.proposal(event_id)
        self.assertEqual(self.decision(event_id, request_id, outcome="rejected").status_code, 200)
        self.assertEqual(self.flags(event_id), [])

    def test_US50_explicit_apply_release_rereserve_resolve_and_shared_gates(self):
        event_id = self.equipped()["event_id"]
        request_id = self.proposal(event_id)
        self.assertEqual(self.decision(event_id, request_id, {"equip": [{"id": "E2", "qty": 2, "technicalRequirements": "Front"}]}).status_code, 200)
        flag = self.flags(event_id)[0]
        self.assertEqual(self.send(event_id).status_code, 409)
        self.assertEqual(self.coordinator.post(f"/events/{event_id}/confirm").status_code, 409)
        self.assertEqual(self.coordinator.post(f"/events/{event_id}/preparation").status_code, 409)
        self.assertEqual(self.resolve(event_id, flag["id"]).status_code, 403)
        self.assertEqual(self.resolve(event_id, flag["id"], self.tech).status_code, 409)
        path = f"/events/{event_id}/change-requests/{request_id}/apply"
        self.assertEqual(self.coordinator.post(path).status_code, 409)
        self.assertEqual(self.tech.patch(f"/events/{event_id}/equipment/E2", json={"status": "pending"}).status_code, 200)
        response = self.coordinator.post(path)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.coordinator.post(path).status_code, 409)
        self.assertEqual(self.tech.patch(f"/events/{event_id}/equipment/E2", json={"status": "reserved"}).status_code, 200)
        response = self.resolve(event_id, flag["id"], self.tech)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.resolve(event_id, flag["id"], self.tech).status_code, 409)
        self.assertEqual(self.send(event_id).status_code, 200)

    def registered_event(self):
        booking = self.ready_event("Registration reassessment")
        event_id = booking["event_id"]
        self.assertEqual(self.coordinator.patch(f"/events/{event_id}/details", json={"reg": True, "regCap": 2}).status_code, 200)
        self.assertEqual(self.send(event_id).status_code, 200)
        self.assertEqual(self.decide_check(event_id, "approved").status_code, 200)
        self.assertEqual(self.coordinator.post(f"/events/{event_id}/confirm").status_code, 200)
        attendees = [self.client(Role.attendee, f"person{i}@test.edu") for i in range(3)]
        for attendee in attendees:
            self.assertEqual(attendee.post(f"/events/{event_id}/registrations").status_code, 201)
        return event_id, attendees

    def test_US51_AC1_AC2_AC3_capacity_flag_registered_only_notification_and_correction(self):
        event_id, attendees = self.registered_event()
        request_id = self.proposal(event_id)
        response = self.decision(event_id, request_id, {"regCap": 1})
        self.assertEqual(response.status_code, 200, response.text)
        flag = self.flags(event_id)[0]
        self.assertEqual(flag["targetType"], "registration")
        for index, attendee in enumerate(attendees):
            notices = [n for n in self.notices(attendee) if n[0] == "Event changed"]
            self.assertEqual(len(notices), 1 if index < 2 else 0)
        self.assertEqual(self.resolve(event_id, flag["id"]).status_code, 409)
        applied = self.coordinator.post(f"/events/{event_id}/change-requests/{request_id}/apply")
        self.assertEqual(applied.status_code, 200, applied.text)
        self.assertEqual(self.status_of(event_id), "approved")
        self.assertEqual(self.resolve(event_id, flag["id"]).status_code, 409)
        self.assertEqual(self.coordinator.patch(f"/events/{event_id}/details", json={"regCap": 2}).status_code, 200)
        self.assertEqual(self.resolve(event_id, flag["id"]).status_code, 200)
        self.db.expire_all()
        states = [r.status.value for r in self.db.query(models.Registration).filter_by(event_id=event_id).order_by(models.Registration.id)]
        self.assertEqual(states, ["registered", "registered", "waitlisted"])

    def test_US51_unchanged_or_purpose_only_does_not_notify_and_valid_settings_do_not_flag(self):
        event_id, attendees = self.registered_event()
        response = self.decision(event_id, self.proposal(event_id), {"purpose": "Description correction"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.flags(event_id), [])
        for attendee in attendees:
            self.assertFalse([n for n in self.notices(attendee) if n[0] == "Event changed"])

    def test_US45_AC1_AC2_AC3_AC4_both_outcomes_named_targets_rework_resubmit_prepare_confirm(self):
        for outcome in ("rejected", "changes_requested"):
            with self.subTest(outcome=outcome):
                booking = self.equipped(f"Safety {outcome}")
                event_id = booking["event_id"]
                self.assertEqual(self.send(event_id).status_code, 200)
                self.db.expire_all()
                reservation = self.db.query(models.EquipmentReservation).filter_by(event_id=event_id).one()
                targets = [{"type": "venue", "id": booking["id"]}, {"type": "equipment", "id": reservation.id}]
                result = self.hannah.post(f"/events/{event_id}/safety-check", json={"outcome": outcome, "comment": "Change equipment placement and clear aisle", "targets": targets})
                self.assertEqual(result.status_code, 200, result.text)
                self.assertEqual(self.status_of(event_id), "approved")
                summary = self.coordinator.get(f"/events/{event_id}/reassessments").json()
                self.assertEqual(summary["planningStage"], "venue_and_equipment_planning")
                self.assertEqual({(f["targetType"], f["targetId"]) for f in summary["flags"]}, {(t["type"], t["id"]) for t in targets})
                self.assertEqual(self.coordinator.patch(f"/events/{event_id}/details", json={"purpose": "Revised aisle arrangement"}).status_code, 200)
                self.assertEqual(self.send(event_id).status_code, 409)
                self.assertEqual(self.coordinator.post(f"/events/{event_id}/preparation").status_code, 409)
                self.assertEqual(self.coordinator.post(f"/events/{event_id}/confirm").status_code, 409)
                for flag in summary["flags"]:
                    actor = self.tech if flag["targetType"] == "equipment" else self.coordinator
                    self.assertEqual(self.resolve(event_id, flag["id"], actor).status_code, 200)
                self.assertEqual(self.send(event_id).status_code, 200)
                self.assertEqual(self.coordinator.post(f"/events/{event_id}/preparation").status_code, 409)
                self.assertEqual(self.decide_check(event_id, "approved", client=self.ravi).status_code, 200)
                prepared = self.coordinator.post(f"/events/{event_id}/preparation")
                self.assertEqual(prepared.status_code, 200, prepared.text)
                self.assertEqual(self.coordinator.post(f"/events/{event_id}/preparation").json(), prepared.json())
                self.assertEqual(self.coordinator.post(f"/events/{event_id}/confirm").status_code, 200)

    def test_US45_only_named_targets_cross_event_validation_and_permissions(self):
        booking = self.equipped()
        other = self.equipped("Unrelated")
        event_id = booking["event_id"]
        self.assertEqual(self.send(event_id).status_code, 200)
        path = f"/events/{event_id}/safety-check"
        invalid = {"outcome": "rejected", "comment": "Revise venue", "targets": [{"type": "venue", "id": other["id"]}]}
        self.assertEqual(self.hannah.post(path, json=invalid).status_code, 422)
        self.assertEqual(self.status_of(event_id), "pending_safety_review")
        self.assertEqual(self.flags(event_id), [])
        targets = [{"type": "venue", "id": booking["id"]}]
        self.assertEqual(self.hannah.post(path, json={**invalid, "targets": targets}).status_code, 200)
        self.assertEqual([flag["targetType"] for flag in self.flags(event_id)], ["venue"])
        outsider = self.client(Role.coordinator, "outsider@test.edu")
        self.assertEqual(outsider.get(f"/events/{event_id}/reassessments").status_code, 403)
        self.assertEqual(outsider.post(f"/events/{event_id}/preparation").status_code, 403)
        self.assertEqual(self.organiser.post(f"/events/{event_id}/reassessments/{self.flags(event_id)[0]['id']}/resolve", json={"note": "No"}).status_code, 403)

    def test_acceptance_failure_rolls_back_decision_flags_and_notifications(self):
        event_id = self.equipped()["event_id"]
        request_id = self.proposal(event_id)
        # Deliberate fault injection verifies transaction rollback, not a mocked
        # successful workflow or evaluator. The client re-raises server errors.
        with patch('event_changes.reassessment.messaging.notify', side_effect=RuntimeError("injected notification failure")):
            with self.assertRaises(RuntimeError):
                self.decision(event_id, request_id, {"equip": []})
        self.db.expire_all()
        self.assertEqual(self.db.get(models.EventChangeRequest, request_id).status, "pending")
        self.assertEqual(self.flags(event_id), [])
        self.assertEqual(self.decision(event_id, request_id, {"equip": []}).status_code, 200)

    def test_US50_mixed_valid_invalid_reservations_only_flags_the_invalid_one(self):
        event_id = self.equipped("Mixed equipment", second=True)["event_id"]
        response = self.decision(event_id, self.proposal(event_id), {"equip": [
            {"id": "E2", "qty": 2, "technicalRequirements": "Front"},
            {"id": "E1", "qty": 1, "technicalRequirements": "Stage"}]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(self.flags(event_id)), 1)
        self.db.expire_all()
        reservation = self.db.query(models.EquipmentReservation).filter_by(event_id=event_id, item_id="E2").one()
        self.assertEqual(self.flags(event_id)[0]["targetId"], reservation.id)
        self.assertEqual(self.flags(event_id, self.tech)[0]["targetType"], "equipment")
        other_tech = self.client(Role.tech, "othertech@test.edu")
        self.assertEqual(other_tech.get(f"/events/{event_id}/reassessments").status_code, 403)
        self.assertFalse([n for n in self.notices(other_tech) if n[0] == "Equipment requires reassessment"])

    def test_US51_affected_registered_attendees_are_notified_even_when_settings_remain_valid(self):
        event_id, attendees = self.registered_event()
        response = self.decision(event_id, self.proposal(event_id), {"start": "11:00", "end": "13:00"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse([flag for flag in self.flags(event_id) if flag["targetType"] == "registration"])
        self.assertEqual([flag["targetType"] for flag in self.flags(event_id)], ["venue"])
        for index, attendee in enumerate(attendees):
            self.assertEqual(len([n for n in self.notices(attendee) if n[0] == "Event changed"]), 1 if index < 2 else 0)

    def test_validation_and_permissions_preserve_pending_decision(self):
        event_id = self.equipped()["event_id"]
        request_id = self.proposal(event_id)
        for changes in ({"start": "23:00", "end": "10:00"}, {"regCap": 0}, {"status": "confirmed"}):
            response = self.decision(event_id, request_id, changes)
            self.assertEqual(response.status_code, 422, response.text)
        for client in (self.organiser, self.client(Role.coordinator, "notassigned@test.edu")):
            self.assertEqual(self.decision(event_id, request_id, {"equip": []}, client=client).status_code, 403)
        self.db.expire_all()
        self.assertEqual(self.db.get(models.EventChangeRequest, request_id).status, "pending")
        self.assertEqual(self.flags(event_id), [])
        self.assertEqual(self.decision(event_id, request_id, {"equip": []}, outcome="rejected").status_code, 422)

    def test_US45_approval_cannot_carry_rework_targets_and_duplicates_are_rejected(self):
        booking = self.equipped()
        event_id = booking["event_id"]
        self.assertEqual(self.send(event_id).status_code, 200)
        target = {"type": "venue", "id": booking["id"]}
        path = f"/events/{event_id}/safety-check"
        for body in ({"outcome": "approved", "targets": [target]},
                     {"outcome": "rejected", "comment": "Review", "targets": [target, target]}):
            response = self.hannah.post(path, json=body)
            self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.status_of(event_id), "pending_safety_review")
        self.assertEqual(self.flags(event_id), [])

    def test_reviewed_period_change_cannot_bypass_the_shared_venue_gate(self):
        booking = self.ready_event("Revised venue period")
        event_id = booking["event_id"]
        request_id = self.proposal(event_id)
        response = self.decision(event_id, request_id, {"start": "11:00", "end": "13:00"})
        self.assertEqual(response.status_code, 200, response.text)
        flag = self.flags(event_id)[0]
        self.assertEqual(flag["targetType"], "venue")
        self.assertEqual(self.coordinator.post(f"/events/{event_id}/change-requests/{request_id}/apply").status_code, 200)
        self.assertEqual(self.resolve(event_id, flag["id"]).status_code, 409)
        self.assertEqual(self.send(event_id).status_code, 409)
        # Use the existing venue cancellation/rebooking workflow, not a new one.
        cancelled = self.coordinator.post(f"/bookings/{booking['id']}/cancel")
        self.assertEqual(cancelled.status_code, 200, cancelled.text)
        replacement = self.submit(event_id, venue_id=booking["venue_id"])
        self.assertEqual(replacement.status_code, 200, replacement.text)
        new_id = replacement.json()["booking"]["id"]
        self.assertEqual(self.decide(new_id, "approved").status_code, 200)
        self.assertEqual(self.resolve(event_id, flag["id"]).status_code, 200)
        self.assertEqual(self.send(event_id).status_code, 200)

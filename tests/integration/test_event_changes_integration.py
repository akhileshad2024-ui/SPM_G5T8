"""US33: actual signed FastAPI sessions → SQLAlchemy → isolated SQLite, not Supabase."""
from tests.integration.test_us05_save_event_draft_integration import US05DraftApiTestCase
from fastapi.testclient import TestClient
import models
from login.models import Role, User


class TestEventChangeRequestsApi(US05DraftApiTestCase):
    def setUp(self):
        super().setUp()
        owner = self.db.query(User).filter_by(email="organiser.one@connectsphere.edu").one()
        coordinator = self.db.query(User).filter_by(email="coordinator@connectsphere.edu").one()
        self.event = models.Event(name="US33 test", organiser_id=owner.id,
                                  coordinator_id=coordinator.id, status="submitted", expected_attendance=85)
        self.db.add(self.event)
        self.db.commit()
        self.url = f"/events/{self.event.id}/change-requests"

    def submit(self, client=None, **body):
        return (client or self.organiser).post(self.url, json=body or {"proposed_changes": "Attendance 90"})

    def test_ac1_ac2_ac3_saved_proposal_survives_new_request_without_event_mutation(self):
        # US33-TC01: save once, read back the same request ID; not an event update.
        response = self.submit()
        self.assertEqual(response.status_code, 201, response.text)
        saved = response.json()
        self.assertEqual(saved["requested_by_id"], self.event.organiser_id)
        self.assertEqual(saved["status"], "pending")
        self.assertIsNone(saved["decision"])
        self.assertTrue(saved["requested_at"].endswith("Z"))
        self.assertEqual(self.organiser.get(self.url).json(), [saved])
        self.assertEqual(self.coordinator.get(self.url).json(), [saved])
        self.db.expire_all()
        self.assertEqual((self.event.status, self.event.expected_attendance), ("submitted", 85))
        self.assertEqual(self.db.query(models.Event).count(), 1)
        self.assertEqual(self.db.query(models.EventChangeRequest).count(), 1)

    def test_ac1_confirmed_events_can_receive_proposals(self):
        self.event.status = "confirmed"
        self.db.commit()
        self.assertEqual(self.submit().status_code, 201)
        self.db.expire_all()
        self.assertEqual(self.event.status, "confirmed")

    def test_other_owner_and_unassigned_coordinator_cannot_read_requests(self):
        self.assertEqual(self.submit(self.other_organiser).status_code, 403)
        self.assertEqual(self.other_organiser.get(self.url).status_code, 403)
        self.event.coordinator_id = None
        self.db.commit()
        self.assertEqual(self.coordinator.get(self.url).status_code, 403)

    def test_session_and_role_checks(self):
        self.assertEqual(self.submit(TestClient(self.organiser.app)).status_code, 401)
        self.assertEqual(self.submit(self.coordinator).status_code, 403)
        venue = self.client(Role.venue, "venue.us33@test.edu")
        self.assertEqual(venue.get(self.url).status_code, 403)

    def test_client_cannot_supply_identity_decision_or_state_and_empty_text_is_rejected(self):
        for body in [{"proposed_changes": " "}, {"proposed_changes": "Change", "requested_by_id": 99},
                     {"proposed_changes": "Change", "status": "accepted"},
                     {"proposed_changes": "Change", "decision": {"outcome": "accepted"}}]:
            with self.subTest(body=body):
                self.assertEqual(self.submit(**body).status_code, 422)
        self.assertEqual(self.db.query(models.EventChangeRequest).count(), 0)

    def test_missing_event_and_draft(self):
        self.assertEqual(self.organiser.get("/events/999999/change-requests").status_code, 404)
        self.assertEqual(self.organiser.post("/events/999999/change-requests", json={"proposed_changes": "Change"}).status_code, 404)
        self.event.status = "draft"
        self.db.commit()
        self.assertEqual(self.submit().status_code, 409)

    def test_ac3_existing_outcome_is_returned_without_implementing_us34_decision(self):
        # API fixture represents a future US34 result; not a claimed UI/US34 execution.
        self.submit()
        request = self.db.query(models.EventChangeRequest).one()
        request.status = "rejected"
        request.decision = {"outcome": "rejected", "reason": "Venue capacity"}
        self.db.commit()
        result = self.organiser.get(self.url).json()[0]
        self.assertEqual(result["decision"], request.decision)
        self.assertEqual(result["status"], "rejected")

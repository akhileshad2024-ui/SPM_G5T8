"""US33/US34: signed FastAPI sessions → SQLAlchemy → isolated SQLite, not Supabase."""
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

        # US33-AC2 / TC01: the real submit route saves exactly one notice for
        # the assigned coordinator; organisers and unrelated coordinators do not get it.
        inbox = self.coordinator.get("/notifications")
        self.assertEqual(inbox.status_code, 200, inbox.text)
        notices = [n for n in inbox.json() if n["eventId"] == self.event.id and n["title"] == "Change requested"]
        self.assertEqual(len(notices), 1)
        notice = notices[0]
        self.assertIn(self.event.name, notice["body"])
        self.assertIn(saved["proposed_changes"], notice["body"])
        self.assertIn(notice, self.coordinator.get("/notifications").json())
        unrelated = self.client(Role.coordinator, "unrelated.us33@test.edu")
        for other in (self.organiser, self.other_organiser, unrelated):
            other_inbox = other.get("/notifications")
            self.assertEqual(other_inbox.status_code, 200, other_inbox.text)
            self.assertFalse(any(n["eventId"] == self.event.id and n["title"] == "Change requested" for n in other_inbox.json()))

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

    def decision_url(self):
        request_id = self.submit().json()["id"]
        return f"{self.url}/{request_id}/decision"

    def test_us34_tc01_tc02_decisions_persist_for_owner_without_editing_event(self):
        # AC1/AC3/AC4: both outcomes, blank reason permitted, no auto-apply.
        for outcome in ["accepted", "rejected"]:
            with self.subTest(outcome=outcome):
                url = self.decision_url()
                response = self.coordinator.post(url, json={"outcome": outcome})
                self.assertEqual(response.status_code, 200, response.text)
                saved = response.json()
                self.assertEqual(saved["status"], outcome)
                decision = saved["decision"]
                self.assertEqual(decision["outcome"], outcome)
                self.assertEqual(decision["by_id"], self.event.coordinator_id)
                self.assertEqual(decision["by"], "coordinator")
                self.assertTrue(decision["at"])
                self.assertEqual(decision["reason"], "")
                restored = self.organiser.get(self.url).json()
                self.assertIn(saved, restored)
                self.assertIn(saved, self.coordinator.get(self.url).json())
                self.db.expire_all()
                self.assertEqual((self.event.status, self.event.expected_attendance), ("submitted", 85))
                self.assertEqual(self.db.query(models.Event).count(), 1)

    def test_us34_existing_decision_is_not_overwritten_on_duplicate_click(self):
        url = self.decision_url()
        first = self.coordinator.post(url, json={"outcome": "accepted", "reason": "  Reviewed  "}).json()
        self.assertEqual(self.coordinator.post(url, json={"outcome": "rejected"}).status_code, 409)
        self.assertEqual(self.organiser.get(self.url).json()[0], first)
        self.assertEqual(first["decision"]["reason"], "Reviewed")

    def test_us34_confirmed_event_and_recorded_arrangements_are_preserved(self):
        self.event.status = "confirmed"
        self.event.layout = "theatre"
        self.event.equipment = [{"id": "E2", "qty": 2}]
        self.event.equipment_state = "reserved"
        self.event.registration_required = True
        self.event.registration_cap = 100
        self.db.commit()
        before = {column.name: getattr(self.event, column.name) for column in models.Event.__table__.columns}
        response = self.coordinator.post(self.decision_url(), json={"outcome": "accepted"})
        self.assertEqual(response.status_code, 200, response.text)
        self.db.expire_all()
        self.assertEqual({column.name: getattr(self.event, column.name) for column in models.Event.__table__.columns}, before)

    def test_us34_authentication_role_and_assignment_are_enforced(self):
        url = self.decision_url()
        for client, code in [(TestClient(self.organiser.app), 401), (self.organiser, 403),
                             (self.other_organiser, 403),
                             (self.client(Role.coordinator, "other.coordinator@test.edu"), 403)]:
            with self.subTest(code=code):
                self.assertEqual(client.post(url, json={"outcome": "accepted"}).status_code, code)
        self.assertEqual(self.organiser.get(self.url).json()[0]["status"], "pending")

    def test_us34_unassigned_event_cannot_be_reviewed(self):
        url = self.decision_url()
        self.event.coordinator_id = None
        self.db.commit()
        self.assertEqual(self.coordinator.post(url, json={"outcome": "accepted"}).status_code, 403)

    def test_us34_request_must_belong_to_url_event(self):
        url = self.decision_url()
        other = models.Event(name="Other", organiser_id=self.event.organiser_id, status="submitted")
        self.db.add(other)
        self.db.commit()
        wrong_url = url.replace(f"/events/{self.event.id}/", f"/events/{other.id}/")
        self.assertEqual(self.coordinator.post(wrong_url, json={"outcome": "accepted"}).status_code, 404)
        self.assertEqual(self.coordinator.post("/events/999999/change-requests/999999/decision",
                                             json={"outcome": "accepted"}).status_code, 404)

    def test_us34_client_cannot_forge_audit_fields_or_invalid_outcome(self):
        url = self.decision_url()
        for body in [{"outcome": "approved"}, {"outcome": "accepted", "by_id": 99},
                     {"outcome": "accepted", "at": "2030-01-01T00:00:00Z"}]:
            with self.subTest(body=body):
                self.assertEqual(self.coordinator.post(url, json=body).status_code, 422)

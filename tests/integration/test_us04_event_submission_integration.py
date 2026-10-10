"""US04: real FastAPI/SQLAlchemy with isolated SQLite, never shared Supabase."""

from fastapi.testclient import TestClient
from tests.integration.test_us05_save_event_draft_integration import US05DraftApiTestCase
import models
from login.models import Role


class TestEventSubmissionApi(US05DraftApiTestCase):
    def submit(self, client, information, draft_id=None):
        return client.post("/event-requests/submit", json={
            "event_information": information, "draft_id": draft_id,
            "organiser_id": 999, "coordinator_id": 999,
        })

    def test_tc01_new_submission_survives_a_new_authenticated_request(self):
        # US04-TC01: persisted status/information, not browser memory.
        # AC4 producer boundary: leave the record unassigned for the future Lead queue.
        information = {"name": "US04 Submission", "pax": "85"}
        response = self.submit(self.organiser, information)
        self.assertEqual(response.status_code, 201, response.text)
        saved = self.db.get(models.Event, response.json()["id"])
        self.assertEqual(saved.status, "submitted")
        self.assertIsNotNone(saved.submitted_at)
        self.assertIsNone(saved.coordinator_id)
        client = self.client(Role.organiser, "organiser.one@connectsphere.edu")
        restored = client.get("/event-requests").json()
        self.assertEqual(restored[0]["status"], "submitted")
        self.assertEqual(restored[0]["draft_form"], information)
        self.assertEqual(self.other_organiser.get("/event-requests").json(), [])

    def test_tc01_existing_draft_transitions_in_place_and_cannot_be_edited(self):
        draft_id = self.save_draft(self.organiser, {"name": "Before"}).json()["id"]
        response = self.submit(self.organiser, {"name": "After"}, draft_id)
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["id"], draft_id)
        self.assertEqual(self.db.query(models.Event).count(), 1)
        # US04-TC02 / AC4: updating a draft must also produce an unassigned submission.
        submitted = self.db.get(models.Event, draft_id)
        self.assertEqual(submitted.status, "submitted")
        self.assertIsNone(submitted.coordinator_id)
        self.assertEqual(submitted.draft_form, {"name": "After"})
        self.assertEqual(self.organiser.get("/event-requests/drafts").json(), [])
        self.assertEqual(self.organiser.get(f"/event-requests/drafts/{draft_id}").status_code, 404)
        self.assertEqual(self.organiser.put(f"/event-requests/drafts/{draft_id}",
            json={"event_information": {"name": "Forbidden"}}).status_code, 404)
        self.assertEqual(self.submit(self.organiser, {}, draft_id).status_code, 404)
        self.db.expire_all()
        self.assertEqual(self.db.get(models.Event, draft_id).name, "After")

    def test_other_owner_and_missing_drafts_cannot_be_submitted(self):
        draft_id = self.save_draft(self.organiser, {"name": "Private"}).json()["id"]
        self.assertEqual(self.submit(self.other_organiser, {}, draft_id).status_code, 404)
        self.assertEqual(self.submit(self.organiser, {}, 999999).status_code, 404)
        self.db.expire_all()
        self.assertEqual(self.db.get(models.Event, draft_id).status, "draft")

    def test_only_authenticated_organisers_can_list_or_submit(self):
        for client, code in [(TestClient(self.organiser.app), 401), (self.coordinator, 403)]:
            self.assertEqual(self.submit(client, {}).status_code, code)
            self.assertEqual(client.get("/event-requests").status_code, code)

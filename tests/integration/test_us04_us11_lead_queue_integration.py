"""US04 -> US11/US43: the Event Coordinator Lead's unassigned queue (GET /lead/queue).

The integration designs INT01-INT04 from docs/US04_US11_Integration_Handover.md, run against the real
FastAPI app and SQLAlchemy on an isolated SQLite database (never Supabase), with real session tokens.
"""

from fastapi.testclient import TestClient

from tests.integration.test_us05_save_event_draft_integration import US05DraftApiTestCase
import models
from login.models import Role
from main import app

LEAD_EMAIL = "grace.ong@connectsphere.edu"


class TestLeadQueue(US05DraftApiTestCase):
    def setUp(self):
        super().setUp()
        self.lead = self.client(Role.lead, LEAD_EMAIL)

    def submit(self, information, draft_id=None):
        response = self.organiser.post("/event-requests/submit", json={"event_information": information, "draft_id": draft_id})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["id"]

    def queue(self, client=None):
        return (client or self.lead).get("/lead/queue")

    def test_int01_a_new_submission_appears_once_in_the_lead_queue(self):
        event_id = self.submit({"name": "US04 Lead Queue Handover Test", "purpose": "Testing submission to the Lead queue", "pax": "85"})
        rows_before = self.db.query(models.Event).count()

        fresh_lead = self.client(Role.lead, LEAD_EMAIL)  # a new request/session
        response = self.queue(fresh_lead)

        self.assertEqual(response.status_code, 200, response.text)
        matching = [e for e in response.json() if e["id"] == event_id]
        self.assertEqual(len(matching), 1)
        self.assertEqual((matching[0]["status"], matching[0]["coordinator"]), ("submitted", None))
        self.assertEqual(matching[0]["name"], "US04 Lead Queue Handover Test")
        self.assertEqual(matching[0]["purpose"], "Testing submission to the Lead queue")
        self.assertEqual(self.db.query(models.Event).count(), rows_before)  # reading adds no rows

    def test_int02_a_submitted_draft_appears_once_under_its_own_id(self):
        draft_id = self.save_draft(self.organiser, {"name": "Draft first"}).json()["id"]
        self.assertEqual(self.submit({"name": "Draft first"}, draft_id), draft_id)

        ids = [e["id"] for e in self.queue().json()]

        self.assertEqual(ids.count(draft_id), 1)
        self.assertEqual(self.db.query(models.Event).count(), 1)

    def test_int03_only_submitted_unassigned_requests_are_listed(self):
        draft_id = self.save_draft(self.organiser, {"name": "Still a draft"}).json()["id"]
        unassigned = self.submit({"name": "Waiting for a coordinator"})
        assigned = self.submit({"name": "Already assigned"})
        priya = self.coordinator.get("/auth/me").json()["id"]
        self.assertEqual(self.lead.post(f"/events/{assigned}/assign", json={"coordinatorId": priya}).status_code, 200)

        ids = [e["id"] for e in self.queue().json()]

        self.assertEqual(ids, [unassigned])
        self.assertNotIn(draft_id, ids)
        self.assertNotIn(assigned, ids)

    def test_int04_no_session_is_401_and_other_roles_are_403(self):
        self.submit({"name": "Private queue"})
        self.assertEqual(self.queue(TestClient(app)).status_code, 401)
        for role, email in ((Role.organiser, "organiser.one@connectsphere.edu"), (Role.coordinator, "coordinator@connectsphere.edu"),
                            (Role.venue, "venue@connectsphere.edu"), (Role.tech, "tech@connectsphere.edu"),
                            (Role.attendee, "attendee@connectsphere.edu")):
            with self.subTest(role=role.value):
                response = self.queue(self.client(role, email))
                self.assertEqual(response.status_code, 403)
                self.assertNotIn("Private queue", response.text)

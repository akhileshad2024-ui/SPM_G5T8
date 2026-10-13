"""US06: real FastAPI → SQLAlchemy → isolated SQLite test database.

Reuses the US05 signed-session/database fixture, not a mocked database.
SQLite proves the API/persistence boundary; it does not prove PostgreSQL
row-lock semantics or Supabase deployment configuration.
"""

import unittest

from tests.integration.test_us05_save_event_draft_integration import US05DraftApiTestCase
from fastapi.testclient import TestClient
import models


class TestEventDraftEditingApi(US05DraftApiTestCase):
    def draft_id(self, information=None):
        response = self.save_draft(self.organiser, information or {"name": "US06 Draft"})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["id"]

    def test_ac1_list_contains_only_own_drafts(self):
        # US06-TC01/TC02: list excludes other owners and submitted events.
        own_id = self.draft_id()
        submitted_id = self.draft_id({"name": "Submitted request"})
        self.save_draft(self.other_organiser, {"name": "Private draft"})
        self.db.get(models.Event, submitted_id).status = "submitted"
        self.db.commit()

        response = self.organiser.get("/event-requests/drafts")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([draft["id"] for draft in response.json()], [own_id])

    def test_ac2_reopen_restores_all_saved_information(self):
        # US06-TC01: nested selections, blank fields and times survive a new request.
        information = {"name": "US06 Draft", "date": "", "start": "09:00",
                       "equip": {"microphone": 2}, "access": ["Step-free access"]}
        event_id = self.draft_id(information)
        response = self.organiser.get(f"/event-requests/drafts/{event_id}")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["draft_form"], information)

    def test_ac3_resave_updates_same_row_without_creating_a_duplicate(self):
        # US06-TC01: unchanged ID/count and latest saved information after two saves.
        event_id = self.draft_id()
        owner = self.db.get(models.Event, event_id).organiser_id
        for name in ["First edit", "Second edit"]:
            information = {"name": name, "purpose": "Revised purpose", "pax": "85"}
            response = self.organiser.put(f"/event-requests/drafts/{event_id}", json={
                "event_information": information, "organiser_id": 999, "status": "submitted"})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["id"], event_id)
            self.db.expire_all()
            saved = self.db.get(models.Event, event_id)
            self.assertEqual((saved.draft_form, saved.status, saved.organiser_id),
                             (information, "draft", owner))
            self.assertEqual((saved.name, saved.purpose), (name, "Revised purpose"))
        self.assertEqual(self.db.query(models.Event).count(), 1)

    def test_ac3_incomplete_information_can_be_resaved(self):
        event_id = self.draft_id()
        response = self.organiser.put(f"/event-requests/drafts/{event_id}",
                                     json={"event_information": {}})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["draft_form"], {})

    def test_ac4_other_owner_missing_and_submitted_records_are_inaccessible(self):
        # US06-TC02: neither GET nor PUT may expose or alter these records.
        event_id = self.draft_id()
        for client, target in [(self.other_organiser, event_id), (self.organiser, 999999)]:
            self.assertEqual(client.get(f"/event-requests/drafts/{target}").status_code, 404)
            self.assertEqual(client.put(f"/event-requests/drafts/{target}",
                json={"event_information": {"name": "Not allowed"}}).status_code, 404)
        self.db.expire_all()
        self.assertEqual(self.db.get(models.Event, event_id).name, "US06 Draft")
        self.db.get(models.Event, event_id).status = "submitted"
        self.db.commit()
        self.assertEqual(self.organiser.get(f"/event-requests/drafts/{event_id}").status_code, 404)
        self.assertEqual(self.organiser.put(f"/event-requests/drafts/{event_id}",
            json={"event_information": {}}).status_code, 404)
        self.db.expire_all()
        self.assertEqual(self.db.get(models.Event, event_id).status, "submitted")

    def test_endpoints_require_an_authenticated_organiser(self):
        # US06-TC02: server-side role/session checks protect all three endpoints.
        event_id = self.draft_id()
        for client, expected in [(TestClient(self.organiser.app), 401), (self.coordinator, 403)]:
            self.assertEqual(client.get("/event-requests/drafts").status_code, expected)
            self.assertEqual(client.get(f"/event-requests/drafts/{event_id}").status_code, expected)
            self.assertEqual(client.put(f"/event-requests/drafts/{event_id}",
                json={"event_information": {}}).status_code, expected)


if __name__ == "__main__":
    unittest.main()

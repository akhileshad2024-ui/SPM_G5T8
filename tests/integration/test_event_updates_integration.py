"""US16 FastAPI → SQLAlchemy → isolated SQLite DB (not shared Supabase).

Protect persistence/ownership/history boundaries of US16-TC01. SQLite does not
prove PostgreSQL locking or Supabase RLS; notification delivery is not mocked as Pass.
"""
from datetime import date
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from tests.integration.test_us05_save_event_draft_integration import US05DraftApiTestCase
from login.models import Role, User
import models


class TestEventUpdatesApi(US05DraftApiTestCase):
    def setUp(self):
        super().setUp()
        self.actor = self.db.query(User).filter(User.role == Role.coordinator).one()
        owner = self.db.query(User).filter(User.email == "organiser.one@connectsphere.edu").one()
        self.event = models.Event(name="US16", purpose="Original", expected_attendance=85,
            date=date(2026, 11, 20), organiser_id=owner.id, coordinator_id=self.actor.id,
            status=models.EventStatus.under_review, facilities=[], accessibility=[], equipment=[],
            registration_required=False)
        self.db.add(self.event)
        self.db.commit()
        self.path = f"/events/{self.event.id}"

    def test_TC01_ordinary_then_important_change_persists_with_actor_and_time(self):
        first = self.coordinator.patch(self.path + "/details", json={"purpose": "Revised"})
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json()["purpose"], "Revised")
        self.assertEqual(self.db.query(models.EventDetailChange).count(), 0)
        response = self.coordinator.patch(self.path + "/details", json={"pax": 90})
        self.assertEqual(response.status_code, 200, response.text)
        # A new GET/client request reads persisted values, not component state.
        self.assertEqual(self.organiser.get(self.path).json()["pax"], 90)
        history = self.coordinator.get(self.path + "/detail-changes")
        self.assertEqual(history.status_code, 200)
        row = history.json()[0]
        self.assertEqual(row["changes"], {"pax": 90})
        self.assertEqual(row["changedBy"], self.actor.name)
        self.assertTrue(row["changedAt"].endswith("Z"))
        self.assertTrue(row["affectsArrangements"])
        self.assertEqual(self.organiser.get(self.path + "/detail-changes").json(), history.json())
        self.db.expire_all()
        saved = self.db.get(models.Event, self.event.id)
        self.assertEqual((saved.status, saved.organiser_id, saved.date),
            (models.EventStatus.under_review, self.event.organiser_id, date(2026, 11, 20)))

    def test_denies_organiser_unassigned_coordinator_and_anonymous(self):
        other = self.client(Role.coordinator, "other.coordinator@connectsphere.edu")
        for client, status in [(self.organiser, 403), (other, 403), (TestClient(self.organiser.app), 401)]:
            response = client.patch(self.path + "/details", json={"pax": 90})
            self.assertEqual(response.status_code, status, response.text)
        self.db.expire_all()
        self.assertEqual(self.db.get(models.Event, self.event.id).expected_attendance, 85)
        self.assertEqual(self.db.query(models.EventDetailChange).count(), 0)

    def test_missing_event_and_closed_status(self):
        self.assertEqual(self.coordinator.patch("/events/999999/details", json={}).status_code, 404)
        self.assertEqual(self.coordinator.get("/events/999999/detail-changes").status_code, 404)
        self.event.status = models.EventStatus.confirmed
        self.db.commit()
        self.assertEqual(self.coordinator.patch(self.path + "/details", json={"pax": 90}).status_code, 409)

    def test_history_is_not_visible_to_unrelated_organiser(self):
        self.assertEqual(self.other_organiser.get(self.path + "/detail-changes").status_code, 403)

    def test_repeated_save_is_a_noop_not_duplicate_history(self):
        for _ in range(2):
            self.assertEqual(self.coordinator.patch(self.path + "/details", json={"pax": 90}).status_code, 200)
        self.assertEqual(self.db.query(models.EventDetailChange).count(), 1)

    def test_invalid_or_protected_input_does_not_write(self):
        for body in [{"status": "approved"}, {"coordinator_id": 99}, {"name": None},
                     {"facilities": None}, {"equip": None}, {"reg": None}, {"access": None},
                     {"pax": 0}, {"equip": [{"id": "CUSTOM", "qty": 1}]}]:
            response = self.coordinator.patch(self.path + "/details", json=body)
            self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.db.query(models.EventDetailChange).count(), 0)

    def test_nullable_fields_and_equipment_serialize_in_history(self):
        response = self.coordinator.patch(self.path + "/details", json={
            "date": None, "equip": [{"id": "E1", "qty": 1}], "regCap": None})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(response.json()["date"])
        self.assertEqual(self.coordinator.get(self.path + "/detail-changes").json()[0]["changes"],
            {"date": None, "equip": [{"id": "E1", "qty": 1, "technicalRequirements": ""}]})

    def test_description_change_with_arrangements_is_recorded(self):
        self.event.booking_state = "approved"
        self.db.commit()
        self.assertEqual(self.coordinator.patch(self.path + "/details", json={"purpose": "Revised"}).status_code, 200)
        self.assertEqual(self.db.query(models.EventDetailChange).count(), 1)

    def test_history_failure_rolls_back_the_event_too(self):
        # Inject a failed history INSERT; closing the request session rolls back
        # the entire transaction, so no unaudited important edit survives.
        from sqlalchemy.orm import Session
        original = Session.commit

        def fail_commit(session):
            if any(isinstance(item, models.EventDetailChange) for item in session.new):
                session.flush()
                raise IntegrityError("test history failure", {}, Exception("test"))
            return original(session)

        with patch.object(Session, "commit", fail_commit):
            with pytest.raises(IntegrityError):
                self.coordinator.patch(self.path + "/details", json={"pax": 90})
        self.db.expire_all()
        self.assertEqual(self.db.get(models.Event, self.event.id).expected_attendance, 85)
        self.assertEqual(self.db.query(models.EventDetailChange).count(), 0)

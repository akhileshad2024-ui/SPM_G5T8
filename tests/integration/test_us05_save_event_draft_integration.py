"""Integration tests for US05 — Save Event Request as Draft.

Module boundary tested: FastAPI ``POST /event-requests/drafts`` → SQLAlchemy
``events`` table. The test uses a real FastAPI app and a fresh in-memory SQLite
test database, never the shared Supabase database.

Story-level test case traced here: US05-TC01.
Run from the project root:
    python -m unittest tests.integration.test_us05_save_event_draft_integration -v
"""

import os
import sys
import unittest
from pathlib import Path

# Preserve pytest's shared SQLite configuration; never connect this suite to Supabase.
# Replacing its file database with sqlite:// would give each worker a separate empty database.
if not os.environ.get("DATABASE_URL", "").startswith("sqlite:"):
    os.environ["DATABASE_URL"] = "sqlite://"
os.environ.setdefault("JWT_SECRET", "test-secret-for-us05-integration-tests-0123456789")

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import models
from database import Base, engine as application_engine, get_db
from login.models import Role, User
from login.security import COOKIE_NAME, create_session_token
from main import app


class US05DraftApiTestCase(unittest.TestCase):
    """A fresh test database and signed-in clients for every integration test."""

    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        Base.metadata.create_all(bind=self.engine)
        Session = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)

        def override_get_db():
            db = Session()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        self.db = Session()
        self.organiser = self.client(Role.organiser, "organiser.one@connectsphere.edu")
        self.other_organiser = self.client(Role.organiser, "organiser.two@connectsphere.edu")
        self.coordinator = self.client(Role.coordinator, "coordinator@connectsphere.edu")

    def tearDown(self):
        self.db.close()
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=self.engine)
        self.engine.dispose()
        # Do not dispose the shared application engine: other suites own its lifecycle.
        if "pytest" not in sys.modules:
            application_engine.dispose()

    def client(self, role, email):
        """Return a TestClient with a real signed session for the given role."""
        client = TestClient(app)
        user = self.db.query(User).filter(User.email == email).first()
        if user is None:
            user = User(email=email, name=email.split("@")[0], role=role, password_hash="unused")
            self.db.add(user)
            self.db.commit()
            self.db.refresh(user)
        client.cookies.set(COOKIE_NAME, create_session_token(user))
        return client

    def save_draft(self, client, event_information):
        return client.post("/event-requests/drafts", json={"event_information": event_information})


class TestUS05SaveEventDraft(US05DraftApiTestCase):
    """Integration tests for Story Test Case US05-TC01."""

    def test_ac1_organiser_can_save_incomplete_information_as_a_draft(self):
        # US05-TC01 / AC1: no event field has been entered yet.
        response = self.save_draft(self.organiser, {})

        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["status"], "draft")

    def test_ac2_saved_event_is_draft_and_uses_the_authenticated_organiser(self):
        # US05-TC01 / AC2: a body value must never choose the organiser ID.
        response = self.organiser.post(
            "/event-requests/drafts",
            json={"event_information": {"name": "Welcome Session"}, "organiser_id": 999999},
        )

        self.assertEqual(response.status_code, 201, response.text)
        saved = self.db.get(models.Event, response.json()["id"])
        session_user = self.db.query(User).filter(User.email == "organiser.one@connectsphere.edu").one()
        self.assertEqual((saved.status, saved.organiser_id), ("draft", session_user.id))

    def test_ac3_saved_information_is_retained_in_the_database(self):
        # US05-TC01 / AC3: all explicitly saved values survive the API/database boundary.
        information = {
            "name": "Welcome Session",
            "purpose": "Welcome new students",
            "expected_attendance": 80,
        }
        response = self.save_draft(self.organiser, information)

        self.assertEqual(response.status_code, 201, response.text)
        saved = self.db.get(models.Event, response.json()["id"])
        self.assertEqual((response.json()["draft_form"], saved.draft_form), (information, information))

    def test_only_an_authenticated_event_organiser_can_save_a_draft(self):
        # User Story role: an Event Organiser has this capability.
        self.assertEqual(self.save_draft(TestClient(app), {"name": "Welcome Session"}).status_code, 401)
        self.assertEqual(self.save_draft(self.coordinator, {"name": "Welcome Session"}).status_code, 403)


if __name__ == "__main__":
    unittest.main()

"""FastAPI -> SQLAlchemy -> isolated SQLite: US09 saved reply and review hand-off."""
import pytest
from fastapi.testclient import TestClient

import models
from auth_testkit import PASSWORD, login
from login import security
from login.models import Role, User
from main import app


@pytest.fixture
def conversation(signed_in):
    maya, priya = signed_in(Role.organiser), signed_in(Role.coordinator)
    created = maya.post("/event-requests/submit", json={"event_information": {"name": "US09 test", "pax": 85}})
    assert created.status_code == 201, created.text
    event_id = created.json()["id"]
    url = f"/events/{event_id}"
    assert priya.post(url + "/assign", json={"coordinatorId": priya.get("/auth/me").json()["id"]}).status_code == 200
    assert priya.post(url + "/review").status_code == 200
    assert priya.post(url + "/clarification", json={"kind": "clarification", "message": "Includes speakers?"}).status_code == 200
    return maya, priya, url, event_id


def other_session(db, role):
    email = "other-us09@example.test"
    db.add(User(email=email, name="Other user", role=role, password_hash=security.hash_password(PASSWORD),
                is_active=True, failed_login_attempts=0, session_version=0))
    db.commit()
    client = TestClient(app)
    assert login(client, email).status_code == 200
    return client


def test_US09_AC1_AC2_AC3_reply_survives_new_session_and_coordinator_can_continue(conversation, db):
    maya, priya, url, event_id = conversation
    before = maya.get(url).json()
    response = maya.post(url + "/clarification-response", json={"message": "  Yes, includes 5 speakers.  "})
    assert response.status_code == 200, response.text
    reply = response.json()["clarification"]["response"]
    assert reply["message"] == "Yes, includes 5 speakers."
    assert reply["respondedBy"] == "Maya Rahman"
    assert response.json()["status"] == "pending_clarification"  # No automatic transition.
    again = TestClient(app)
    assert login(again, "maya.rahman@connectsphere.edu").status_code == 200
    assert again.get(url).json()["clarification"]["response"] == reply
    assert priya.get(url).json()["clarification"]["response"] == reply
    assert priya.post(url + "/resume-review").json()["status"] == "under_review"
    for field in ("name", "pax", "date", "start", "end", "equip", "draftForm"):
        assert again.get(url).json()[field] == before[field]
    assert priya.get(url + "/history").json()[-1]["toStatus"] == "under_review"
    assert priya.post(url + "/clarification", json={"kind": "amendment", "message": "Clarify timing."}).status_code == 200
    assert again.get(url).json()["clarification"]["history"][0]["response"] == reply
    db.expire_all()
    assert db.get(models.Event, event_id).clarification["history"][0]["response"] == reply


@pytest.mark.parametrize("role", [Role.coordinator, Role.venue, Role.tech, Role.attendee])
def test_US09_wrong_role_cannot_reply(conversation, signed_in, role):
    _, _, url, _ = conversation
    assert signed_in(role).post(url + "/clarification-response", json={"message": "Answer"}).status_code == 403


def test_US09_other_organiser_cannot_view_or_reply(conversation, db):
    _, _, url, _ = conversation
    other = other_session(db, Role.organiser)
    assert other.get(url).status_code == 403
    assert other.post(url + "/clarification-response", json={"message": "Answer"}).status_code == 403


@pytest.mark.parametrize("message", ["", " ", "x" * 1001])
def test_US09_invalid_reply_is_not_saved(conversation, message):
    maya, _, url, _ = conversation
    assert maya.post(url + "/clarification-response", json={"message": message}).status_code == 422
    assert "response" not in maya.get(url).json()["clarification"]


def test_US09_repeated_reply_cannot_overwrite_saved_text(conversation):
    maya, _, url, _ = conversation
    assert maya.post(url + "/clarification-response", json={"message": "First"}).status_code == 200
    assert maya.post(url + "/clarification-response", json={"message": "Second"}).status_code == 409
    assert maya.get(url).json()["clarification"]["response"]["message"] == "First"


def test_US09_cannot_resume_before_reply_or_repeat_resume(conversation, db):
    maya, priya, url, _ = conversation
    assert priya.post(url + "/resume-review").status_code == 409
    assert maya.post(url + "/clarification-response", json={"message": "Answer"}).status_code == 200
    assert other_session(db, Role.coordinator).post(url + "/resume-review").status_code == 403
    assert maya.post(url + "/resume-review").status_code == 403
    assert priya.post(url + "/resume-review").status_code == 200
    assert priya.post(url + "/resume-review").status_code == 409
    assert maya.post(url + "/clarification-response", json={"message": "Again"}).status_code == 409


def test_US09_reply_payload_cannot_supply_identity_or_event_fields(conversation):
    maya, _, url, _ = conversation
    assert maya.post(url + "/clarification-response", json={"message": "Answer", "respondedBy": "Priya", "name": "Changed"}).status_code == 422
    assert maya.get(url).json()["name"] == "US09 test"


def test_US09_requires_login_and_existing_event(conversation):
    maya, priya, url, _ = conversation
    assert TestClient(app).post(url + "/clarification-response", json={"message": "Answer"}).status_code == 401
    assert maya.post("/events/999999/clarification-response", json={"message": "Answer"}).status_code == 404
    assert priya.post("/events/999999/resume-review").status_code == 404

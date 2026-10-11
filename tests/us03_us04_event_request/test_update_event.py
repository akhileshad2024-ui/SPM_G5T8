"""
PUT /events/{id}: an organiser keeps editing a saved draft (US03) or submits it (US04).
The stored request is updated in place, so saving a draft twice never creates two requests.
"""

from fastapi.testclient import TestClient
from sqlalchemy import text

import models
from auth_testkit import PASSWORD, login
from login import security
from login.models import Role, User
from main import app
from test_create_event import full_request, stored


def save_draft(session, **overrides):
    response = session.post("/events", json=full_request(submit=False, **overrides))
    assert response.status_code == 201, response.text
    return response.json()["id"]


def event_count(db):
    db.expire_all()
    return db.query(models.Event).count()


def test_resaving_a_draft_updates_it_instead_of_creating_another(signed_in, db):
    organiser = signed_in(Role.organiser)
    event_id = save_draft(organiser, name="First title")

    response = organiser.put(f"/events/{event_id}", json=full_request(submit=False, name="Better title"))

    assert response.status_code == 200, response.text
    assert response.json()["id"] == event_id
    assert stored(db, event_id).name == "Better title"
    assert event_count(db) == 1


def test_an_incomplete_draft_can_be_saved_again(signed_in, db):
    organiser = signed_in(Role.organiser)
    event_id = save_draft(organiser)

    response = organiser.put(f"/events/{event_id}", json={"submit": False, "name": "Still deciding"})

    assert response.status_code == 200
    assert stored(db, event_id).status == models.EventStatus.draft


def test_a_saved_draft_can_be_submitted(signed_in, db):
    organiser = signed_in(Role.organiser)
    event_id = save_draft(organiser)

    response = organiser.put(f"/events/{event_id}", json=full_request(submit=True))

    assert response.status_code == 200
    event = stored(db, event_id)
    assert event.status == models.EventStatus.submitted
    assert event.submitted_at is not None
    assert event.draft_form is None
    assert event_count(db) == 1


def test_cleared_json_fields_are_stored_as_sql_null(signed_in, db):
    """None must be SQL NULL, not the JSON value null, so `IS NULL` queries find these rows."""
    organiser = signed_in(Role.organiser)
    event_id = save_draft(organiser, draftForm={"name": "Half done"})
    organiser.put(f"/events/{event_id}", json=full_request(submit=True))

    db.expire_all()
    row = db.execute(
        text("SELECT draft_form IS NULL, clarification IS NULL, decision IS NULL FROM events WHERE id = :id"),
        {"id": event_id},
    ).one()
    assert tuple(row) == (True, True, True)


def test_submitting_a_saved_draft_applies_the_same_validation(signed_in, db):
    organiser = signed_in(Role.organiser)
    event_id = save_draft(organiser)

    response = organiser.put(f"/events/{event_id}", json=full_request(submit=True, name=""))

    assert response.status_code == 422
    assert response.json()["detail"]["errors"]["name"] == "Event name is required."
    assert stored(db, event_id).status == models.EventStatus.draft


def test_a_submitted_request_can_no_longer_be_edited(signed_in, db):
    organiser = signed_in(Role.organiser)
    event_id = organiser.post("/events", json=full_request(submit=True)).json()["id"]

    response = organiser.put(f"/events/{event_id}", json=full_request(submit=False, name="Changed"))

    assert response.status_code == 409
    assert stored(db, event_id).name == "Startup Pitch Night"


def test_another_organiser_cannot_edit_someone_elses_draft(signed_in, db):
    event_id = save_draft(signed_in(Role.organiser), name="Maya's draft")
    db.add(User(email="lin.chen@connectsphere.edu", name="Lin Chen", role=Role.organiser,
                password_hash=security.hash_password(PASSWORD), is_active=True,
                failed_login_attempts=0, session_version=0))
    db.commit()
    other = TestClient(app)
    assert login(other, "lin.chen@connectsphere.edu").status_code == 200

    response = other.put(f"/events/{event_id}", json=full_request(submit=False, name="Hijacked"))

    assert response.status_code == 403
    assert stored(db, event_id).name == "Maya's draft"


def test_other_roles_cannot_edit_event_requests(signed_in, db):
    event_id = save_draft(signed_in(Role.organiser))

    for role in (Role.coordinator, Role.venue, Role.tech, Role.attendee):
        assert signed_in(role).put(f"/events/{event_id}", json=full_request(submit=False)).status_code == 403


def test_editing_a_request_that_does_not_exist_returns_404(signed_in):
    assert signed_in(Role.organiser).put("/events/99999", json=full_request(submit=False)).status_code == 404


def test_signed_out_users_cannot_edit(client, signed_in):
    event_id = save_draft(signed_in(Role.organiser))

    assert client.put(f"/events/{event_id}", json=full_request(submit=False)).status_code == 401

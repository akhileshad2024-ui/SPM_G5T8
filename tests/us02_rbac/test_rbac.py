"""
US02 — Role-based access control (backend role checks).

Every protected endpoint needs a signed-in user, and venue management is
limited to Venue Staff. The role is re-read from the database on every
request, so permission changes take effect immediately.
"""

import pytest

from auth_testkit import email_for, get_user
from login.models import Role

VENUE = {"name": "Test Hall", "location": "Level 1", "cap": 100}
NOT_VENUE_STAFF = [r for r in Role if r is not Role.venue]


def create_venue(session):
    return session.post("/venues", json=VENUE)


@pytest.mark.parametrize(
    "method, path",
    [("GET", "/auth/me"), ("POST", "/auth/change-password"), ("GET", "/venues"), ("POST", "/venues"), ("PUT", "/venues/1")],
)
def test_signed_out_users_are_refused(client, method, path):
    assert client.request(method, path, json={}).status_code == 401


@pytest.mark.parametrize("role", list(Role))
def test_any_signed_in_role_can_view_venues(signed_in, role):
    assert signed_in(role).get("/venues").status_code == 200


def test_venue_staff_can_create_a_venue(signed_in):
    response = create_venue(signed_in(Role.venue))

    assert response.status_code == 200
    assert response.json()["name"] == VENUE["name"]


@pytest.mark.parametrize("role", NOT_VENUE_STAFF)
def test_other_roles_cannot_create_a_venue(signed_in, role):
    response = create_venue(signed_in(role))

    assert response.status_code == 403
    assert response.json()["detail"] == "You don't have permission to do that"


def test_refused_create_saves_nothing(signed_in):
    create_venue(signed_in(Role.attendee))

    assert signed_in(Role.venue).get("/venues").json() == []


def test_venue_staff_can_edit_a_venue(signed_in):
    staff = signed_in(Role.venue)
    venue_id = create_venue(staff).json()["id"]

    response = staff.put(f"/venues/{venue_id}", json={"cap": 250})

    assert response.status_code == 200
    assert response.json()["cap"] == 250


@pytest.mark.parametrize("role", NOT_VENUE_STAFF)
def test_other_roles_cannot_edit_or_deactivate_a_venue(signed_in, role):
    venue_id = create_venue(signed_in(Role.venue)).json()["id"]
    other = signed_in(role)

    assert other.put(f"/venues/{venue_id}", json={"cap": 1}).status_code == 403
    assert other.put(f"/venues/{venue_id}", json={"is_active": False}).status_code == 403


def test_editing_a_venue_that_does_not_exist_returns_404(signed_in):
    assert signed_in(Role.venue).put("/venues/99999", json={"cap": 10}).status_code == 404


def test_editor_is_taken_from_the_session_not_the_request(signed_in):
    """A client-supplied user_id is ignored, so nobody can act as someone else."""
    response = signed_in(Role.venue).post("/venues", json={**VENUE, "user_id": "someone-else"})

    assert response.status_code == 200
    assert response.json()["last_updated_by"] == email_for(Role.venue)


def test_role_change_takes_effect_immediately(signed_in, db):
    """The role is re-read on every request, not trusted from the session token."""
    session = signed_in(Role.attendee)
    assert create_venue(session).status_code == 403

    user = get_user(db, Role.attendee)
    user.role = Role.venue
    db.commit()

    assert create_venue(session).status_code == 200


def test_deactivated_user_loses_access_immediately(signed_in, db):
    session = signed_in(Role.venue)

    user = get_user(db, Role.venue)
    user.is_active = False
    db.commit()

    assert session.get("/auth/me").status_code == 401
    assert create_venue(session).status_code == 401


def test_me_reports_the_role_the_frontend_uses_for_page_access(signed_in):
    for role in Role:
        assert signed_in(role).get("/auth/me").json()["role"] == role.value


# ---------------------------------------------------------------- venue endpoints added for US17

INACTIVE_VIEWERS = [Role.venue, Role.coordinator]


def deactivated_venue(signed_in):
    staff = signed_in(Role.venue)
    venue_id = create_venue(staff).json()["id"]
    staff.put(f"/venues/{venue_id}", json={"is_active": False})
    return venue_id


@pytest.mark.parametrize("role", INACTIVE_VIEWERS)
def test_venue_staff_and_coordinators_can_list_deactivated_venues(signed_in, role):
    venue_id = deactivated_venue(signed_in)

    response = signed_in(role).get("/venues", params={"include_inactive": "true"})

    assert response.status_code == 200
    assert venue_id in [v["id"] for v in response.json()]


@pytest.mark.parametrize("role", [r for r in Role if r not in INACTIVE_VIEWERS])
def test_other_roles_cannot_list_deactivated_venues(signed_in, role):
    deactivated_venue(signed_in)

    response = signed_in(role).get("/venues", params={"include_inactive": "true"})

    assert response.status_code == 403
    assert response.json()["detail"] == "You don't have permission to do that"


def test_deactivated_venues_are_hidden_from_the_normal_list(signed_in):
    venue_id = deactivated_venue(signed_in)

    assert venue_id not in [v["id"] for v in signed_in(Role.attendee).get("/venues").json()]


def test_venue_staff_can_view_a_venues_change_history(signed_in):
    staff = signed_in(Role.venue)
    venue_id = create_venue(staff).json()["id"]

    response = staff.get(f"/venues/{venue_id}/history")

    assert response.status_code == 200
    assert len(response.json()) >= 1


@pytest.mark.parametrize("role", NOT_VENUE_STAFF)
def test_other_roles_cannot_view_change_history(signed_in, role):
    venue_id = create_venue(signed_in(Role.venue)).json()["id"]

    assert signed_in(role).get(f"/venues/{venue_id}/history").status_code == 403


@pytest.mark.parametrize("role", NOT_VENUE_STAFF)
def test_other_roles_cannot_attempt_to_delete_a_venue(signed_in, role):
    venue_id = create_venue(signed_in(Role.venue)).json()["id"]

    assert signed_in(role).delete(f"/venues/{venue_id}").status_code == 403


def test_venue_staff_are_told_venues_cannot_be_deleted(signed_in):
    """Even for permitted staff the server refuses, so booking history is never lost."""
    staff = signed_in(Role.venue)
    venue_id = create_venue(staff).json()["id"]

    assert staff.delete(f"/venues/{venue_id}").status_code == 409


@pytest.mark.parametrize("method, suffix", [("GET", "/history"), ("DELETE", "")])
def test_venue_staff_get_404_for_a_venue_that_does_not_exist(signed_in, method, suffix):
    assert signed_in(Role.venue).request(method, f"/venues/99999{suffix}").status_code == 404

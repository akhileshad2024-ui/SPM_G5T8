"""
US01 — AC1: the user can log in with a valid username and password.
US01 — AC2: the user is denied access and shown an error message when credentials are invalid.
"""

import os
import subprocess
import sys

import jwt
import pytest

from auth_testkit import (
    ACCOUNTS,
    BACKEND_DIR,
    PASSWORD,
    client_with_token,
    email_for,
    get_user,
    login,
    session_cookie,
    set_cookie_header,
)
from login.models import Role

INVALID_CREDENTIALS = "Incorrect email or password"


# ---------------------------------------------------------------- AC1: valid login

@pytest.mark.parametrize("role", list(Role))
def test_every_role_can_log_in_with_valid_credentials(client, role):
    response = login(client, email_for(role))

    assert response.status_code == 200
    body = response.json()
    assert body["email"] == email_for(role)
    assert body["name"] == ACCOUNTS[role][1]
    assert body["role"] == role.value


def test_login_starts_a_session_that_identifies_the_user(client):
    login(client, email_for(Role.venue))

    me = client.get("/auth/me")

    assert me.status_code == 200
    assert me.json()["email"] == email_for(Role.venue)


def test_login_is_case_and_whitespace_insensitive_for_the_email(client):
    response = login(client, "  DANIEL.Ortiz@ConnectSphere.edu ")

    assert response.status_code == 200
    assert response.json()["email"] == email_for(Role.venue)


def test_session_cookie_cannot_be_read_by_page_scripts(client):
    header = set_cookie_header(login(client, email_for(Role.tech))).lower()

    assert "httponly" in header
    assert "samesite=lax" in header


def test_login_response_never_contains_the_password_or_hash(client):
    response = login(client, email_for(Role.tech))

    assert PASSWORD not in response.text
    assert "password" not in response.json()
    assert "$argon2" not in response.text


def test_successful_login_resets_the_failed_attempt_counter(client, db):
    for _ in range(3):
        login(client, email_for(Role.tech), "wrong-password")
    assert get_user(db, Role.tech).failed_login_attempts == 3

    login(client, email_for(Role.tech))

    assert get_user(db, Role.tech).failed_login_attempts == 0


# ---------------------------------------------------------------- AC2: invalid credentials

def test_wrong_password_is_denied_with_an_error_message(client):
    response = login(client, email_for(Role.attendee), "not-the-password")

    assert response.status_code == 401
    assert response.json()["detail"] == INVALID_CREDENTIALS
    assert session_cookie(response) is None


def test_unknown_email_is_denied_with_the_same_error_message(client):
    unknown = login(client, "nobody@connectsphere.edu", "whatever-123")
    wrong_password = login(client, email_for(Role.attendee), "whatever-123")

    assert unknown.status_code == wrong_password.status_code == 401
    # Identical responses, so the login form can't be used to discover which emails exist.
    assert unknown.json() == wrong_password.json()


def test_denied_login_does_not_grant_access(client):
    login(client, email_for(Role.venue), "not-the-password")

    assert client.get("/auth/me").status_code == 401
    assert client.get("/venues").status_code == 401


def test_password_check_is_case_sensitive(client):
    response = login(client, email_for(Role.attendee), PASSWORD.lower())

    assert response.status_code == 401


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"email": "sam.adeyemi@student.connectsphere.edu"},
        {"password": PASSWORD},
        {"email": "sam.adeyemi@student.connectsphere.edu", "password": ""},
    ],
)
def test_missing_email_or_password_is_rejected(client, payload):
    assert client.post("/auth/login", json=payload).status_code == 422


def test_oversized_password_is_rejected_before_hashing(client):
    response = login(client, email_for(Role.attendee), "x" * 1000)

    assert response.status_code == 422


def test_deactivated_account_cannot_log_in(client, db):
    user = get_user(db, Role.organiser)
    user.is_active = False
    db.commit()

    response = login(client, email_for(Role.organiser))

    assert response.status_code == 401
    assert response.json()["detail"] == INVALID_CREDENTIALS


def test_requests_without_a_session_are_denied(client):
    assert client.get("/auth/me").status_code == 401


def test_tampered_session_token_is_denied(client):
    token = session_cookie(login(client, email_for(Role.attendee)))

    tampered = client_with_token(token[:-4] + ("AAAA" if not token.endswith("AAAA") else "BBBB"))

    assert tampered.get("/auth/me").status_code == 401


def test_token_signed_with_another_secret_is_denied(client):
    claims = {"sub": "5", "ver": 0, "auth_time": 0, "exp": 9999999999}
    forged = jwt.encode(claims, "some-other-secret-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy", algorithm="HS256")

    assert client_with_token(forged).get("/auth/me").status_code == 401


def test_logout_without_a_session_still_succeeds_and_clears_the_cookie(client):
    response = client.post("/auth/logout")

    assert response.status_code == 204
    assert "max-age=0" in set_cookie_header(response).lower()


@pytest.mark.parametrize("secret", ["", "too-short", "CHANGE_ME"])
def test_backend_refuses_to_start_without_a_strong_session_secret(secret):
    """Without a strong JWT_SECRET anyone could forge session tokens, so startup must fail."""
    env = {**os.environ, "JWT_SECRET": secret, "PYTHONIOENCODING": "utf-8"}
    result = subprocess.run(
        [sys.executable, "-c", "import login.security"],
        cwd=BACKEND_DIR, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )

    assert result.returncode != 0
    assert "JWT_SECRET is missing or too short" in result.stderr


def test_logout_revokes_the_session_on_the_server(client):
    token = session_cookie(login(client, email_for(Role.attendee)))

    assert client.post("/auth/logout").status_code == 204

    # A copy of the old cookie must stop working, not just be deleted from this browser.
    assert client_with_token(token).get("/auth/me").status_code == 401

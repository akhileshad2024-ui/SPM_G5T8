"""
US01 — AC4: the user's session is terminated automatically after 30 minutes of inactivity.

The backend issues sessions that expire 30 minutes after the last request and
renews them on every authenticated request (sliding expiry), up to 8 hours after
sign-in. The frontend (lib/idle-timeout.ts) signs the user out after 30 idle
minutes and renews the session every 5 minutes while they are active.
"""

from datetime import timedelta
from pathlib import Path

import jwt

from auth_testkit import (
    client_with_token,
    email_for,
    get_user,
    login,
    session_cookie,
    set_cookie_header,
    token_claims,
)
from login import security
from login.models import Role


def issue_session(db, role, clock, issued_ago, signed_in_ago=None):
    """A real session token for `role`, issued `issued_ago` in the past."""
    real_now = clock.now
    user = get_user(db, role)
    clock.set(real_now - issued_ago)
    signed_in_at = real_now - (signed_in_ago or issued_ago)
    token = security.create_session_token(user, signed_in_at)
    clock.set(real_now)
    return token


def test_idle_timeout_is_30_minutes():
    assert security.SESSION_IDLE_MINUTES == 30


def test_new_session_expires_30_minutes_after_login(client):
    response = login(client, email_for(Role.attendee))

    claims = token_claims(session_cookie(response))

    assert claims["exp"] - claims["iat"] == 30 * 60
    # The browser keeps the cookie up to the 8-hour cap; the token inside it is what expires after 30 idle minutes.
    assert f"max-age={security.SESSION_HOURS * 3600}" in set_cookie_header(response).lower()


def test_session_is_still_valid_after_29_idle_minutes(db, clock):
    token = issue_session(db, Role.attendee, clock, issued_ago=timedelta(minutes=29))

    assert client_with_token(token).get("/auth/me").status_code == 200


def test_session_is_terminated_after_30_idle_minutes(db, clock):
    token = issue_session(db, Role.attendee, clock, issued_ago=timedelta(minutes=30, seconds=5))

    response = client_with_token(token).get("/auth/me")

    assert response.status_code == 401


def test_expired_session_cannot_reach_protected_endpoints(db, clock):
    token = issue_session(db, Role.venue, clock, issued_ago=timedelta(minutes=45))
    session = client_with_token(token)

    assert session.get("/venues").status_code == 401
    assert session.post("/venues", json={"name": "x", "building": "y", "cap": 1}).status_code == 401


def test_activity_renews_the_session_for_another_30_minutes(db, clock):
    token = issue_session(db, Role.attendee, clock, issued_ago=timedelta(minutes=20))
    old_exp = token_claims(token)["exp"]

    response = client_with_token(token).get("/auth/me")

    renewed = token_claims(session_cookie(response))
    assert response.status_code == 200
    assert renewed["exp"] > old_exp
    assert renewed["exp"] - renewed["iat"] == 30 * 60


def test_renewal_keeps_the_original_sign_in_time(db, clock):
    token = issue_session(db, Role.attendee, clock, issued_ago=timedelta(minutes=10), signed_in_ago=timedelta(hours=2))

    response = client_with_token(token).get("/auth/me")

    assert token_claims(session_cookie(response))["start"] == token_claims(token)["start"]


def test_an_active_user_stays_signed_in_beyond_30_minutes(signed_in):
    """Each request renews the session, so regular activity never hits the idle limit."""
    session = signed_in(Role.attendee)
    for _ in range(5):
        response = session.get("/auth/me")
        assert response.status_code == 200
        assert session_cookie(response) is not None


def test_session_never_lasts_more_than_8_hours_after_sign_in(db, clock):
    token = issue_session(db, Role.attendee, clock, issued_ago=timedelta(minutes=1),
                          signed_in_ago=timedelta(hours=7, minutes=55))

    response = client_with_token(token).get("/auth/me")

    renewed = token_claims(session_cookie(response))
    assert response.status_code == 200
    assert renewed["exp"] - renewed["start"] <= security.SESSION_HOURS * 3600


def test_token_without_sign_in_time_is_rejected():
    legacy = jwt.encode({"sub": "5", "ver": 0, "exp": 9999999999}, security.JWT_SECRET, algorithm="HS256")

    assert client_with_token(legacy).get("/auth/me").status_code == 401


def test_frontend_idle_timeout_matches_backend():
    """lib/idle-timeout.ts must sign out after the same number of minutes."""
    project_root = Path(security.__file__).resolve().parents[2]
    text = (project_root / "lib" / "idle-timeout.ts").read_text(encoding="utf-8")

    assert f"IDLE_TIMEOUT_MS = {security.SESSION_IDLE_MINUTES} * 60 * 1000" in text

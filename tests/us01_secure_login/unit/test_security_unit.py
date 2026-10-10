"""
US01 unit tests for backend/login/security.py: password hashing (AC6), session
tokens and the idle timeout (AC4), and the session cookie (AC5).

Each function is called directly with stand-in objects (no HTTP, no database).
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import jwt
import pytest
from fastapi import HTTPException, Response

from login import security


def make_user(**overrides):
    fields = {"id": 7, "session_version": 0, "is_active": True}
    return SimpleNamespace(**{**fields, **overrides})


class FakeDB:
    """Just enough of a SQLAlchemy session for _session_from_request: db.get(Model, id)."""

    def __init__(self, user=None):
        self.user = user

    def get(self, model, user_id):
        return self.user if self.user is not None and self.user.id == user_id else None


def request_with(token=None):
    return SimpleNamespace(cookies={security.COOKIE_NAME: token} if token else {})


def claims(token):
    return jwt.decode(token, security.JWT_SECRET, algorithms=[security.JWT_ALGORITHM], options={"verify_exp": False})


def encode(payload):
    return jwt.encode(payload, security.JWT_SECRET, algorithm=security.JWT_ALGORITHM)


def set_cookie_header(response):
    return response.headers["set-cookie"].lower()


# ---------------------------------------------------------------- AC6: password hashing

def test_hash_is_argon2id_and_not_the_password():
    stored = security.hash_password("Correct-Horse-1")

    assert stored.startswith("$argon2id$")
    assert "Correct-Horse-1" not in stored


def test_hashing_is_salted():
    assert security.hash_password("same") != security.hash_password("same")


def test_verify_accepts_only_the_right_password():
    stored = security.hash_password("Correct-Horse-1")

    assert security.verify_password(stored, "Correct-Horse-1") is True
    assert security.verify_password(stored, "correct-horse-1") is False


@pytest.mark.parametrize("stored", ["typed-in-plain-text", "", "$argon2id$garbage"])
def test_verify_rejects_values_that_are_not_valid_hashes(stored):
    assert security.verify_password(stored, stored) is False


def test_current_hashes_do_not_need_rehashing():
    assert security.password_needs_rehash(security.hash_password("x")) is False


def test_burn_password_check_never_succeeds_or_raises():
    assert security.burn_password_check("anything") is None


# ---------------------------------------------------------------- AC4: session tokens

def test_new_token_identifies_the_user_and_session_version():
    c = claims(security.create_session_token(make_user(id=42, session_version=3)))

    assert c["sub"] == "42"
    assert c["ver"] == 3


def test_new_token_expires_after_the_idle_window():
    c = claims(security.create_session_token(make_user()))

    assert c["exp"] - c["iat"] == security.SESSION_IDLE_MINUTES * 60


def test_new_token_records_the_sign_in_time():
    c = claims(security.create_session_token(make_user()))

    assert c["start"] == c["iat"]


def test_renewed_token_keeps_the_original_sign_in_time():
    signed_in = datetime.now(timezone.utc) - timedelta(hours=2)

    c = claims(security.create_session_token(make_user(), signed_in))

    assert c["start"] == int(signed_in.timestamp())
    assert c["exp"] - c["iat"] == security.SESSION_IDLE_MINUTES * 60


def test_renewal_never_extends_past_the_absolute_cap():
    signed_in = datetime.now(timezone.utc) - timedelta(hours=security.SESSION_HOURS) + timedelta(minutes=5)

    c = claims(security.create_session_token(make_user(), signed_in))

    assert c["exp"] == int((signed_in + timedelta(hours=security.SESSION_HOURS)).timestamp())


# ---------------------------------------------------------------- reading the session back

def test_valid_token_returns_the_user_and_sign_in_time():
    user = make_user()
    signed_in = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(minutes=10)
    token = security.create_session_token(user, signed_in)

    assert security._session_from_request(request_with(token), FakeDB(user)) == (user, signed_in)


def test_missing_cookie_means_no_session():
    assert security._session_from_request(request_with(None), FakeDB(make_user())) is None


@pytest.mark.parametrize("token", ["not-a-jwt", "a.b.c"])
def test_malformed_token_means_no_session(token):
    assert security._session_from_request(request_with(token), FakeDB(make_user())) is None


def test_token_signed_with_another_secret_means_no_session():
    forged = jwt.encode({"sub": "7", "ver": 0, "exp": 9999999999}, "x" * 40, algorithm="HS256")

    assert security._session_from_request(request_with(forged), FakeDB(make_user())) is None


def test_expired_token_means_no_session():
    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    token = encode({"sub": "7", "ver": 0, "iat": past - timedelta(minutes=30), "exp": past})

    assert security._session_from_request(request_with(token), FakeDB(make_user())) is None


@pytest.mark.parametrize("missing", ["sub", "ver", "exp"])
def test_token_missing_a_required_claim_means_no_session(missing):
    payload = {"sub": "7", "ver": 0, "iat": datetime.now(timezone.utc), "exp": 9999999999}
    del payload[missing]

    assert security._session_from_request(request_with(encode(payload)), FakeDB(make_user())) is None


def test_token_without_any_time_claims_means_no_session():
    token = encode({"sub": "7", "ver": 0, "exp": 9999999999})

    assert security._session_from_request(request_with(token), FakeDB(make_user())) is None


def test_non_numeric_user_id_means_no_session():
    token = encode({"sub": "abc", "ver": 0, "iat": datetime.now(timezone.utc), "exp": 9999999999})

    assert security._session_from_request(request_with(token), FakeDB(make_user())) is None


def test_session_of_a_deleted_user_is_rejected():
    token = security.create_session_token(make_user())

    assert security._session_from_request(request_with(token), FakeDB(None)) is None


def test_session_of_a_deactivated_user_is_rejected():
    token = security.create_session_token(make_user())

    assert security._session_from_request(request_with(token), FakeDB(make_user(is_active=False))) is None


def test_revoked_session_is_rejected():
    """Logout / password change bump session_version, which invalidates older tokens."""
    token = security.create_session_token(make_user(session_version=0))

    assert security._session_from_request(request_with(token), FakeDB(make_user(session_version=1))) is None


def test_user_from_request_returns_just_the_user():
    user = make_user()
    token = security.create_session_token(user)

    assert security.user_from_request(request_with(token), FakeDB(user)) is user
    assert security.user_from_request(request_with(None), FakeDB(user)) is None


def test_get_current_user_rejects_requests_without_a_session():
    with pytest.raises(HTTPException) as err:
        security.get_current_user(request_with(None), Response(), FakeDB(make_user()))

    assert err.value.status_code == 401
    assert err.value.detail == "Not signed in"


def test_get_current_user_renews_the_session_cookie():
    """Every authenticated request is activity, so it slides the idle window forward."""
    user = make_user()
    signed_in = datetime.now(timezone.utc) - timedelta(hours=1)
    response = Response()

    result = security.get_current_user(request_with(security.create_session_token(user, signed_in)), response, FakeDB(user))

    assert result is user
    renewed = claims(response.headers["set-cookie"].split("=", 1)[1].split(";", 1)[0])
    assert renewed["start"] == int(signed_in.timestamp())
    assert renewed["exp"] - renewed["iat"] == security.SESSION_IDLE_MINUTES * 60


# ---------------------------------------------------------------- AC5: the cookie itself

def test_session_cookie_is_http_only_and_same_site():
    response = Response()
    security.set_session_cookie(response, "token-value")

    header = set_cookie_header(response)
    assert header.startswith(f"{security.COOKIE_NAME}=token-value")
    assert "httponly" in header
    assert "samesite=lax" in header
    assert "path=/" in header


@pytest.mark.parametrize("secure", [True, False])
def test_session_cookie_secure_flag_follows_the_setting(monkeypatch, secure):
    monkeypatch.setattr(security, "COOKIE_SECURE", secure)
    response = Response()
    security.set_session_cookie(response, "token-value")

    assert ("secure" in set_cookie_header(response).replace("samesite", "")) is secure


def test_clearing_the_cookie_expires_it_immediately():
    response = Response()
    security.clear_session_cookie(response)

    header = set_cookie_header(response)
    assert header.startswith(f"{security.COOKIE_NAME}=")
    assert "max-age=0" in header

"""
US01 unit tests for the lockout helpers in backend/login/auth.py (AC2, AC3) and
the login request limits in backend/login/schemas.py.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from login import auth, schemas, security

NOW = datetime(2026, 10, 6, 9, 0, tzinfo=timezone.utc)


class FakeDB:
    def __init__(self):
        self.commits = 0

    def commit(self):
        self.commits += 1


def make_user(failed=0, locked_until=None):
    return SimpleNamespace(failed_login_attempts=failed, locked_until=locked_until)


# ---------------------------------------------------------------- AC2: one message for every bad login

def test_invalid_credentials_is_a_generic_401():
    err = auth._invalid_credentials()

    assert err.status_code == 401
    assert err.detail == "Incorrect email or password"


# ---------------------------------------------------------------- AC3: counting failures

def test_a_failure_is_counted_and_saved():
    user, db = make_user(failed=1), FakeDB()

    auth._record_failed_attempt(user, NOW, db)

    assert user.failed_login_attempts == 2
    assert user.locked_until is None
    assert db.commits == 1


def test_the_fourth_failure_does_not_lock():
    user = make_user(failed=security.MAX_FAILED_ATTEMPTS - 2)

    auth._record_failed_attempt(user, NOW, FakeDB())

    assert user.locked_until is None


def test_the_fifth_failure_locks_for_15_minutes_and_resets_the_count():
    user = make_user(failed=security.MAX_FAILED_ATTEMPTS - 1)

    auth._record_failed_attempt(user, NOW, FakeDB())

    assert user.locked_until == NOW + timedelta(minutes=security.LOCKOUT_MINUTES)
    assert user.failed_login_attempts == 0


# ---------------------------------------------------------------- AC3: checking the lock

def test_an_account_that_was_never_locked_is_allowed():
    auth._ensure_not_locked(make_user(locked_until=None), NOW)


def test_an_expired_lock_is_allowed():
    auth._ensure_not_locked(make_user(locked_until=NOW - timedelta(seconds=1)), NOW)


def test_a_lock_ending_exactly_now_is_allowed():
    auth._ensure_not_locked(make_user(locked_until=NOW), NOW)


def test_an_active_lock_is_refused_with_429():
    with pytest.raises(HTTPException) as err:
        auth._ensure_not_locked(make_user(locked_until=NOW + timedelta(minutes=1)), NOW)

    assert err.value.status_code == 429
    assert err.value.detail == "Too many failed attempts. Try again in a few minutes."


def test_a_lock_stored_without_a_timezone_is_read_as_utc():
    """SQLite drops the timezone; the lock must still be compared correctly."""
    naive = (NOW + timedelta(minutes=5)).replace(tzinfo=None)

    with pytest.raises(HTTPException):
        auth._ensure_not_locked(make_user(locked_until=naive), NOW)

    auth._ensure_not_locked(make_user(locked_until=(NOW - timedelta(minutes=5)).replace(tzinfo=None)), NOW)


# ---------------------------------------------------------------- request limits

def test_a_normal_login_request_is_accepted():
    body = schemas.LoginRequest(email="sam.adeyemi@student.connectsphere.edu", password="Correct-Horse-1")

    assert body.password == "Correct-Horse-1"


@pytest.mark.parametrize(
    "email, password",
    [
        ("", "Correct-Horse-1"),  # no email
        ("ab", "Correct-Horse-1"),  # too short to be an email
        ("a" * 255, "Correct-Horse-1"),  # longer than any valid email
        ("sam@x.edu", ""),  # no password
        ("sam@x.edu", "x" * 257),  # oversized: rejected before any hashing work
    ],
)
def test_login_request_limits(email, password):
    with pytest.raises(ValidationError):
        schemas.LoginRequest(email=email, password=password)


def test_the_longest_allowed_password_is_accepted():
    assert schemas.LoginRequest(email="sam@x.edu", password="x" * 256)


def test_new_password_must_be_at_least_8_characters():
    with pytest.raises(ValidationError):
        schemas.ChangePasswordRequest(current_password="old", new_password="x" * (schemas.MIN_PASSWORD_LENGTH - 1))

    assert schemas.ChangePasswordRequest(current_password="old", new_password="x" * schemas.MIN_PASSWORD_LENGTH)

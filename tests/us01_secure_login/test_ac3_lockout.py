"""
US01 — AC3: the user is temporarily locked out after 5 consecutive failed login attempts.
"""

from datetime import timedelta

from auth_testkit import email_for, get_user, login
from login import security
from login.models import Role

WRONG = "wrong-password"
LOCKED_MESSAGE = "Too many failed attempts. Try again in a few minutes."


def fail(client, role, times):
    return [login(client, email_for(role), WRONG).status_code for _ in range(times)]


def test_lockout_threshold_is_5_attempts_for_15_minutes():
    assert security.MAX_FAILED_ATTEMPTS == 5
    assert security.LOCKOUT_MINUTES == 15


def test_four_failures_do_not_lock_the_account(client):
    assert fail(client, Role.tech, 4) == [401, 401, 401, 401]

    assert login(client, email_for(Role.tech)).status_code == 200


def test_five_consecutive_failures_lock_the_account(client):
    assert fail(client, Role.tech, 5) == [401] * 5

    # Even the correct password is refused while locked.
    response = login(client, email_for(Role.tech))

    assert response.status_code == 429
    assert response.json()["detail"] == LOCKED_MESSAGE


def test_locked_account_records_the_lock_in_the_database(client, db):
    fail(client, Role.tech, 5)

    user = get_user(db, Role.tech)

    assert user.locked_until is not None


def test_further_attempts_while_locked_are_refused(client):
    fail(client, Role.tech, 5)

    assert fail(client, Role.tech, 3) == [429, 429, 429]


def test_failures_must_be_consecutive(client):
    """A successful login in between resets the count."""
    fail(client, Role.tech, 4)
    assert login(client, email_for(Role.tech)).status_code == 200

    assert fail(client, Role.tech, 4) == [401] * 4
    assert login(client, email_for(Role.tech)).status_code == 200


def test_lockout_is_temporary(client, clock):
    start = clock.now
    fail(client, Role.tech, 5)
    assert login(client, email_for(Role.tech)).status_code == 429

    clock.set(start + timedelta(minutes=14))
    assert login(client, email_for(Role.tech)).status_code == 429

    clock.set(start + timedelta(minutes=16))
    assert login(client, email_for(Role.tech)).status_code == 200


def test_after_lockout_expires_the_user_gets_a_fresh_5_attempts(client, clock):
    start = clock.now
    fail(client, Role.tech, 5)
    clock.set(start + timedelta(minutes=16))

    assert fail(client, Role.tech, 4) == [401] * 4
    assert login(client, email_for(Role.tech)).status_code == 200


def test_lockout_only_affects_that_account(client):
    fail(client, Role.tech, 5)

    assert login(client, email_for(Role.attendee)).status_code == 200


def test_failed_attempts_on_unknown_emails_lock_nothing(client):
    for _ in range(10):
        assert login(client, "nobody@connectsphere.edu", WRONG).status_code == 401

    assert login(client, email_for(Role.attendee)).status_code == 200


def test_wrong_current_password_on_change_password_counts_towards_lockout(signed_in, client):
    session = signed_in(Role.tech)
    for _ in range(5):
        r = session.post("/auth/change-password", json={"current_password": WRONG, "new_password": "New-Pass-123"})
        assert r.status_code == 400

    assert login(client, email_for(Role.tech)).status_code == 429

"""
US01 — AC6: passwords are never stored in plain text.
"""

import sys

import pytest
from argon2 import PasswordHasher
from sqlalchemy import text

from auth_testkit import PASSWORD, email_for, get_user, login
from login import security, set_password
from login.models import Role

NEW_PASSWORD = "Brand-New-Pass-9"


def run_set_password(monkeypatch, *args, password=None, typed=None):
    """Run the set_password script. `password` → NEW_PASSWORD env var; `typed` → answers to the prompts."""
    monkeypatch.setattr(sys, "argv", ["set_password", *args])
    if password is None:
        monkeypatch.delenv("NEW_PASSWORD", raising=False)
    else:
        monkeypatch.setenv("NEW_PASSWORD", password)
    if typed:
        answers = iter(typed)
        monkeypatch.setattr(set_password, "getpass", lambda prompt="": next(answers))
    set_password.main()


def all_stored_values(db) -> str:
    """Every value in the users table, as one string."""
    rows = db.execute(text("SELECT * FROM users")).fetchall()
    return " ".join(str(value) for row in rows for value in row)


def test_stored_password_is_an_argon2id_hash(db):
    stored = get_user(db, Role.attendee).password_hash

    assert stored.startswith("$argon2id$")
    assert stored != PASSWORD


def test_plain_password_appears_nowhere_in_the_users_table(db):
    assert PASSWORD not in all_stored_values(db)


def test_same_password_gives_different_hashes_thanks_to_salting():
    first = security.hash_password(PASSWORD)
    second = security.hash_password(PASSWORD)

    assert first != second
    assert security.verify_password(first, PASSWORD)
    assert security.verify_password(second, PASSWORD)


def test_hash_verifies_only_the_right_password():
    stored = security.hash_password(PASSWORD)

    assert security.verify_password(stored, PASSWORD)
    assert not security.verify_password(stored, "wrong-password")


def test_a_plain_text_value_in_the_hash_column_can_never_sign_in(client, db):
    """If someone types a password into the database by hand, it must not work."""
    user = get_user(db, Role.attendee)
    user.password_hash = "typed-in-plain-text"
    db.commit()

    assert login(client, email_for(Role.attendee), "typed-in-plain-text").status_code == 401


def test_changing_password_stores_only_a_hash(signed_in, db):
    session = signed_in(Role.tech)

    response = session.post("/auth/change-password",
                            json={"current_password": PASSWORD, "new_password": NEW_PASSWORD})

    assert response.status_code == 204
    stored = get_user(db, Role.tech).password_hash
    assert stored.startswith("$argon2id$")
    assert NEW_PASSWORD not in all_stored_values(db)


def test_changed_password_works_and_old_one_does_not(signed_in, client):
    signed_in(Role.tech).post("/auth/change-password",
                              json={"current_password": PASSWORD, "new_password": NEW_PASSWORD})

    assert login(client, email_for(Role.tech), PASSWORD).status_code == 401
    assert login(client, email_for(Role.tech), NEW_PASSWORD).status_code == 200


def test_new_password_must_differ_from_the_current_one(signed_in):
    response = signed_in(Role.tech).post("/auth/change-password",
                                         json={"current_password": PASSWORD, "new_password": PASSWORD})

    assert response.status_code == 400
    assert response.json()["detail"] == "New password must be different from the current one"


def test_weak_old_hash_is_upgraded_at_next_login(client, db):
    """If the hashing settings are strengthened, existing hashes are upgraded when the user signs in."""
    weak = PasswordHasher(time_cost=1, memory_cost=8192, parallelism=1).hash(PASSWORD)
    user = get_user(db, Role.attendee)
    user.password_hash = weak
    db.commit()

    assert login(client, email_for(Role.attendee)).status_code == 200

    upgraded = get_user(db, Role.attendee).password_hash
    assert upgraded != weak
    assert not security.password_needs_rehash(upgraded)
    assert security.verify_password(upgraded, PASSWORD)


def test_set_password_script_stores_only_a_hash(db, monkeypatch, capsys):
    run_set_password(monkeypatch, email_for(Role.organiser), password=NEW_PASSWORD)

    stored = get_user(db, Role.organiser).password_hash
    assert stored.startswith("$argon2id$")
    assert NEW_PASSWORD not in all_stored_values(db)
    assert NEW_PASSWORD not in capsys.readouterr().out


def test_set_password_script_prompts_when_no_password_is_given(db, monkeypatch, client):
    run_set_password(monkeypatch, email_for(Role.organiser), typed=[NEW_PASSWORD, NEW_PASSWORD])

    assert login(client, email_for(Role.organiser), NEW_PASSWORD).status_code == 200


def test_set_password_script_rejects_mismatched_confirmation(db, monkeypatch):
    before = get_user(db, Role.organiser).password_hash

    with pytest.raises(SystemExit, match="Passwords don't match"):
        run_set_password(monkeypatch, email_for(Role.organiser), typed=[NEW_PASSWORD, "something-else"])

    assert get_user(db, Role.organiser).password_hash == before


def test_set_password_script_rejects_short_passwords(db, monkeypatch):
    before = get_user(db, Role.organiser).password_hash

    with pytest.raises(SystemExit, match="at least 8 characters"):
        run_set_password(monkeypatch, email_for(Role.organiser), password="short")

    assert get_user(db, Role.organiser).password_hash == before


def test_set_password_script_rejects_unknown_accounts(monkeypatch):
    with pytest.raises(SystemExit, match="No account found"):
        run_set_password(monkeypatch, "nobody@connectsphere.edu", password=NEW_PASSWORD)


def test_set_password_script_requires_exactly_one_email(monkeypatch):
    with pytest.raises(SystemExit, match="Usage"):
        run_set_password(monkeypatch, password=NEW_PASSWORD)


def test_session_cookie_does_not_contain_the_password(client):
    response = login(client, email_for(Role.attendee))

    assert PASSWORD not in response.headers.get("set-cookie", "")

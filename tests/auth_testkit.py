"""
Shared fixtures for every user story's tests (tests/<user story>/).

Each story folder's conftest.py imports this module, so its fixtures apply there.
Useful helpers for any story: `client`, `signed_in(Role.venue)`, `db`,
`get_user(db, role)`, `clock`, `production`.

The tests run against a throwaway SQLite database, never Supabase: tests/conftest.py
sets the environment before any test module imports the app.
"""

import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND_DIR))

import jwt  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from database import Base, SessionLocal, engine  # noqa: E402
from login import auth, security  # noqa: E402
from login.models import Role, User  # noqa: E402
from main import app  # noqa: E402

assert engine.url.get_backend_name() == "sqlite", "tests must never run against a real database"

PASSWORD = "Correct-Horse-1"

ACCOUNTS = {
    Role.organiser: ("maya.rahman@connectsphere.edu", "Maya Rahman"),
    Role.coordinator: ("priya.tan@connectsphere.edu", "Priya Tan"),
    Role.venue: ("daniel.ortiz@connectsphere.edu", "Daniel Ortiz"),
    Role.tech: ("wei.lim@connectsphere.edu", "Wei Lim"),
    Role.attendee: ("sam.adeyemi@student.connectsphere.edu", "Sam Adeyemi"),
}

# Argon2 is deliberately slow, so hash the shared password once.
_PASSWORD_HASH = security.hash_password(PASSWORD)


def email_for(role: Role) -> str:
    return ACCOUNTS[role][0]


@pytest.fixture(autouse=True)
def fresh_database():
    """Every test starts with an empty database containing one account per role."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        for role, (email, name) in ACCOUNTS.items():
            db.add(User(email=email, name=name, role=role, password_hash=_PASSWORD_HASH,
                        is_active=True, failed_login_attempts=0, session_version=0))
        db.commit()
    yield


@pytest.fixture
def db():
    with SessionLocal() as session:
        yield session


def get_user(db, role: Role) -> User:
    db.expire_all()
    return db.query(User).filter(User.email == email_for(role)).one()


@pytest.fixture
def client():
    return TestClient(app)


def login(client, email: str, password: str = PASSWORD):
    return client.post("/auth/login", json={"email": email, "password": password})


@pytest.fixture
def signed_in():
    """signed_in(Role.venue) -> a TestClient holding that user's session cookie."""

    def _signed_in(role: Role) -> TestClient:
        c = TestClient(app)
        response = login(c, email_for(role))
        assert response.status_code == 200, response.text
        return c

    return _signed_in


def session_cookie(response) -> str | None:
    """The cs_session value set by a response, or None."""
    for header in response.headers.get_list("set-cookie"):
        if header.startswith(f"{security.COOKIE_NAME}="):
            return header.split("=", 1)[1].split(";", 1)[0]
    return None


def set_cookie_header(response) -> str:
    for header in response.headers.get_list("set-cookie"):
        if header.startswith(f"{security.COOKIE_NAME}="):
            return header
    raise AssertionError("response did not set the session cookie")


def token_claims(token: str) -> dict:
    return jwt.decode(token, security.JWT_SECRET, algorithms=[security.JWT_ALGORITHM],
                      options={"verify_exp": False})


def client_with_token(token: str) -> TestClient:
    c = TestClient(app)
    c.cookies.set(security.COOKIE_NAME, token)
    return c


class _Clock:
    """Controls what datetime.now() returns inside the login code."""

    def __init__(self, monkeypatch):
        self.now = datetime.now(timezone.utc)
        clock = self

        class FrozenDatetime(datetime):
            @classmethod
            def now(cls, tz=None):
                return clock.now

        for module in (security, auth):
            monkeypatch.setattr(module, "datetime", FrozenDatetime)

    def set(self, when: datetime) -> None:
        self.now = when


@pytest.fixture
def clock(monkeypatch):
    """Freeze/shift the time the login code sees: clock.set(real_now - timedelta(minutes=31))."""
    return _Clock(monkeypatch)


@pytest.fixture
def production(monkeypatch):
    """Run the app as if APP_ENV=production."""
    monkeypatch.setattr(security, "IS_PRODUCTION", True)
    monkeypatch.setattr(security, "COOKIE_SECURE", True)

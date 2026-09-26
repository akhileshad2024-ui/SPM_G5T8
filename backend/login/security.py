"""
Password hashing, session tokens and the FastAPI dependencies that enforce
authentication (who are you?) and RBAC (are you allowed to do this?).

Sessions are a signed JWT stored in an HttpOnly cookie, so page scripts can
never read the token. The user's role is always re-read from the database on
each request rather than trusted from the token, so role changes and
deactivations take effect immediately.
"""

import os
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from database import get_db  # importing database also loads backend/.env
from login import models

JWT_SECRET = os.getenv("JWT_SECRET", "")
if len(JWT_SECRET) < 32 or JWT_SECRET == "CHANGE_ME":
    raise RuntimeError(
        "JWT_SECRET is missing or too short (min 32 chars). Add it to backend/.env — generate one with:\n"
        '  python -c "import secrets; print(secrets.token_urlsafe(48))"'
    )

JWT_ALGORITHM = "HS256"
SESSION_HOURS = int(os.getenv("SESSION_HOURS", "8"))
COOKIE_NAME = "cs_session"
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"

MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 15

# ---------------------------------------------------------------- passwords

_hasher = PasswordHasher()  # argon2id with the library's recommended parameters
_DUMMY_HASH = _hasher.hash("timing-equaliser")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def burn_password_check(password: str) -> None:
    """Spend the same time as a real check, so response timing doesn't reveal which emails exist."""
    verify_password(_DUMMY_HASH, password)


# ---------------------------------------------------------------- sessions

def create_session_token(user: models.User) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "ver": user.session_version,
        "iat": now,
        "exp": now + timedelta(hours=SESSION_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=SESSION_HOURS * 3600,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/", httponly=True, secure=COOKIE_SECURE, samesite="lax")


def user_from_request(request: Request, db: Session) -> models.User | None:
    """The signed-in user, or None if the cookie is missing, invalid, expired or revoked."""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    try:
        payload = jwt.decode(
            token, JWT_SECRET, algorithms=[JWT_ALGORITHM], options={"require": ["sub", "ver", "exp"]}
        )
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, ValueError):
        return None

    user = db.get(models.User, user_id)
    if user is None or not user.is_active or user.session_version != payload["ver"]:
        return None
    return user


# ---------------------------------------------------------------- dependencies

def get_current_user(request: Request, db: Session = Depends(get_db)) -> models.User:
    user = user_from_request(request, db)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not signed in")
    return user


def require_roles(*roles: models.Role):
    """Dependency factory: `user = Depends(require_roles(Role.venue))` allows only those roles."""
    allowed = frozenset(roles)

    def dependency(user: models.User = Depends(get_current_user)) -> models.User:
        if user.role not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have permission to do that")
        return user

    return dependency

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
from fastapi.responses import JSONResponse
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
# A session ends after SESSION_IDLE_MINUTES without an authenticated request (each one
# slides the window forward), and never lasts longer than SESSION_HOURS from sign-in.
SESSION_IDLE_MINUTES = int(os.getenv("SESSION_IDLE_MINUTES", "30"))
SESSION_HOURS = int(os.getenv("SESSION_HOURS", "8"))
COOKIE_NAME = "cs_session"

# In production (APP_ENV=production) the cookie is HTTPS-only and requests that did
# not arrive over HTTPS are refused (see enforce_https). Local development uses http.
IS_PRODUCTION = os.getenv("APP_ENV", "development").lower() == "production"
COOKIE_SECURE = IS_PRODUCTION or os.getenv("COOKIE_SECURE", "false").lower() == "true"
HSTS_HEADER = "max-age=63072000; includeSubDomains"

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

def create_session_token(user: models.User, started_at: datetime | None = None) -> str:
    """`started_at` is when the user signed in; pass it when renewing so the absolute cap holds."""
    now = datetime.now(timezone.utc)
    started_at = started_at or now
    payload = {
        "sub": str(user.id),
        "ver": user.session_version,
        "iat": now,
        "start": int(started_at.timestamp()),
        "exp": min(now + timedelta(minutes=SESSION_IDLE_MINUTES), started_at + timedelta(hours=SESSION_HOURS)),
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


def _session_from_request(request: Request, db: Session) -> tuple[models.User, datetime] | None:
    """The signed-in user and their sign-in time, or None if the cookie is missing, invalid, expired or revoked."""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    try:
        payload = jwt.decode(
            token, JWT_SECRET, algorithms=[JWT_ALGORITHM], options={"require": ["sub", "ver", "exp"]}
        )
        user_id = int(payload["sub"])
        started_at = datetime.fromtimestamp(int(payload.get("start", payload["iat"])), timezone.utc)
    except (jwt.PyJWTError, KeyError, ValueError):
        return None

    user = db.get(models.User, user_id)
    if user is None or not user.is_active or user.session_version != payload["ver"]:
        return None
    return user, started_at


def user_from_request(request: Request, db: Session) -> models.User | None:
    """The signed-in user, or None if the cookie is missing, invalid, expired or revoked."""
    session = _session_from_request(request, db)
    return session[0] if session else None


# ---------------------------------------------------------------- dependencies

def get_current_user(request: Request, response: Response, db: Session = Depends(get_db)) -> models.User:
    session = _session_from_request(request, db)
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not signed in")
    user, started_at = session
    # Activity: renew the idle window (the absolute cap from sign-in still applies).
    set_session_cookie(response, create_session_token(user, started_at))
    return user


def require_roles(*roles: models.Role):
    """Dependency factory: `user = Depends(require_roles(Role.venue))` allows only those roles."""
    allowed = frozenset(roles)

    def dependency(user: models.User = Depends(get_current_user)) -> models.User:
        if user.role not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have permission to do that")
        return user

    return dependency


# ---------------------------------------------------------------- transport (TLS)

async def enforce_https(request: Request, call_next):
    """
    HTTP middleware. In production, refuse any request that did not arrive over
    HTTPS (so credentials are never accepted over plain HTTP) and send HSTS so
    browsers stick to HTTPS. Behind a TLS-terminating proxy, the original scheme
    comes from X-Forwarded-Proto. Does nothing in development.
    """
    if not IS_PRODUCTION:
        return await call_next(request)

    scheme = request.headers.get("x-forwarded-proto", request.url.scheme).split(",")[0].strip().lower()
    if scheme != "https":
        return JSONResponse(status_code=status.HTTP_403_FORBIDDEN, content={"detail": "HTTPS is required"})

    response = await call_next(request)
    response.headers["Strict-Transport-Security"] = HSTS_HEADER
    return response

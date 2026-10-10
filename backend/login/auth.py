from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from database import get_db
from login import models, schemas
from login.security import (
    LOCKOUT_MINUTES,
    MAX_FAILED_ATTEMPTS,
    burn_password_check,
    clear_session_cookie,
    create_session_token,
    get_current_user,
    hash_password,
    password_needs_rehash,
    set_session_cookie,
    user_from_request,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _invalid_credentials() -> HTTPException:
    # Deliberately the same message for "no such user" and "wrong password".
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")


def _ensure_not_locked(user: models.User, now: datetime) -> None:
    locked_until = user.locked_until
    if locked_until and locked_until.tzinfo is None:  # some drivers (e.g. SQLite) drop the timezone
        locked_until = locked_until.replace(tzinfo=timezone.utc)
    if locked_until and locked_until > now:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed attempts. Try again in a few minutes.",
        )


def _record_failed_attempt(user: models.User, now: datetime, db: Session) -> None:
    user.failed_login_attempts += 1
    if user.failed_login_attempts >= MAX_FAILED_ATTEMPTS:
        user.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
        user.failed_login_attempts = 0
    db.commit()


@router.post("/login", response_model=schemas.UserResponse)
def login(body: schemas.LoginRequest, response: Response, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    user = db.query(models.User).filter(models.User.email == email).first()
    now = datetime.now(timezone.utc)

    if user is None or not user.is_active:
        burn_password_check(body.password)
        raise _invalid_credentials()

    _ensure_not_locked(user, now)

    if not verify_password(user.password_hash, body.password):
        _record_failed_attempt(user, now, db)
        raise _invalid_credentials()

    user.failed_login_attempts = 0
    user.locked_until = None
    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    db.commit()

    set_session_cookie(response, create_session_token(user))
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, all_sessions: bool = True, db: Session = Depends(get_db)):
    # all_sessions=false (used by the inactivity sign-out) ends only this browser's session.
    user = user_from_request(request, db)
    if user is not None and all_sessions:
        # Invalidates this token server-side (and the user's other sessions), not just the cookie.
        user.session_version += 1
        db.commit()
    clear_session_cookie(response)


@router.get("/me", response_model=schemas.UserResponse)
def me(user: models.User = Depends(get_current_user)):
    return user


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    body: schemas.ChangePasswordRequest,
    response: Response,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    _ensure_not_locked(user, now)

    # Re-check the current password so an unattended signed-in browser can't take over the account.
    # 400 rather than 401: the session itself is still valid.
    if not verify_password(user.password_hash, body.current_password):
        _record_failed_attempt(user, now, db)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")

    if body.new_password == body.current_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="New password must be different from the current one"
        )

    user.password_hash = hash_password(body.new_password)
    user.failed_login_attempts = 0
    user.locked_until = None
    user.session_version += 1  # signs out every other session...
    db.commit()

    set_session_cookie(response, create_session_token(user))  # ...while keeping this one signed in

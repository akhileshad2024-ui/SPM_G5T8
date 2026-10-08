"""
US13: the one place an event's status changes.

Every story that moves an event along (submit, start review, request clarification,
approve, reject, confirm, cancel) should call change_status() rather than setting
`event.status` itself, so each change is checked against the allowed transitions and
recorded with who made it and when. The history it writes is what US13 shows.
"""

from datetime import datetime
from typing import Optional

from fastapi import HTTPException, status as http_status
from sqlalchemy.orm import Session

import models
from login.models import User

S = models.EventStatus

# Where each status may go next (US04, US07-US10, US14, US37). Draft -> Draft is a re-save,
# not a change, so it is not listed and records nothing.
TRANSITIONS: dict[S, set[S]] = {
    S.draft: {S.submitted},
    S.submitted: {S.under_review, S.cancelled},
    S.under_review: {S.pending_clarification, S.approved, S.rejected, S.cancelled},
    S.pending_clarification: {S.under_review, S.cancelled},
    S.approved: {S.confirmed, S.cancelled},
    S.confirmed: {S.cancelled},
    S.rejected: set(),
    S.cancelled: set(),
}


def can_change(current: Optional[S], new: S) -> bool:
    """True if an event in `current` (None = being created) may move to `new`."""
    if current is None:
        return new in (S.draft, S.submitted)  # a request starts as a draft, or is submitted straight away
    return new in TRANSITIONS[current]


def record_initial_status(db: Session, event: models.Event, user: User, now: datetime) -> None:
    """History entry for a newly created event (call after it has an id)."""
    db.add(models.EventStatusChange(event_id=event.id, from_status=None, to_status=event.status,
                                    changed_by_id=user.id, changed_at=now))


def change_status(db: Session, event: models.Event, new: S, user: User, now: datetime,
                  reason: Optional[str] = None) -> None:
    """Move `event` to `new` and record it. Refuses changes the workflow doesn't allow (409).

    Does not commit, so the caller saves the status change together with its other updates.
    Calling it with the event's current status is a no-op.
    """
    current = event.status
    if new == current:
        return
    if not can_change(current, new):
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail=f"An event that is {label(current)} can't be changed to {label(new)}.",
        )
    event.status = new
    db.add(models.EventStatusChange(event_id=event.id, from_status=current, to_status=new,
                                    changed_by_id=user.id, changed_at=now, reason=reason or None))


def label(value: S) -> str:
    """'under_review' -> 'Under Review', as the status set is worded in US13."""
    return value.value.replace("_", " ").title()

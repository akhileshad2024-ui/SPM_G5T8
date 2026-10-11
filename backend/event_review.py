"""
The Event Coordinator's review steps, saved (US07, US08, US10, US11).

Same rules and messages as the frontend's lib/events/review/*.ts, so the page can check
a step straight away and the server still refuses it if the page is bypassed:

    assign      (US11)  an unassigned, live event gets a coordinator from the coordinator accounts
    start       (US07)  Submitted -> Under Review
    clarify     (US08)  the assigned coordinator asks the organiser to clarify or amend:
                        Under Review -> Pending Clarification
    decide      (US10)  the assigned coordinator approves (optional note) or rejects
                        (reason of 10-1000 characters): Under Review -> Approved / Rejected

Each step raises ReviewError (409: not allowed now, 422: bad text) instead of saving.
Status changes go through event_status.change_status(), so they appear in the US13 history.
Nothing here commits; the endpoint saves the step in one transaction.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

import models
from event_status import change_status
from login.models import Role, User

S = models.EventStatus

MAX_NOTE_LENGTH = 1000
MIN_REJECTION_REASON_LENGTH = 10

# A coordinator can be assigned while the event is live: submitted and not yet closed.
ASSIGNABLE_STATUSES = {S.submitted, S.under_review, S.pending_clarification, S.approved, S.confirmed}

KIND_LABEL = {"clarification": "Clarification", "amendment": "Amendment"}


class ReviewError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def not_allowed(message: str) -> ReviewError:
    return ReviewError(409, message)


def note_error(text: str, label: str, required: bool = True, min_length: int = 1) -> Optional[str]:
    """Same checks as noteError() in lib/events/review/shared.ts."""
    trimmed = (text or "").strip()
    if not trimmed:
        return f"{label} is required." if required else None
    if len(trimmed) < min_length:
        return f"{label} must be at least {min_length} characters."
    if len(trimmed) > MAX_NOTE_LENGTH:
        return f"{label} must be {MAX_NOTE_LENGTH} characters or fewer."
    return None


def check_note(text: str, label: str, **kwargs) -> str:
    """The trimmed text, or ReviewError(422) explaining what's wrong with it."""
    error = note_error(text, label, **kwargs)
    if error:
        raise ReviewError(422, error)
    return (text or "").strip()


def coordinator_name(db: Session, event: models.Event) -> Optional[str]:
    coordinator = db.get(User, event.coordinator_id) if event.coordinator_id else None
    return coordinator.name if coordinator else None


def check_decision_allowed(db: Session, event: models.Event, user: User) -> None:
    """Same order and messages as reviewDecisionError() in lib/events/review/shared.ts."""
    if event.status == S.submitted:
        raise not_allowed("Start the review before making a decision on this request.")
    if event.status == S.pending_clarification:
        raise not_allowed("Waiting for the organiser to respond to your clarification request.")
    if event.status != S.under_review:
        raise not_allowed("A decision has already been made on this request.")
    if event.coordinator_id is None:
        raise not_allowed("Assign a coordinator before making a decision on this request.")
    if event.coordinator_id != user.id:
        raise not_allowed(f"Only the assigned coordinator ({coordinator_name(db, event)}) can make this decision.")


def active_coordinators(db: Session) -> list[User]:
    return (
        db.query(User)
        .filter(User.role == Role.coordinator, User.is_active.is_(True))
        .order_by(User.name)
        .all()
    )


def assign(db: Session, event: models.Event, user: User, coordinator_id: int) -> None:
    """US11. Changing an existing coordinator is reassignment (US12), not done here."""
    coordinator = db.get(User, coordinator_id)
    if coordinator is None or coordinator.role != Role.coordinator or not coordinator.is_active:
        raise ReviewError(422, f"{coordinator.name if coordinator else 'That person'} is not an Event Coordinator.")
    if event.status not in ASSIGNABLE_STATUSES:
        raise not_allowed(f"A coordinator can't be assigned while the event is {event.status.value.replace('_', ' ')}.")
    if event.coordinator_id is not None:
        raise not_allowed(f"{coordinator_name(db, event)} is already coordinating this event.")
    event.coordinator_id = coordinator.id


def start_review(db: Session, event: models.Event, user: User, now: datetime) -> None:
    """US07."""
    if event.status != S.submitted:
        raise not_allowed("Only newly submitted requests can be moved into review.")
    change_status(db, event, S.under_review, user, now)


def request_clarification(db: Session, event: models.Event, user: User, kind: str, message: str, now: datetime) -> None:
    """US08: kept on the event (the latest request) and as the reason in the status history."""
    check_decision_allowed(db, event, user)
    label = KIND_LABEL[kind]
    text = check_note(message, f"{label} message")
    change_status(db, event, S.pending_clarification, user, now, reason=f"{label}: {text}")
    event.clarification = {"kind": kind, "message": text, "requestedBy": user.name, "requestedAt": iso(now)}


def decide(db: Session, event: models.Event, user: User, outcome: str, reason: str, now: datetime) -> None:
    """US10: approve (optional note) or reject (reason required)."""
    check_decision_allowed(db, event, user)
    if outcome == "approved":
        text = check_note(reason, "Approval note", required=False)
        change_status(db, event, S.approved, user, now, reason=text or None)
    else:
        text = check_note(reason, "Rejection reason", min_length=MIN_REJECTION_REASON_LENGTH)
        change_status(db, event, S.rejected, user, now, reason=text)
    event.decision = {"outcome": outcome, "by": user.name, "at": iso(now), **({"reason": text} if text else {})}


def iso(moment: datetime) -> str:
    """'2026-10-10T08:30:00.000Z', the same form as the frontend's toISOString()."""
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"

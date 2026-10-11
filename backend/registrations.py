"""
Attendee registration (US29-US32): register, join the waitlist, withdraw, and the lists.

    register     confirmed events with registration on, up to and including the closing date
                 (campus time). A place while registered < capacity, otherwise the waitlist.
    withdraw     up to and including the withdrawal deadline: 7 days before registration
                 closes, or the event date when there is no closing date. When someone with a
                 place withdraws, the longest-waiting attendee on the waitlist takes it.

Places are counted and given out while the event row is locked (SELECT ... FOR UPDATE on
PostgreSQL), so two attendees can never both take the last place. Every change goes through
this module so the count, the waitlist and the rules stay consistent.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from login.models import User
from schemas import RegistrationResponse, campus_today

R = models.RegistrationStatus
ACTIVE = (R.registered, R.waitlisted)
WITHDRAWAL_NOTICE = timedelta(days=7)


def withdrawal_close(event: models.Event) -> Optional[date]:
    """The last day an attendee may withdraw (None: no deadline)."""
    if event.registration_close is not None:
        return event.registration_close - WITHDRAWAL_NOTICE
    return event.date


def registered_count(db: Session, event_id: int) -> int:
    """Places taken: registered attendees (the waitlist doesn't count)."""
    return (
        db.query(func.count(models.Registration.id))
        .filter(models.Registration.event_id == event_id, models.Registration.status == R.registered)
        .scalar()
    )


def refuse(message: str) -> HTTPException:
    return HTTPException(status_code=409, detail=message)


def locked_event(db: Session, event_id: int) -> models.Event:
    """The event, locked until the end of the transaction so places are given out one at a time."""
    event = db.query(models.Event).filter(models.Event.id == event_id).with_for_update().one_or_none()
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


def find(db: Session, event_id: int, attendee: User) -> Optional[models.Registration]:
    return (
        db.query(models.Registration)
        .filter(models.Registration.event_id == event_id, models.Registration.attendee_id == attendee.id)
        .one_or_none()
    )


def register(db: Session, event: models.Event, attendee: User, now: datetime) -> models.Registration:
    """US29: give `attendee` a place, or a spot on the waitlist when the event is full.
    `event` must be locked (locked_event)."""
    if event.status != models.EventStatus.confirmed or not event.registration_required:
        raise refuse("Registration is not open for this event.")
    if event.registration_close is not None and campus_today(now) > event.registration_close:
        raise refuse(f"Registration for {event.name} has closed.")

    registration = find(db, event.id, attendee)
    if registration is not None and registration.status in ACTIVE:
        raise refuse(f"You already have a {registration.status.value} registration for {event.name}.")

    full = event.registration_cap is not None and registered_count(db, event.id) >= event.registration_cap
    status = R.waitlisted if full else R.registered
    if registration is None:
        registration = models.Registration(event_id=event.id, attendee_id=attendee.id)
        db.add(registration)
    registration.status = status
    registration.registered_at = now  # re-registering joins the back of the queue
    registration.updated_at = now
    db.flush()
    return registration


def withdraw(db: Session, event: models.Event, attendee: User, now: datetime) -> models.Registration:
    """US31: withdraw `attendee`, and give a freed place to the waitlist. `event` must be locked."""
    registration = find(db, event.id, attendee)
    if registration is None or registration.status not in ACTIVE:
        raise refuse("No active registration was found.")
    deadline = withdrawal_close(event)
    if deadline is not None and campus_today(now) > deadline:
        raise refuse(f"The withdrawal deadline for {event.name} has passed.")

    freed_a_place = registration.status == R.registered
    registration.status = R.withdrawn
    registration.updated_at = now
    db.flush()
    if freed_a_place:
        promote_from_waitlist(db, event, now)
    return registration


def promote_from_waitlist(db: Session, event: models.Event, now: datetime) -> Optional[models.Registration]:
    """Move the longest-waiting attendee up into a free place, if there is one."""
    if event.registration_cap is not None and registered_count(db, event.id) >= event.registration_cap:
        return None
    first = (
        db.query(models.Registration)
        .filter(models.Registration.event_id == event.id, models.Registration.status == R.waitlisted)
        .order_by(models.Registration.registered_at, models.Registration.id)
        .first()
    )
    if first is not None:
        first.status = R.registered
        first.updated_at = now
        db.flush()
    return first


def utc(value: Optional[datetime]) -> Optional[datetime]:
    """Mark a stored timestamp as UTC (SQLite drops the timezone)."""
    return value.replace(tzinfo=timezone.utc) if value is not None and value.tzinfo is None else value


def response(registration: models.Registration, event: models.Event, attendee: User) -> RegistrationResponse:
    """The API view of a registration; shown as cancelled once the event is cancelled (US30)."""
    cancelled = event.status == models.EventStatus.cancelled and registration.status in ACTIVE
    return RegistrationResponse(
        id=registration.id,
        eventId=event.id,
        eventName=event.name,
        eventDate=event.date,
        eventStart=event.start_time,
        eventEnd=event.end_time,
        attendeeName=attendee.name,
        attendeeEmail=attendee.email,
        status="cancelled" if cancelled else registration.status.value,
        registeredAt=utc(registration.registered_at),
        updatedAt=utc(registration.updated_at),
    )

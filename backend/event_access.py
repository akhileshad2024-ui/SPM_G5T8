"""
Who is involved in an event, and so may see it and its status (US02 AC1, US13 AC1/AC4).

    organiser          the events they created (drafts included)
    coordinator        events assigned to them, plus live events nobody is assigned to yet
                       (someone has to see those to review them or assign one, US07/US11)
    venue staff        events with a venue booking
    technical support  events that request equipment (once submitted)
    attendee           confirmed events open for registration

Drafts are only ever visible to their organiser. Coordinator assignments, bookings and
registrations are saved by other stories (US11, US22, US29); until they are, the rules
use what the events table already records.
"""

from sqlalchemy import and_, or_
from sqlalchemy.orm import Query

import models
from login.models import Role, User

S = models.EventStatus

# Live (submitted and not closed): an unassigned event in one of these still needs a coordinator.
UNASSIGNED_VISIBLE = (S.submitted, S.under_review, S.pending_clarification, S.approved, S.confirmed)


def involved_events(query: Query, user: User) -> Query:
    """Narrow a query over models.Event to the events `user` is involved in."""
    E = models.Event
    if user.role == Role.organiser:
        return query.filter(E.organiser_id == user.id)
    if user.role == Role.coordinator:
        return query.filter(or_(
            and_(E.coordinator_id == user.id, E.status != S.draft),
            and_(E.coordinator_id.is_(None), E.status.in_(UNASSIGNED_VISIBLE)),
        ))
    if user.role == Role.venue:
        return query.filter(E.status != S.draft, E.venue_id.is_not(None))
    if user.role == Role.tech:
        return query.filter(E.status != S.draft, E.equipment_state.is_not(None))
    if user.role == Role.attendee:
        return query.filter(E.status == S.confirmed, E.registration_required.is_(True))
    return query.filter(False)


def is_involved(event: models.Event, user: User) -> bool:
    """Same rule as involved_events(), for a single event already loaded."""
    if user.role == Role.organiser:
        return event.organiser_id == user.id
    if event.status == S.draft:
        return False
    if user.role == Role.coordinator:
        return event.coordinator_id == user.id or (event.coordinator_id is None and event.status in UNASSIGNED_VISIBLE)
    if user.role == Role.venue:
        return event.venue_id is not None
    if user.role == Role.tech:
        return event.equipment_state is not None
    if user.role == Role.attendee:
        return event.status == S.confirmed and bool(event.registration_required)
    return False

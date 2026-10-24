"""
Who is involved in an event, and so may see it and its status (US02 AC1, US13 AC1/AC4, US43).

    organiser          the events they created (drafts included)
    coordinator        only the events assigned to them (US43)
    lead               every live event, assigned or not: they oversee the coordinators and
                       assign the unassigned ones (US43, US11)
    venue staff        events with a venue booking
    technical support  submitted equipment requests assigned to that technician
    attendee           confirmed events open for registration

Drafts are only ever visible to their organiser. Coordinator assignments, bookings and
registrations are saved by other stories (US11, US22, US29); until they are, the rules
use what the events table already records.
"""

from sqlalchemy.orm import Query

import models
from login.models import Role, User

S = models.EventStatus

# Live: submitted and not closed. The Lead oversees these, and an unassigned one still needs a coordinator.
LIVE = (S.submitted, S.under_review, S.pending_clarification, S.approved, S.confirmed)


def involved_events(query: Query, user: User) -> Query:
    """Narrow a query over models.Event to the events `user` is involved in."""
    E = models.Event
    if user.role == Role.organiser:
        return query.filter(E.organiser_id == user.id)
    if user.role == Role.coordinator:
        return query.filter(E.coordinator_id == user.id, E.status != S.draft)
    if user.role == Role.lead:
        return query.filter(E.status.in_(LIVE))
    if user.role == Role.venue:
        return query.filter(E.status != S.draft, E.venue_id.is_not(None))
    if user.role == Role.tech:
        return query.filter(E.status != S.draft, E.equipment_state.is_not(None),
                            E.equipment_assignment.has(tech_id=user.id))
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
        return event.coordinator_id == user.id
    if user.role == Role.lead:
        return event.status in LIVE
    if user.role == Role.venue:
        return event.venue_id is not None
    if user.role == Role.tech:
        return (event.equipment_state is not None and event.equipment_assignment is not None
                and event.equipment_assignment.tech_id == user.id)
    if user.role == Role.attendee:
        return event.status == S.confirmed and bool(event.registration_required)
    return False

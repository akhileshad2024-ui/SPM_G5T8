"""
US14 Confirm Event

The assigned Event Coordinator confirms an event once its essential arrangements are complete:

  - every venue booking that holds a venue is approved, and there is at least one (AC1, CR-W7-3: an event
    may book several venues);
  - every item of equipment the event asks for is reserved by Technical Support (AC1);
  - no booking is flagged as needing alternative arrangements because its venue became unavailable (AC6,
    CR-W7-2, US39), or as requiring reassessment after the venue's times changed (US38) or after an accepted
    change (US49-AC4), and nothing else an accepted change flagged is unresolved (US50, US51);
  - the Safety Officer has approved the Operational Safety Check (AC7, CR-W7-6, US44): Safety Approved.

outstanding() lists every item still in the way, one per line, so the page can show them all (AC2).
confirm() refuses while any remain, then sets Confirmed with a timestamp (AC3); the caller notifies the
organiser and involved staff in the same transaction (AC4, messaging.event_confirmed).

Once confirmed, the event's details and equipment request are locked (AC5): US16 detail editing
(event_updates.PLANNING_STATUSES) and equipment editing (equipment.PLANNING) only accept events still in
planning. LOCKED_AFTER_CONFIRMATION names those fields; further changes go through a change request (US33).
Venue bookings are deliberately not locked: if a venue becomes unavailable after confirmation, the
coordinator must still be able to arrange a replacement (CR-W7-2).

Each step raises ReviewError (403 / 409) instead of saving. Nothing here commits.
"""

from datetime import datetime
from typing import List

from sqlalchemy.orm import Session

import change_reassessment
import hold_expiry
import models
from equipment import CATALOGUE
from event_review import ReviewError, not_allowed
from event_status import change_status, label
from event_updates import DETAIL_FIELDS
from login.models import Role, User
from venue_bookings import HOLDING, event_bookings

S = models.EventStatus

EQUIPMENT_NAMES = {item_id: name for item_id, name, _ in CATALOGUE}
# Statuses from which a confirmation can be attempted: the event has been approved and is somewhere in its
# planning or safety check. Only Safety Approved can actually be confirmed (AC7); from the others every
# missing step is listed instead.
CONFIRMABLE_FROM = (S.approved, S.pending_safety_review, S.safety_changes_requested, S.safety_rejected, S.safety_approved)
# AC5: what can no longer be edited once an event is confirmed (the US16 detail fields and the equipment request).
LOCKED_AFTER_CONFIRMATION = (*DETAIL_FIELDS, "equipment")


def outstanding(db: Session, event: models.Event, now: datetime) -> List[str]:
    """Every arrangement still in the way of confirming the event, in the order the coordinator works through
    them: venues, then equipment, then the safety check. An empty list means it can be confirmed."""
    items: List[str] = []

    # AC1 (CR-W7-3) + AC6 (CR-W7-2): each venue booking that holds a venue, on its own.
    holding = [b for b in event_bookings(db, event.id) if b.status in HOLDING and not hold_expiry.is_lapsed(b, now)]
    if not holding:
        items.append("No venue is booked for this event.")
    for booking in holding:
        if booking.status == "pending":
            items.append(f"The booking at {booking.venue_name} is still waiting for Venue Staff's approval.")
        if booking.flag:
            items.append(f"The booking at {booking.venue_name} needs alternative arrangements: {booking.flag.get('message', 'its venue became unavailable.')}")
        if booking.reassessment and booking.reassessment.get("reason") == change_reassessment.REASON:
            # US49-AC4: flagged by an accepted change until Venue Staff reassess it or it is replaced.
            items.append(f"The booking at {booking.venue_name} requires reassessment after change request "
                         f"#{booking.reassessment.get('change_request_id')}: {' '.join(booking.reassessment.get('problems', []))}")
        elif booking.reassessment:
            items.append(f"The booking at {booking.venue_name} requires reassessment: "
                         f"{booking.reassessment.get('message', 'its venue times changed.')}")

    # AC1: each item of equipment not yet reserved (fulfilled items were reserved first).
    for line in event.equipment or []:
        if line.get("status") not in ("reserved", "fulfilled"):
            name = EQUIPMENT_NAMES.get(line.get("id"), line.get("id", "equipment"))
            items.append(f"{line.get('qty', '')} × {name} is not yet reserved by Technical Support.".lstrip())
    # US49-AC4: what an accepted change flagged for reassessment besides the venues (US50, US51).
    items.extend(change_reassessment.change_flags(event))

    # AC7 (CR-W7-6): the Operational Safety Check must have approved the event (US44).
    if event.status != S.safety_approved:
        items.append(f"The Safety Officer hasn't approved the Operational Safety Check yet (the event is {label(event.status)}).")
    return items


def confirm(db: Session, event: models.Event, user: User, now: datetime) -> None:
    """US14: the assigned coordinator confirms the event (AC1-AC3, AC6, AC7). Does not commit."""
    if user.role != Role.coordinator or event.coordinator_id != user.id:
        raise ReviewError(403, "Only the event's assigned coordinator can confirm it.")
    if event.status == S.confirmed:
        raise not_allowed("This event is already confirmed.")
    if event.status not in CONFIRMABLE_FROM:
        raise not_allowed(f"Only an approved event can be confirmed (this event is {label(event.status)}).")
    items = outstanding(db, event, now)
    if items:
        raise not_allowed("Can't confirm yet. Outstanding: " + " ".join(f"({n}) {item}" for n, item in enumerate(items, 1)))
    change_status(db, event, S.confirmed, user, now)
    event.confirmed_at, event.confirmed_by_id = now, user.id

"""
US46, US47 and US48: what is in the way of a booking at its venue, which decides what stops it being
confirmed and what Venue Staff are shown. US38's re-check after a venue time change uses the same rule.
Kept free of FastAPI and the database so it can be unit tested directly.

A booking occupies its venue from (start - setup) to (end + turnaround). Every booking is padded with
the venue's CURRENT setup and turnaround time, so the check uses what the venue is configured with now,
around both bookings (Week 7 change #1). What can be in the way:

  confirmed_booking   another confirmed booking at the venue overlaps it   stops it being confirmed (US46)
  unavailable_period  one of the venue's unavailable periods overlaps it   stops it being confirmed, the
                                                                           same as a confirmed booking (US48)
  pending_request     another pending request overlaps it                  does not stop it: Venue Staff
                                                                           resolve these by hand (US47)

A pending hold whose expiry time has passed holds nothing, so it is left out of every check (US48).
Touching windows (one ends exactly when the next starts) do not overlap.
"""

from datetime import date, datetime, timezone
from typing import List, NamedTuple, Optional

from venue_availability import (
    Window, clash_text, event_window, occupied_window, overlaps, overlapping_periods, to_datetime, unavailability_text,
)

# A booking in one of these states holds its venue (a pending hold only until it expires, see holds_venue).
HOLDING = ("pending", "approved")

CONFIRMED_BOOKING = "confirmed_booking"
PENDING_REQUEST = "pending_request"
UNAVAILABLE_PERIOD = "unavailable_period"
# What stops a booking being confirmed. A pending request in the way does not (US47).
BLOCKING = (CONFIRMED_BOOKING, UNAVAILABLE_PERIOD)


class Slot(NamedTuple):
    """A booking as these rules see it: what it is, when it is, and whether it still holds its venue."""
    id: Optional[int]
    event_id: Optional[int]
    event_name: Optional[str]
    status: str  # "pending" | "approved"; anything else holds nothing
    date: date
    start: str  # "HH:MM"
    end: str
    expires_at: Optional[datetime] = None  # a pending hold stops holding the venue at this time (US42/US48)


def aware(moment: Optional[datetime]) -> Optional[datetime]:
    """A stored time with its time zone (UTC) put back, since SQLite drops it."""
    return moment.replace(tzinfo=timezone.utc) if moment is not None and moment.tzinfo is None else moment


def slot_of(row) -> Slot:
    """A saved booking (models.VenueBooking) as a Slot."""
    return Slot(row.id, row.event_id, row.event_name, row.status, row.date, row.start_time, row.end_time, aware(row.hold_expires_at))


def holds_venue(status: str, expires_at: Optional[datetime], now: datetime) -> bool:
    """Whether a booking holds its venue now: confirmed, or pending and its hold has not expired (US48).

    A hold expires at its expiry time, so at that instant it already holds nothing.
    """
    if status == "approved":
        return True
    return status == "pending" and (expires_at is None or expires_at > now)


def window_of(slot: Slot, venue) -> Window:
    """When `slot` keeps `venue` busy, with the venue's current setup and turnaround."""
    return occupied_window(event_window(slot.date, slot.start, slot.end), venue)


def _booking_conflict(venue, other: Slot, theirs: Window) -> dict:
    kind = CONFIRMED_BOOKING if other.status == "approved" else PENDING_REQUEST
    return {
        "kind": kind,
        "message": clash_text(venue, other.event_name, other.status, other.date, theirs),
        "blocks_approval": kind in BLOCKING,
        "booking_id": other.id, "event_id": other.event_id, "event_name": other.event_name, "status": other.status,
        "date": other.date, "start": other.start, "end": other.end,
        "occupied_start": to_datetime(theirs[0]), "occupied_end": to_datetime(theirs[1]),
    }


def booking_conflicts(slot: Slot, venue, others, now: datetime, with_pending: bool = True) -> List[dict]:
    """The other bookings at `venue` that overlap `slot`, earliest first.

    The booking itself and the rest of its own event are not in its way. `with_pending` says whether
    pending requests count, as well as confirmed bookings.
    """
    mine = window_of(slot, venue)
    found = []
    for other in others:
        if other.id == slot.id or (other.event_id is not None and other.event_id == slot.event_id):
            continue
        if not holds_venue(other.status, other.expires_at, now) or (other.status == "pending" and not with_pending):
            continue
        theirs = window_of(other, venue)
        if overlaps(mine, theirs):
            found.append(_booking_conflict(venue, other, theirs))
    return sorted(found, key=lambda c: (c["occupied_start"], c["booking_id"] or 0))


def period_conflicts(slot: Slot, venue) -> List[dict]:
    """The venue's unavailable periods that overlap `slot` (US48): in the way like a confirmed booking."""
    return [
        {
            "kind": UNAVAILABLE_PERIOD,
            "message": unavailability_text(venue, period, began, ended),
            "blocks_approval": True,
            "period_start": period.get("start"), "period_end": period.get("end"),
            "reason": period.get("reason"), "note": period.get("note"),
        }
        for period, began, ended in overlapping_periods(venue, window_of(slot, venue))
    ]


def conflicts_for(slot: Slot, venue, others, now: datetime) -> List[dict]:
    """Everything in the way of `slot`, as Venue Staff see it: bookings first, then unavailable periods.

    A pending request is shown the pending requests it conflicts with (US47). A confirmed booking is only
    shown the confirmed bookings and periods it conflicts with: a pending request overlapping it shows that
    on its own card.
    """
    return booking_conflicts(slot, venue, others, now, with_pending=slot.status == "pending") + period_conflicts(slot, venue)


def blocking(conflicts: List[dict]) -> List[dict]:
    """The conflicts that stop a booking being confirmed (US46, US48)."""
    return [c for c in conflicts if c["blocks_approval"]]


def as_json(conflict: dict) -> dict:
    """A conflict with its dates and times as text, so it can be saved in a JSON column."""
    return {key: value.isoformat() if isinstance(value, date) else value for key, value in conflict.items()}

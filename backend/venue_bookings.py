"""
Saved venue bookings (US22 request, and Venue Staff's approve or reject): reading the bookings that
hold venues, saving a new request, and deciding one. Works on a database session; the rules
themselves are in booking_request.py and venue_availability.py.

An event has one current venue (events.venue_id with events.booking_state), kept in step with its
bookings here: asking for a venue makes it pending, approving makes it approved, rejecting hands the
event back to its previous approved venue or, if it had none, to no venue.
"""

from datetime import timezone
from typing import List, Optional

import models
import schemas
from booking_request import BookingRefused
from venue_availability import format_date

# A booking in these states holds its venue: nobody else can be given the slot.
HOLDING = ("pending", "approved")


def held_periods(db, venue_ids: Optional[List[int]] = None, exclude_event_id: Optional[int] = None) -> List[schemas.BookedPeriod]:
    """The bookings that currently hold venues, as the availability rules read them."""
    query = db.query(models.VenueBooking).filter(models.VenueBooking.status.in_(HOLDING))
    if venue_ids is not None:
        query = query.filter(models.VenueBooking.venue_id.in_(venue_ids))
    if exclude_event_id is not None:
        query = query.filter(models.VenueBooking.event_id != exclude_event_id)
    return [
        schemas.BookedPeriod(
            venue_id=row.venue_id, date=row.date, start=row.start_time, end=row.end_time,
            status=row.status, event_id=str(row.event_id), event_name=row.event_name,
        )
        for row in query.all()
    ]


def _utc(moment):
    """A saved time with its time zone back (SQLite drops it), so browsers show local time correctly."""
    return moment.replace(tzinfo=timezone.utc) if moment is not None and moment.tzinfo is None else moment


def to_record(row: models.VenueBooking) -> dict:
    """A saved booking as the API shows it (schemas.VenueBooking)."""
    return {
        "id": row.id, "event_id": row.event_id, "event_name": row.event_name,
        "venue_id": row.venue_id, "venue_name": row.venue_name,
        "date": row.date, "start": row.start_time, "end": row.end_time,
        "setup_minutes": row.setup_minutes, "teardown_minutes": row.teardown_minutes,
        "hold_start": row.hold_start, "hold_end": row.hold_end,
        "attendance": row.attendance, "layout": row.layout,
        "status": row.status, "verdict": row.verdict,
        "requested_by": row.requested_by, "requested_at": _utc(row.requested_at),
        "override": row.override,
        "decided_by": row.decided_by, "decided_at": _utc(row.decided_at), "decision_reason": row.decision_reason,
    }


def save_request(db, event: models.Event, values: dict) -> models.VenueBooking:
    """Save the pending booking and make it the event's current venue. The event's earlier pending
    request (for another venue) is replaced by it, so it no longer holds that venue."""
    for earlier in db.query(models.VenueBooking).filter(
        models.VenueBooking.event_id == event.id, models.VenueBooking.status == "pending"
    ).all():
        earlier.status = "cancelled"
    row = models.VenueBooking(**values)
    db.add(row)
    event.venue_id = values["venue_id"]
    event.booking_state = "pending"
    db.commit()
    db.refresh(row)
    return row


def decide(db, booking: models.VenueBooking, outcome: str, reason: str, decided_by: str, now) -> None:
    """Venue Staff approve or reject a pending request. Does not commit: the caller saves it.

    Rejecting needs a reason. Approving is refused if the venue was deactivated since, or if an approved
    booking already holds it for an overlapping period (a confirmed booking blocks the venue).
    """
    if booking.status != "pending":
        raise BookingRefused(f"This request is no longer pending (it is {booking.status}).")
    reason = (reason or "").strip()
    event = db.get(models.Event, booking.event_id)

    if outcome == "rejected":
        if not reason:
            raise BookingRefused("Give a reason for rejecting the request.")
        booking.status = "rejected"
        previous = (
            db.query(models.VenueBooking)
            .filter(models.VenueBooking.event_id == booking.event_id, models.VenueBooking.status == "approved")
            .order_by(models.VenueBooking.id.desc())
            .first()
        )
        event.venue_id, event.booking_state = (previous.venue_id, "approved") if previous else (None, "rejected")
    else:
        venue = db.get(models.Venue, booking.venue_id)
        if not venue.is_active:
            raise BookingRefused(f"{venue.name} has been deactivated and can't be approved.")
        clash = (
            db.query(models.VenueBooking)
            .filter(
                models.VenueBooking.venue_id == booking.venue_id,
                models.VenueBooking.status == "approved",
                models.VenueBooking.event_id != booking.event_id,
                models.VenueBooking.hold_start < booking.hold_end,
                models.VenueBooking.hold_end > booking.hold_start,
            )
            .first()
        )
        if clash:
            raise BookingRefused(f"Can't approve: clashes with {clash.event_name}, already booked on {format_date(clash.date)}.")
        booking.status = "approved"
        # The event now has its venue: any earlier booking of it (the one this replaces) is released.
        for other in db.query(models.VenueBooking).filter(
            models.VenueBooking.event_id == booking.event_id,
            models.VenueBooking.id != booking.id,
            models.VenueBooking.status.in_(HOLDING),
        ).all():
            other.status = "cancelled"
        event.venue_id, event.booking_state = booking.venue_id, "approved"

    booking.decided_by, booking.decided_at, booking.decision_reason = decided_by, now, reason or None

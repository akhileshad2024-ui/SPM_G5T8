"""
Saved venue bookings (US22 request, and Venue Staff's approve or reject): reading the bookings that
hold venues, saving a new request, and deciding one. Works on a database session; the rules
themselves are in booking_request.py and venue_availability.py.

US41: an event may book several venues at once, each at a different venue with its own attendance,
layout and purpose; one can be changed or cancelled without touching the others. The event keeps a
summary of them for the rest of the app (events.venue_id with events.booking_state, see summarise()):
its main venue is the first approved booking, else the first pending one.
"""

from datetime import datetime, timedelta, timezone
from typing import List, Optional

import hold_expiry
import models
import schemas
from booking_request import BookingRefused
from venue_availability import format_date

# A booking in these states holds its venue: nobody else can be given the slot.
HOLDING = ("pending", "approved")
# US23-AC5: how long after Venue Staff decide a request the coordinator is still shown the outcome.
DECISION_NOTICE_WINDOW = timedelta(days=7)


def held_periods(db, venue_ids: Optional[List[int]] = None, exclude_event_id: Optional[int] = None,
                 now: Optional[datetime] = None) -> List[schemas.BookedPeriod]:
    """The bookings that currently hold venues, as the availability rules read them.

    US42: a tentative hold whose expiry has passed no longer holds its venue, even before "expired"
    has been saved on it.
    """
    now = now or datetime.now(timezone.utc)
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
        if not hold_expiry.is_lapsed(row, now)
    ]


def _utc(moment):
    """A saved time with its time zone back (SQLite drops it), so browsers show local time correctly."""
    return moment.replace(tzinfo=timezone.utc) if moment is not None and moment.tzinfo is None else moment


def to_record(row: models.VenueBooking, now: Optional[datetime] = None) -> dict:
    """A saved booking as the API shows it (schemas.VenueBooking)."""
    now = now or datetime.now(timezone.utc)
    return {
        "id": row.id, "event_id": row.event_id, "event_name": row.event_name,
        "venue_id": row.venue_id, "venue_name": row.venue_name,
        "date": row.date, "start": row.start_time, "end": row.end_time,
        "setup_minutes": row.setup_minutes, "teardown_minutes": row.teardown_minutes,
        "hold_start": row.hold_start, "hold_end": row.hold_end,
        "attendance": row.attendance, "layout": row.layout, "purpose": row.purpose,
        "status": row.status, "verdict": row.verdict,
        "requested_by": row.requested_by, "requested_at": _utc(row.requested_at),
        "override": row.override,
        "decided_by": row.decided_by, "decided_at": _utc(row.decided_at), "decision_reason": row.decision_reason,
        "flag": row.flag,
        # US42: when the tentative hold lapses, who set that, and what the coordinator should be told.
        "hold_expires_at": _utc(row.hold_expires_at), "hold_expiry_set_by": row.hold_expiry_set_by,
        "hold_notice": hold_expiry.hold_notice(row, now),
        # US23-AC5: the outcome the requesting coordinator should be told about.
        "decision_notice": decision_notice(row, now),
    }


def decision_notice(row, now: datetime) -> Optional[str]:
    """US23-AC5: "approved" or "rejected" while the decision is recent enough to tell the coordinator about.
    Notifications aren't stored on the server yet (US36), so the page shows these when it loads."""
    decided = _utc(getattr(row, "decided_at", None))
    if row.status not in ("approved", "rejected") or decided is None:
        return None
    return row.status if now - decided <= DECISION_NOTICE_WINDOW else None


def event_bookings(db, event_id: int) -> List[models.VenueBooking]:
    """Every booking of the event, oldest first."""
    return db.query(models.VenueBooking).filter(models.VenueBooking.event_id == event_id).order_by(models.VenueBooking.id).all()


def summarise(db, event: models.Event) -> None:
    """Keep the event's venue and booking state in step with its bookings (US41).

    venue: the first approved booking, else the first pending one, else none.
    booking_state: approved when every booking holding a venue is approved, pending while any is
    pending; with none holding a venue, rejected if Venue Staff rejected every one, else none (the
    coordinator cancelled them).
    """
    db.flush()
    rows = event_bookings(db, event.id)
    holding = [r for r in rows if r.status in HOLDING]
    if holding:
        main = next((r for r in holding if r.status == "approved"), holding[0])
        event.venue_id = main.venue_id
        event.booking_state = "approved" if all(r.status == "approved" for r in holding) else "pending"
    else:
        event.venue_id = None
        event.booking_state = "rejected" if rows and all(r.status == "rejected" for r in rows) else None


def save_request(db, event: models.Event, values: dict) -> models.VenueBooking:
    """Save the pending booking. The event's other bookings are kept (US41).

    US42: the new tentative hold gets its default expiry; Venue Staff can change it later.
    """
    row = models.VenueBooking(**values)
    if row.hold_expires_at is None:
        row.hold_expires_at = hold_expiry.default_expiry(row, row.requested_at)
    db.add(row)
    summarise(db, event)
    db.commit()
    db.refresh(row)
    return row


def require_holding(booking: models.VenueBooking) -> None:
    if booking.status not in HOLDING:
        raise BookingRefused(f"This booking is {booking.status}, so it can't be changed or cancelled.")


def change(db, booking: models.VenueBooking, values: dict) -> None:
    """US41: change one booking's attendance, layout, purpose or override. Does not commit.

    An approved booking goes back to pending, since Venue Staff approved different needs.
    """
    require_holding(booking)
    for field, value in values.items():
        setattr(booking, field, value)
    if booking.status == "approved":
        booking.status = "pending"
        booking.decided_by = booking.decided_at = booking.decision_reason = None
    summarise(db, db.get(models.Event, booking.event_id))


def cancel(db, bookings: List[models.VenueBooking]) -> None:
    """US41: cancel these bookings of one event; its other bookings are kept. Does not commit."""
    for booking in bookings:
        require_holding(booking)
        booking.status = "cancelled"
    if bookings:
        summarise(db, db.get(models.Event, bookings[0].event_id))


def decide(db, booking: models.VenueBooking, outcome: str, reason: str, decided_by: str, now) -> None:
    """Venue Staff approve or reject a pending request. Does not commit: the caller saves it.

    Rejecting needs a reason. Approving is refused if the venue was deactivated since, or if an approved
    booking already holds it for an overlapping period (a confirmed booking blocks the venue).
    """
    # US42-AC4: a hold whose expiry has passed is expired, never a confirmed booking (even if not saved yet).
    if hold_expiry.is_lapsed(booking, now):
        booking.status = "expired"
    # US23-AC7: an expired tentative hold can't be approved; there is nothing left to reject either.
    if booking.status == "expired":
        expires = hold_expiry.as_utc(booking.hold_expires_at)
        when = f" on {expires.astimezone(schemas.CAMPUS_TZ):%d %b %Y, %H:%M}" if expires else ""
        if outcome == "rejected":
            raise BookingRefused(f"This tentative hold expired{when}, so the venue has already been released.")
        raise BookingRefused(f"This tentative hold expired{when} and can't be approved.")
    if booking.status != "pending":
        raise BookingRefused(f"This request is no longer pending (it is {booking.status}).")
    reason = (reason or "").strip()
    event = db.get(models.Event, booking.event_id)

    if outcome == "rejected":
        if not reason:
            raise BookingRefused("Give a reason for rejecting the request.")
        booking.status = "rejected"
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
        booking.status = "approved"  # the event's other bookings are kept (US41)

    booking.decided_by, booking.decided_at, booking.decision_reason = decided_by, now, reason or None
    summarise(db, event)

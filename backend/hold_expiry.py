"""
US42 — tentative venue holds expire (Week 7 change CR-W7-4).

A pending booking request is a tentative hold: it keeps the venue for the event until Venue Staff
approve it (US23). Every hold has an expiry date and time, so a venue is never held indefinitely:

  - a new request gets DEFAULT_HOLD after it was made, or the start of setup if that is sooner;
  - Venue Staff can set or change the expiry while the request is pending (set_expiry);
  - once the expiry passes without an approval, the hold lapses: the booking becomes "expired",
    the venue is free for other requests, and the hold is never treated as a confirmed booking.

Lapsing is decided from the time: `is_lapsed` answers it for one booking, and `expire_due` saves the
"expired" status for every lapsed hold. messaging.sweep_holds calls it (and tells the coordinator, US36)
every minute in the background and before bookings, events or notifications are read.

Times: expiries are stored in UTC. hold_start (start of setup) is local campus wall-clock time, so
it is compared in campus time (schemas.CAMPUS_TZ).
"""

from datetime import datetime, timedelta, timezone
from typing import List, Optional

import models
from booking_request import BookingRefused
from schemas import CAMPUS_TZ

DEFAULT_HOLD = timedelta(days=3)
# The coordinator is warned once a hold is this close to expiring (US42-AC3).
WARNING_WINDOW = timedelta(hours=24)


def as_utc(moment: Optional[datetime]) -> Optional[datetime]:
    """A saved time as an aware UTC datetime (SQLite drops the time zone on the way back)."""
    if moment is None:
        return None
    return moment.replace(tzinfo=timezone.utc) if moment.tzinfo is None else moment.astimezone(timezone.utc)


def setup_starts_at(booking) -> datetime:
    """When the venue is first needed (start of setup), as an aware UTC datetime."""
    return booking.hold_start.replace(tzinfo=CAMPUS_TZ).astimezone(timezone.utc)


def default_expiry(booking, requested_at: datetime) -> datetime:
    """A new hold's expiry: DEFAULT_HOLD after the request, but never after setup starts."""
    return min(as_utc(requested_at) + DEFAULT_HOLD, setup_starts_at(booking))


def is_lapsed(booking, now: datetime) -> bool:
    """True when a pending hold's expiry has passed, whether or not "expired" has been saved yet.
    A booking without an expiry (e.g. saved before US42) never lapses."""
    expires = as_utc(getattr(booking, "hold_expires_at", None))
    return booking.status == "pending" and expires is not None and expires <= now


def hold_notice(booking, now: datetime) -> Optional[str]:
    """What the coordinator should be told about this hold (US42-AC3): expiring soon, or expired."""
    if booking.status == "expired" or is_lapsed(booking, now):
        return "expired"
    expires = as_utc(getattr(booking, "hold_expires_at", None))
    if booking.status == "pending" and expires is not None and expires - now <= WARNING_WINDOW:
        return "expiring_soon"
    return None


def check_expiry(booking, expires_at: datetime, now: datetime) -> datetime:
    """
    US42-AC1: Venue Staff setting a hold's expiry. Returns it in UTC, or raises BookingRefused.
    Only a pending (still held) request has a hold; the expiry must be in the future and no later
    than the start of setup.
    """
    if booking.status != "pending" or is_lapsed(booking, now):
        state = "expired" if is_lapsed(booking, now) else booking.status
        raise BookingRefused(f"Only a pending request is held, and this one is {state}.")
    if expires_at.tzinfo is None:
        raise BookingRefused("Give the expiry with its time zone.")
    expires = expires_at.astimezone(timezone.utc)
    if expires <= now:
        raise BookingRefused("The expiry must be in the future.")
    if expires > setup_starts_at(booking):
        raise BookingRefused("The hold can't last beyond the start of setup for the event.")
    return expires


def set_expiry(booking, expires_at: datetime, set_by: str, now: datetime) -> None:
    """US42-AC1: Venue Staff set or change when this hold expires. Does not commit."""
    booking.hold_expires_at = check_expiry(booking, expires_at, now)
    booking.hold_expiry_set_by = set_by


def expire_due(db, now: datetime) -> List[models.VenueBooking]:
    """
    US42-AC2: mark every lapsed hold "expired", so the venue is released and the event's booking
    summary is updated. Returns the bookings that expired now. Does not commit.
    """
    from venue_bookings import summarise  # imported here: venue_bookings imports this module

    pending = db.query(models.VenueBooking).filter(
        models.VenueBooking.status == "pending",
        models.VenueBooking.hold_expires_at.isnot(None),
    ).all()
    lapsed = [b for b in pending if is_lapsed(b, now)]
    for booking in lapsed:
        booking.status = "expired"
    for event_id in {b.event_id for b in lapsed}:
        summarise(db, db.get(models.Event, event_id))
    return lapsed

"""
US39 Mark Venue Temporarily Unavailable (Week 7 change #2): when Venue Staff record, edit or end an
unavailability period, every booking that still holds the venue during it is flagged as needing
alternative arrangements. A flagged booking is never cancelled and its event is left untouched; the
flag is saved on the booking, so the coordinator sees it (and is notified) from GET /bookings.

The overlap rule is kept free of the database so it can be unit tested directly.
"""

from datetime import datetime
from typing import List, Optional

import models
from venue_availability import DAY_MINUTES, UNAVAILABILITY_REASONS, format_stamp, overlaps, parse_stamp

FLAG_KIND = "venue_unavailable"
# Bookings in these states hold their venue, so an unavailability period puts them in trouble.
HOLDING = ("pending", "approved")


def _minutes(moment: datetime) -> int:
    """A stored hold time -> minutes, counted the same way as venue_availability."""
    return moment.toordinal() * DAY_MINUTES + moment.hour * 60 + moment.minute


def clashing_period(hold_start: datetime, hold_end: datetime, periods) -> Optional[dict]:
    """The first unavailability period that overlaps the hold (setup and turnaround included), or None."""
    hold = (_minutes(hold_start), _minutes(hold_end))
    for period in periods or []:
        began, ended = parse_stamp(period.get("start")), parse_stamp(period.get("end"))
        if began is not None and ended is not None and overlaps(hold, (began, ended)):
            return period
    return None


def build_flag(venue_name: str, period: dict, now: datetime) -> dict:
    """What is saved on the booking: which period caused it and the message the coordinator sees."""
    reason = UNAVAILABILITY_REASONS.get(period.get("reason"), period.get("reason"))
    note = f": {period['note']}" if period.get("note") else ""
    began, ended = parse_stamp(period.get("start")), parse_stamp(period.get("end"))
    return {
        "kind": FLAG_KIND,
        "reason": period.get("reason"),
        "note": period.get("note"),
        "period_start": period.get("start"),
        "period_end": period.get("end"),
        "message": (f"{venue_name} is unavailable ({reason}{note}) from {format_stamp(began)} to {format_stamp(ended)}. "
                    "A replacement venue is required."),
        "flagged_at": now.isoformat(),
    }


def flag_affected_bookings(db, venue: models.Venue, now: datetime) -> List[models.VenueBooking]:
    """Flag (or un-flag) the bookings holding `venue` against its current unavailability periods.

    A booking caught by a period gets the flag; one whose period was ended early or removed loses it.
    Only the flag changes: status, times and the event stay as they were. Does not commit.
    Returns the bookings that are newly flagged, so their coordinators can be told.
    """
    newly_flagged = []
    bookings = db.query(models.VenueBooking).filter(
        models.VenueBooking.venue_id == venue.id, models.VenueBooking.status.in_(HOLDING)
    ).all()
    for booking in bookings:
        period = clashing_period(booking.hold_start, booking.hold_end, venue.unavailability)
        current = booking.flag if booking.flag and booking.flag.get("kind") == FLAG_KIND else None
        if period is None:
            if current:
                booking.flag = None
            continue
        if current and current["period_start"] == period.get("start") and current["period_end"] == period.get("end") \
                and current["reason"] == period.get("reason") and current.get("note") == period.get("note"):
            continue  # already flagged for this exact period
        booking.flag = build_flag(venue.name, period, now)
        if current is None:
            newly_flagged.append(booking)
    return newly_flagged

"""
US19 — the venue availability calendar (Week 7 changes CR-W7-1, CR-W7-4).

What each active venue's time looks like over a range of days: confirmed bookings, pending requests
(tentative holds, with their expiry), holds that expired and so released the venue, and recorded
unavailable periods.

A booking's times are the window it occupies the venue: the event, with the venue's configured setup
before it and turnaround after it (the same rule as the conflict checks, venue_availability.py).

Every viewer sees that a venue is busy, because that is what the calendar is for. Which event it is
busy with is only sent to someone who may see that event (US19-AC5, event_access.py), so a booking of
another coordinator's event is just "booked" here and the page has nothing to hide.
"""

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import List, Optional, Set

import bookings.hold_expiry as hold_expiry
import models
from event_requests.access import involved_events
from auth.models import Role, User
from venues.availability import DAY_MINUTES, Window, event_window, occupied_window, overlaps, parse_stamp, to_datetime

# The longest range one request may ask for: the 42 days of a month view, with some to spare.
MAX_RANGE_DAYS = 62

KINDS = {"approved": "confirmed", "pending": "pending", "expired": "expired"}

# A booking on another date can reach into the range: it may run past midnight, with its turnaround after that.
REACH = timedelta(days=2)


def range_error(first: date, last: date) -> Optional[str]:
    """What is wrong with this range of days, or None."""
    if last < first:
        return "The end date can't be before the start date."
    if (last - first).days >= MAX_RANGE_DAYS:
        return f"The calendar shows at most {MAX_RANGE_DAYS} days at a time."
    return None


def day_range(first: date, last: date) -> Window:
    """Those days, from the start of the first to the end of the last, in venue_availability's minutes."""
    return first.toordinal() * DAY_MINUTES, (last.toordinal() + 1) * DAY_MINUTES


def stamp(minutes: int) -> str:
    """Minutes -> "2027-01-04T09:30" (local wall-clock time, like the rest of the venue rules)."""
    return to_datetime(minutes).strftime("%Y-%m-%dT%H:%M")


def visible_event_ids(db, user: User, event_ids: Set[int]) -> Set[int]:
    """Which of these events `user` may see the details of. Venue Staff manage every booking (US23)."""
    if user.role == Role.venue:
        return event_ids
    query = involved_events(db.query(models.Event), user).filter(models.Event.id.in_(event_ids))
    return {row.id for row in query.with_entities(models.Event.id)}


def booking_period(row: models.VenueBooking, venue: models.Venue, shown: Window, details: bool, now: datetime) -> Optional[dict]:
    """The booking as a calendar period, or None when it does not reach into the range shown."""
    occupied = occupied_window(event_window(row.date, row.start_time, row.end_time), venue)
    if not overlaps(occupied, shown):
        return None
    kind = "expired" if hold_expiry.is_lapsed(row, now) else KINDS[row.status]
    return {
        "kind": kind, "start": stamp(occupied[0]), "end": stamp(occupied[1]),
        "event_start": row.start_time, "event_end": row.end_time,
        "setup_minutes": venue.setupMinutes or 0, "turnaround_minutes": venue.turnaroundMinutes or 0,
        "hold_expires_at": hold_expiry.as_utc(row.hold_expires_at) if kind != "confirmed" else None,
        "event_id": row.event_id if details else None,
        "event_name": row.event_name if details else None,
    }


def unavailable_periods(venue: models.Venue, shown: Window) -> List[dict]:
    """The venue's recorded unavailable periods that reach into the range shown."""
    periods = []
    for period in venue.unavailability or []:
        began, ended = parse_stamp(period.get("start")), parse_stamp(period.get("end"))
        if began is not None and ended is not None and overlaps((began, ended), shown):
            periods.append({"kind": "unavailable", "start": stamp(began), "end": stamp(ended),
                            "reason": period.get("reason"), "note": period.get("note")})
    return periods


def calendar(db, user: User, first: date, last: date, now: datetime) -> List[dict]:
    """Every active venue with its periods from `first` to `last`, earliest first."""
    venues = db.query(models.Venue).filter(models.Venue.is_active.is_(True)).order_by(models.Venue.id).all()
    rows = db.query(models.VenueBooking).filter(
        models.VenueBooking.status.in_(KINDS),
        models.VenueBooking.date.between(first - REACH, last + REACH),
    ).all()
    visible = visible_event_ids(db, user, {row.event_id for row in rows})
    by_venue = defaultdict(list)
    for row in rows:
        by_venue[row.venue_id].append(row)

    shown = day_range(first, last)
    result = []
    for venue in venues:
        bookings = (booking_period(row, venue, shown, row.event_id in visible, now) for row in by_venue[venue.id])
        periods = [period for period in bookings if period] + unavailable_periods(venue, shown)
        result.append({
            "id": venue.id, "name": venue.name,
            "setup_minutes": venue.setupMinutes or 0, "turnaround_minutes": venue.turnaroundMinutes or 0,
            "periods": sorted(periods, key=lambda period: (period["start"], period["end"])),
        })
    return result

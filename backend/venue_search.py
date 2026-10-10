"""
US20 venue search logic: which active venues meet an Event Coordinator's requirements and
are free for the period asked for. Kept free of FastAPI and the database so it can be unit
tested directly.

All times are local wall-clock times, counted in minutes from day 1, so no time zones are
involved. The availability rules mirror lib/venue-rules.ts:
  * a booking occupies its venue from (start - setup) to (end + turnaround), Week 7 change #1
  * a venue is not free during one of its unavailability periods, Week 7 change #2
  * touching windows (one ends exactly when the next starts) do not overlap
"""

import re
from collections import defaultdict
from datetime import date, datetime
from typing import Dict, List, Optional, Tuple

import schemas

DAY_MINUTES = 24 * 60
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

# (start, end) in minutes
Window = Tuple[int, int]

_STAMP = re.compile(r"^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?")
_HOURS = re.compile(r"^\s*([01]?\d|2[0-3]):([0-5]\d)\s*-\s*([01]?\d|2[0-3]):([0-5]\d)\s*$")


# ---------------------------------------------------------------- time windows

def clock_minutes(text: str) -> int:
    """"09:30" -> 570."""
    hours, minutes = text.split(":")
    return int(hours) * 60 + int(minutes)


def event_window(day: date, start: str, end: str) -> Window:
    """When the event itself runs. An end at or before the start runs past midnight."""
    base = day.toordinal() * DAY_MINUTES
    first, last = clock_minutes(start), clock_minutes(end)
    if last <= first:
        last += DAY_MINUTES
    return base + first, base + last


def occupied_window(window: Window, venue) -> Window:
    """How long the event keeps `venue` busy: its setup before, its turnaround after."""
    return window[0] - (venue.setupMinutes or 0), window[1] + (venue.turnaroundMinutes or 0)


def overlaps(a: Window, b: Window) -> bool:
    return a[0] < b[1] and b[0] < a[1]


def parse_stamp(text: Optional[str]) -> Optional[int]:
    """"2027-01-10T08:00[:00]" -> minutes, or None when it is not a real date and time."""
    match = _STAMP.match(text or "")
    if not match:
        return None
    try:
        moment = datetime(int(match[1]), int(match[2]), int(match[3]), int(match[4] or 0), int(match[5] or 0))
    except ValueError:
        return None
    return moment.toordinal() * DAY_MINUTES + moment.hour * 60 + moment.minute


def parse_hours(text: Optional[str]) -> Optional[Window]:
    """"08:00 - 22:00" -> (480, 1320), or None when not recorded or not a valid range."""
    match = _HOURS.match(text or "")
    if not match:
        return None
    opens = int(match[1]) * 60 + int(match[2])
    closes = int(match[3]) * 60 + int(match[4])
    return (opens, closes) if closes > opens else None


# ---------------------------------------------------------------- the rules

def meets_requirements(venue, criteria) -> bool:
    """Capacity, location, layout, facilities and accessibility: every one that was asked for."""
    if criteria.attendance is not None and venue.cap < criteria.attendance:
        return False
    if criteria.location and criteria.location.lower() != (venue.location or "").strip().lower():
        return False
    if criteria.layout and criteria.layout not in _lowered(venue.layouts):
        return False
    return _has_all(venue.facilities, criteria.facilities) and _has_all(venue.accessibility, criteria.accessibility)


def is_free(venue, day: date, start: str, end: str, bookings) -> bool:
    """Whether `venue` can be used on `day` from `start` to `end`, setup and turnaround included.

    `bookings` are the existing bookings at this venue.
    """
    own = event_window(day, start, end)
    occupied = occupied_window(own, venue)

    open_days = venue.operatingDays or []
    if open_days and schemas.WEEKDAYS[day.weekday()] not in open_days:
        return False

    hours = parse_hours(venue.operatingHours)
    if hours:
        base = day.toordinal() * DAY_MINUTES
        # Only the event itself has to fit; setup or turnaround running outside hours is allowed.
        if own[0] < base + hours[0] or own[1] > base + hours[1]:
            return False

    for period in venue.unavailability or []:
        began, ended = parse_stamp(period.get("start")), parse_stamp(period.get("end"))
        if began is not None and ended is not None and overlaps(occupied, (began, ended)):
            return False

    # The other booking is padded with this venue's setup and turnaround too.
    return not any(
        overlaps(occupied, occupied_window(event_window(b.date, b.start, b.end), venue)) for b in bookings
    )


def find_venues(venues, criteria) -> list:
    """The active venues that meet every requirement and, if a period was given, are free for it."""
    held: Dict[int, list] = defaultdict(list)
    for booking in criteria.bookings:
        held[booking.venue_id].append(booking)

    found = []
    for venue in venues:
        if not venue.is_active or not meets_requirements(venue, criteria):
            continue
        if criteria.date is not None and not is_free(venue, criteria.date, criteria.start, criteria.end, held[venue.id]):
            continue
        found.append(venue)
    return found


# ---------------------------------------------------------------- what the page shows

def describe_filters(criteria) -> List[dict]:
    """The filters in use, in the order the story lists them, as {key, label, value}."""
    applied = []
    if criteria.date is not None:
        day = f"{criteria.date.day:02d} {MONTHS[criteria.date.month - 1]} {criteria.date.year}"
        applied.append(("timing", "Date and time", f"{day}, {criteria.start}–{criteria.end}"))
    if criteria.attendance is not None:
        applied.append(("attendance", "Expected attendance", str(criteria.attendance)))
    if criteria.location:
        applied.append(("location", "Location", criteria.location))
    if criteria.accessibility:
        applied.append(("accessibility", "Accessibility", ", ".join(criteria.accessibility)))
    if criteria.layout:
        applied.append(("layout", "Layout", criteria.layout.capitalize()))
    if criteria.facilities:
        applied.append(("facilities", "Facilities", ", ".join(criteria.facilities)))
    return [{"key": key, "label": label, "value": value} for key, label, value in applied]


def no_match_message(applied: List[dict]) -> str:
    return "No venues match the filters applied." if applied else "There are no active venues in the catalogue."


# ---------------------------------------------------------------- helpers

def _lowered(items) -> set:
    return {item.lower() for item in items or []}


def _has_all(offered, required) -> bool:
    return _lowered(required) <= _lowered(offered)

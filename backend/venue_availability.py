"""
Venue availability rules shared by venue search (US20), the suitability check (US21) and booking
requests (US22). Kept free of FastAPI and the database so it can be unit tested directly.

All times are local wall-clock times, counted in minutes from day 1, so no time zones are
involved. The rules mirror lib/venues/rules.ts:
  * a booking occupies its venue from (start - setup) to (end + turnaround), Week 7 change #1
  * a venue is not free during one of its unavailability periods, Week 7 change #2
  * touching windows (one ends exactly when the next starts) do not overlap
"""

import re
from datetime import date, datetime, timedelta
from typing import List, NamedTuple, Optional, Tuple

import schemas

DAY_MINUTES = 24 * 60
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
UNAVAILABILITY_REASONS = {
    "maintenance": "Maintenance",
    "equipment_failure": "Equipment failure",
    "renovation": "Renovation",
    "safety": "Safety concern",
    "internal_activity": "Internal activity",
    "other": "Other",
}

# (start, end) in minutes
Window = Tuple[int, int]

_STAMP = re.compile(r"^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?")
_HOURS = re.compile(r"^\s*([01]?\d|2[0-3]):([0-5]\d)\s*-\s*([01]?\d|2[0-3]):([0-5]\d)\s*$")


class Issue(NamedTuple):
    """Something in the way of using a venue. "block": it can't be used; "warn": it can, with a caveat."""
    level: str
    text: str


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


# ---------------------------------------------------------------- showing times

def to_datetime(minutes: int) -> datetime:
    """Minutes (as counted above) -> the date and time they stand for."""
    return datetime.fromordinal(minutes // DAY_MINUTES) + timedelta(minutes=minutes % DAY_MINUTES)


def format_clock(minutes: int) -> str:
    """570 -> "09:30" (time of day only)."""
    moment = to_datetime(minutes)
    return f"{moment.hour:02d}:{moment.minute:02d}"


def format_date(day: date) -> str:
    """2027-01-04 -> "04 Jan 2027"."""
    return f"{day.day:02d} {MONTHS[day.month - 1]} {day.year}"


def format_stamp(minutes: int) -> str:
    """Minutes -> "04 Jan 2027, 09:30"."""
    return f"{format_date(to_datetime(minutes).date())}, {format_clock(minutes)}"


def describe_window(window: Window, venue) -> str:
    """"09:30–12:45 incl. 30 min setup and 45 min turnaround"."""
    extras = []
    if venue.setupMinutes:
        extras.append(f"{venue.setupMinutes} min setup")
    if venue.turnaroundMinutes:
        extras.append(f"{venue.turnaroundMinutes} min turnaround")
    suffix = f" incl. {' and '.join(extras)}" if extras else ""
    return f"{format_clock(window[0])}–{format_clock(window[1])}{suffix}"


# ---------------------------------------------------------------- the rules

def availability_issues(venue, day: date, start: str, end: str, bookings) -> List[Issue]:
    """Everything in the way of using `venue` on `day` from `start` to `end`, setup and turnaround included.

    `bookings` are the existing bookings at this venue (each has date, start, end, status, event_name).
    """
    issues: List[Issue] = []
    if not venue.is_active:
        issues.append(Issue("block", f"{venue.name} has been deactivated."))

    own = event_window(day, start, end)
    occupied = occupied_window(own, venue)

    weekday = schemas.WEEKDAYS[day.weekday()]
    open_days = venue.operatingDays or []
    if open_days and weekday not in open_days:
        issues.append(Issue("block", f"{venue.name} is closed on {weekday}s."))

    hours = parse_hours(venue.operatingHours)
    if hours:
        base = day.toordinal() * DAY_MINUTES
        if own[0] < base + hours[0] or own[1] > base + hours[1]:
            issues.append(Issue("block", f"{start}–{end} is outside {venue.name}'s operating hours ({venue.operatingHours})."))
        elif occupied[0] < base + hours[0] or occupied[1] > base + hours[1]:
            # Only the event itself has to fit; setup or turnaround running outside hours is a caveat.
            issues.append(Issue(
                "warn",
                f"Setup or turnaround ({describe_window(occupied, venue)}) runs outside operating hours ({venue.operatingHours}).",
            ))

    for period in venue.unavailability or []:
        began, ended = parse_stamp(period.get("start")), parse_stamp(period.get("end"))
        if began is not None and ended is not None and overlaps(occupied, (began, ended)):
            reason = UNAVAILABILITY_REASONS.get(period.get("reason"), period.get("reason"))
            note = f": {period['note']}" if period.get("note") else ""
            issues.append(Issue(
                "block",
                f"{venue.name} is unavailable ({reason}{note}) from {format_stamp(began)} to {format_stamp(ended)}.",
            ))

    for booking in bookings:
        # The other booking is padded with this venue's setup and turnaround too.
        theirs = occupied_window(event_window(booking.date, booking.start, booking.end), venue)
        if overlaps(occupied, theirs):
            who = booking.event_name or "another booking"
            what = "booked" if booking.status == "approved" else "requested"
            issues.append(Issue(
                "block",
                f"Clashes with {who}, already {what} on {format_date(booking.date)} (venue occupied {describe_window(theirs, venue)}).",
            ))
    return issues


def is_free(venue, day: date, start: str, end: str, bookings) -> bool:
    """Whether nothing blocks `venue` for that period (caveats do not count)."""
    return not any(issue.level == "block" for issue in availability_issues(venue, day, start, end, bookings))


def lowered(items) -> set:
    return {item.lower() for item in items or []}

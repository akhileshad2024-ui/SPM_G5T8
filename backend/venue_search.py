"""
US20 venue search logic: which active venues meet an Event Coordinator's requirements and
are free for the period asked for. Kept free of FastAPI and the database so it can be unit
tested directly.

"Free for the period" uses the shared availability rules in venue_availability.py.
"""

from collections import defaultdict
from typing import Dict, List

from venue_availability import MONTHS, is_free, lowered


# ---------------------------------------------------------------- the rules

def meets_requirements(venue, criteria) -> bool:
    """Capacity, location, layout, facilities and accessibility: every one that was asked for."""
    if criteria.attendance is not None and venue.cap < criteria.attendance:
        return False
    if criteria.location and criteria.location.lower() != (venue.location or "").strip().lower():
        return False
    if criteria.layout and criteria.layout not in lowered(venue.layouts):
        return False
    return _has_all(venue.facilities, criteria.facilities) and _has_all(venue.accessibility, criteria.accessibility)


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

def _has_all(offered, required) -> bool:
    return lowered(required) <= lowered(offered)

"""
US21 venue suitability: compare a venue with an event's recorded venue needs, requirement by
requirement, and say whether the venue is suitable, partially suitable or unsuitable. Kept free
of FastAPI and the database so it can be unit tested directly.

How serious an unmet need is ("severity"):
  block - capacity below the expected attendance, a layout the venue doesn't support, a missing
          accessibility feature (the Week 4 answers say accessibility and layout mismatches make a
          venue not suitable), and anything that stops the venue being used at that date and time
  warn  - a requested facility the venue doesn't have, and setup/turnaround running outside
          operating hours

Verdict: any unmet "block" -> unsuitable; otherwise any unmet "warn" -> partially suitable.
"""

from collections import defaultdict
from typing import Dict, List

from venue_availability import availability_issues, format_date, lowered

SUITABLE = "suitable"
PARTIALLY_SUITABLE = "partially_suitable"
UNSUITABLE = "unsuitable"

VERDICT_WORDS = {SUITABLE: "suitable", PARTIALLY_SUITABLE: "partially suitable", UNSUITABLE: "unsuitable"}


def _check(key, label, needed, offered, met, severity, reason) -> dict:
    return {"key": key, "label": label, "needed": needed, "offered": offered, "met": met,
            "severity": severity, "reason": None if met else reason}


def check_requirements(venue, needs, bookings=()) -> List[dict]:
    """Every recorded need compared with `venue`, met or not, in a fixed order:
    capacity, layout, each facility, each accessibility feature, then availability.

    `needs` has attendance, layout, facilities, accessibility and (optionally) date, start, end.
    `bookings` are the existing bookings at this venue.
    """
    checks = [_check(
        "capacity", "Capacity", f"{needs.attendance} people", f"{venue.cap} people", venue.cap >= needs.attendance, "block",
        f"Capacity {venue.cap} is below the expected attendance of {needs.attendance}.",
    )]

    if needs.layout:
        supported = [layout.capitalize() for layout in venue.layouts or []]
        checks.append(_check(
            "layout", "Layout", needs.layout.capitalize(), ", ".join(supported) or "None recorded",
            needs.layout in lowered(venue.layouts), "block", f"Does not support a {needs.layout} layout.",
        ))

    for facility in needs.facilities:
        has = facility.lower() in lowered(venue.facilities)
        checks.append(_check(
            "facility", f"Facility: {facility}", "Required", "Available" if has else "Not available", has, "warn",
            f"{facility} is not available at this venue.",
        ))

    for feature in needs.accessibility:
        has = feature.lower() in lowered(venue.accessibility)
        checks.append(_check(
            "accessibility", f"Accessibility: {feature}", "Required", "Provided" if has else "Not provided", has, "block",
            f"{feature} is not provided at this venue.",
        ))

    if needs.date is not None:
        when = f"{format_date(needs.date)}, {needs.start}–{needs.end}"
        issues = availability_issues(venue, needs.date, needs.start, needs.end, bookings)
        if issues:
            checks.extend(_check("availability", "Availability", when, "Not available" if issue.level == "block" else "Available with a caveat",
                                 False, issue.level, issue.text) for issue in issues)
        else:
            checks.append(_check("availability", "Availability", when, "Free, setup and turnaround included", True, "block", None))
    return checks


def verdict_for(checks: List[dict]) -> str:
    unmet = [c for c in checks if not c["met"]]
    if any(c["severity"] == "block" for c in unmet):
        return UNSUITABLE
    return PARTIALLY_SUITABLE if unmet else SUITABLE


def assess(venue, needs, bookings=()):
    """(verdict, checks) for one venue."""
    checks = check_requirements(venue, needs, bookings)
    return verdict_for(checks), checks


def assess_venues(venues, needs) -> list:
    """(venue, verdict, checks) for each active venue, or only the ones in needs.venue_ids when given."""
    held: Dict[int, list] = defaultdict(list)
    for booking in needs.bookings:
        held[booking.venue_id].append(booking)

    results = []
    for venue in venues:
        if not venue.is_active or (needs.venue_ids is not None and venue.id not in needs.venue_ids):
            continue
        verdict, checks = assess(venue, needs, held[venue.id])
        results.append((venue, verdict, checks))
    return results


def unmet_requirements(checks: List[dict]) -> List[dict]:
    """The requirements that were not met, each with its reason."""
    return [{"label": c["label"], "severity": c["severity"], "reason": c["reason"]} for c in checks if not c["met"]]


def override_record(verdict: str, checks: List[dict], acknowledged_by: str, acknowledged_at) -> dict:
    """What is kept against the event when the coordinator goes ahead with a venue that was not fully suitable."""
    return {"verdict": verdict, "acknowledged_by": acknowledged_by, "acknowledged_at": acknowledged_at,
            "unmet": unmet_requirements(checks)}

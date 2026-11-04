"""
US49 Reassess Venue Bookings After an Accepted Change (split from US35, CR-W7-3): the venue check.

Accepting a change request runs the shared reassessment (arrangement_reassessment.accepted, US50/US51/US45) in the
decision transaction. It checks the event's arrangements against the reviewed values (`effective_changes`, saved
with the decision; the event itself is not edited, US34). For each venue booking that holds a venue (CR-W7-3: an
event may book several) it asks booking_problems() whether the booking still fits (AC1). A booking that doesn't is
flagged "Requires Reassessment" in the shared flag table with these reasons (AC2), Venue Staff are told (AC3,
messaging.venue_booking_reassess) and the event can't be confirmed until the flag is resolved (AC4,
event_confirmation.outstanding reads every open flag, including US50's and US51's).

A booking no longer fits when:

  - it is for another date or time than the event as reviewed;
  - the change introduces a US21 blocking problem (venue_suitability.check_requirements) it did not have: the venue
    is too small for the new attendance (a booking for the whole event; a breakout booked for part of it keeps its
    own attendance), doesn't support the new layout or a newly needed accessibility feature, or at the new date and
    time is closed, outside its hours, unavailable or booked by another event.

Only problems that appear after the change and not before count, so something already accepted when the venue was
booked (a US21 override) does not flag it again. Nothing here saves or commits.
"""

from datetime import date, datetime, time
from types import SimpleNamespace
from typing import List, Optional

from sqlalchemy.orm import Session

import models
from venue_availability import format_date
from venue_bookings import held_periods
from venue_suitability import check_requirements


def _clock(value: Optional[time]) -> Optional[str]:
    return value.strftime("%H:%M") if value is not None else None


def _needs(day: date, start: str, end: str, attendance: int, layout: str, facts: dict) -> SimpleNamespace:
    return SimpleNamespace(date=day, start=start, end=end, attendance=attendance, layout=layout,
                           facilities=list(facts.get("facilities") or []), accessibility=list(facts.get("access") or []))


def _blocking(venue, needs, bookings) -> List[str]:
    return [c["reason"] for c in check_requirements(venue, needs, bookings) if not c["met"] and c["severity"] == "block"]


def booking_problems(db: Session, event: models.Event, booking: models.VenueBooking, before: dict, after: dict,
                     now: datetime) -> List[str]:
    """Why `booking` no longer fits the event once the reviewed values `after` apply, in the order a reader checks
    them; empty when it still fits. `before` and `after` are arrangement_reassessment.facts() shaped (date, start,
    end as date/time; pax; layout; facilities; access)."""
    problems: List[str] = []

    # The event as reviewed; a legacy event without a full date and time keeps the booking's own.
    reviewed = all(after.get(key) is not None for key in ("date", "start", "end"))
    new_day = after["date"] if reviewed else booking.date
    new_start = _clock(after["start"]) if reviewed else booking.start_time
    new_end = _clock(after["end"]) if reviewed else booking.end_time
    if (new_day, new_start, new_end) != (booking.date, booking.start_time, booking.end_time):
        problems.append(f"The booking holds {format_date(booking.date)}, {booking.start_time}–{booking.end_time}, "
                        f"but the event as reviewed is on {format_date(new_day)}, {new_start}–{new_end}.")

    # US41: a booking for the whole event follows the event's attendance and layout; one for part of it keeps its own.
    old_pax, new_pax = before.get("pax"), after.get("pax")
    whole_event = old_pax is not None and booking.attendance >= old_pax
    attendance = new_pax if whole_event and new_pax else booking.attendance
    old_layout, new_layout = (before.get("layout") or "").lower(), (after.get("layout") or "").lower()
    layout = new_layout if new_layout and booking.layout.lower() == old_layout else booking.layout.lower()

    venue = db.get(models.Venue, booking.venue_id)
    others = held_periods(db, [venue.id], exclude_event_id=event.id, now=now)
    had = _blocking(venue, _needs(booking.date, booking.start_time, booking.end_time, booking.attendance,
                                  booking.layout.lower(), before), others)
    has = _blocking(venue, _needs(new_day, new_start, new_end, attendance, layout, after), others)
    problems.extend(reason for reason in has if reason not in had)
    return problems

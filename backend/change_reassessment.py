"""
US49 Reassess Venue Bookings After an Accepted Change (split from US35, CR-W7-3)

A change request (US33) is free text, and accepting it (US34) records a decision without editing the event.
So that the bookings can be checked, the coordinator who accepts a change may say what it changes: the new
date, start and end time, expected attendance and layout (`accepted_values`). Those are saved on the change
request as the event will be after the change (`changes`); the event itself is still not edited (US34).

after_acceptance() then re-checks every venue booking of the event that holds a venue (AC1, CR-W7-3: an event
may book several venues). A booking is no longer valid when the change introduces a problem it did not have:

  - the event moves to another date or time than the booking holds;
  - the venue can't take the new attendance (a booking for the whole event; a breakout booked for part of it
    keeps its own attendance), or doesn't support the new layout;
  - at the new date and time the venue is closed, outside its hours, unavailable or booked by another event.

These are the US21 suitability checks (venue_suitability.check_requirements) for the booking before and after
the change: only "block" problems that appear after but not before count, so something already accepted when
the venue was booked (a US21 override) does not flag it again.

Each such booking is marked "Requires Reassessment" (AC2), in the same `reassessment` field US38 uses, with the
reason "accepted_change", and every Venue Staff member is told (AC3, messaging.venue_booking_reassess). Every
booking checked is listed on the change request with its outcome, so the coordinator sees each result.

A flag stays until it is resolved: Venue Staff mark the booking still valid with a note (resolve()), or the
booking stops holding the venue (cancelled, replaced, rejected, expired; US38's reconcile drops the flag).
While any booking is flagged the event can't be confirmed (AC4, event_confirmation.outstanding), and the same
goes for flags US50 and US51 raise in the same shape (see FLAG_FIELDS).

Each step raises ChangeRequestError / BookingRefused instead of saving. Nothing here commits.
"""

from datetime import date, datetime, time
from types import SimpleNamespace
from typing import List, Optional

from sqlalchemy.orm import Session

import hold_expiry
import models
from booking_request import BookingRefused
from equipment import CATALOGUE
from event_changes import ChangeRequestError
from login.models import User
from venue_availability import format_date
from venue_bookings import HOLDING, event_bookings, held_periods
from venue_suitability import check_requirements

REASON = "accepted_change"
# What an accepted change may say it changes, as the API names them (the US16 names).
CHANGE_FIELDS = ("date", "start", "end", "pax", "layout")
# The shared "Requires Reassessment" flag, for venue bookings (US49) and in the same shape for equipment lines
# (US50) and registration settings (US51): {reason, message, problems, change_request_id, flagged_at}.
FLAG_FIELDS = ("reason", "message", "problems", "change_request_id", "flagged_at")


def _clock(value: time) -> str:
    return value.strftime("%H:%M")


def before_values(event: models.Event) -> dict:
    """The event's saved values for the fields a change can name."""
    return {
        "date": event.date.isoformat() if event.date else None,
        "start": _clock(event.start_time) if event.start_time else None,
        "end": _clock(event.end_time) if event.end_time else None,
        "pax": event.expected_attendance,
        "layout": (event.layout or "").lower() or None,
    }


def accepted_values(event: models.Event, outcome: str, changes: Optional[dict]) -> Optional[dict]:
    """What the accepted change changes, as {field: new value} for the fields that actually change (empty when
    the coordinator named none). Refuses values on a rejected change, and a new time that ends before it starts.
    Never edits the event."""
    given = {key: value for key, value in (changes or {}).items() if value not in (None, "")}
    if outcome != "accepted":
        if given:
            raise ChangeRequestError(422, "Only an accepted change can say what it changes.")
        return None
    if "layout" in given:
        given["layout"] = given["layout"].strip().lower()
    if "date" in given and isinstance(given["date"], date):
        given["date"] = given["date"].isoformat()
    before = before_values(event)
    changed = {key: value for key, value in given.items() if before.get(key) != value}
    after = {**before, **changed}
    if after["start"] and after["end"] and after["end"] <= after["start"]:
        raise ChangeRequestError(422, "The changed end time must be after the start time.")
    return changed


def _needs(event: models.Event, day: date, start: str, end: str, attendance: int, layout: str) -> SimpleNamespace:
    return SimpleNamespace(date=day, start=start, end=end, attendance=attendance, layout=layout,
                           facilities=list(event.facilities or []), accessibility=list(event.accessibility or []))


def _blocking_reasons(venue, needs, bookings) -> List[str]:
    return [c["reason"] for c in check_requirements(venue, needs, bookings) if not c["met"] and c["severity"] == "block"]


def booking_problems(db: Session, event: models.Event, booking: models.VenueBooking, changes: dict, now: datetime) -> List[str]:
    """Why `booking` no longer fits the event once `changes` apply: what the change introduces, nothing older."""
    before = before_values(event)
    after = {**before, **changes}
    problems: List[str] = []

    new_day = date.fromisoformat(after["date"]) if after["date"] else booking.date
    new_start, new_end = after["start"] or booking.start_time, after["end"] or booking.end_time
    if (new_day, new_start, new_end) != (booking.date, booking.start_time, booking.end_time) and any(
            key in changes for key in ("date", "start", "end")):
        problems.append(f"The booking holds {format_date(booking.date)}, {booking.start_time}–{booking.end_time}, "
                        f"but the event moves to {format_date(new_day)}, {new_start}–{new_end}.")

    # US41: a booking for the whole event follows the event's attendance and layout; one for part of it keeps its own.
    whole_event = before["pax"] is not None and booking.attendance >= before["pax"]
    attendance = after["pax"] if whole_event and "pax" in changes else booking.attendance
    same_layout = booking.layout.lower() == (before["layout"] or "")
    layout = after["layout"] if same_layout and "layout" in changes else booking.layout.lower()

    venue = db.get(models.Venue, booking.venue_id)
    others = held_periods(db, [venue.id], exclude_event_id=event.id, now=now)
    was = _blocking_reasons(venue, _needs(event, booking.date, booking.start_time, booking.end_time, booking.attendance,
                                          booking.layout.lower()), others)
    now_fails = _blocking_reasons(venue, _needs(event, new_day, new_start, new_end, attendance, layout), others)
    problems.extend(reason for reason in now_fails if reason not in was)
    return problems


def build_flag(event: models.Event, request: models.EventChangeRequest, booking: models.VenueBooking,
               problems: List[str], now: datetime) -> dict:
    """What is saved on the booking: the shared "Requires Reassessment" flag (FLAG_FIELDS)."""
    return {
        "reason": REASON,
        "message": (f"An accepted change to {event.name} (change request #{request.id}) means the booking at "
                    f"{booking.venue_name} no longer fits: {' '.join(problems)} The booking is kept; it needs to be reassessed."),
        "problems": problems,
        "change_request_id": request.id,
        "flagged_at": now.isoformat(),
    }


def holding_bookings(db: Session, event: models.Event, now: datetime) -> List[models.VenueBooking]:
    return [b for b in event_bookings(db, event.id) if b.status in HOLDING and not hold_expiry.is_lapsed(b, now)]


def after_acceptance(db: Session, event: models.Event, request: models.EventChangeRequest, now: datetime) -> List[models.VenueBooking]:
    """US49-AC1/AC2: re-check each booking of the event against the accepted change, flag the ones that no longer
    fit and record every result on the change request. Returns the newly flagged bookings, so Venue Staff can be
    told (AC3). Does not commit. US50 (equipment) and US51 (registration) re-check theirs in the same step."""
    changes = request.accepted_changes or {}
    results = []
    flagged = []
    for booking in holding_bookings(db, event, now):
        problems = booking_problems(db, event, booking, changes, now)
        results.append({"booking_id": booking.id, "venue_name": booking.venue_name, "date": booking.date.isoformat(),
                        "start": booking.start_time, "end": booking.end_time,
                        "outcome": "requires_reassessment" if problems else "still_valid", "problems": problems})
        if problems:
            booking.reassessment = build_flag(event, request, booking, problems, now)
            flagged.append(booking)
    request.venue_reassessment = {"checked_at": now.isoformat(), "bookings": results}
    return flagged


def resolve(db: Session, booking: models.VenueBooking, note: str, resolved_by: User, now: datetime) -> None:
    """Venue Staff have reassessed a booking flagged by an accepted change and found it still valid: the flag is
    cleared and the outcome is recorded on the change request that raised it. Does not commit."""
    note = (note or "").strip()
    if booking.status not in HOLDING or hold_expiry.is_lapsed(booking, now):
        raise BookingRefused(f"This booking is {booking.status}, so there is nothing to reassess.")
    flag = booking.reassessment or {}
    if not flag:
        raise BookingRefused("This booking doesn't require reassessment.")
    if flag.get("reason") != REASON:
        raise BookingRefused("This booking's flag clears itself once the clash with the other booking is gone.")
    if not note:
        raise BookingRefused("Say why the booking still fits after the change.")
    booking.reassessment = None
    request = db.get(models.EventChangeRequest, flag.get("change_request_id"))
    if request is not None and request.venue_reassessment:
        record = dict(request.venue_reassessment)
        record["bookings"] = [
            {**row, "outcome": "still_valid", "resolution": {"note": note, "by": resolved_by.name, "at": now.isoformat()}}
            if row["booking_id"] == booking.id else row
            for row in record["bookings"]
        ]
        request.venue_reassessment = record  # a new value, so the JSON column is saved


EQUIPMENT_NAMES = {item_id: name for item_id, name, _ in CATALOGUE}


def change_flags(event: models.Event) -> List[str]:
    """US49-AC4: the flags other accepted-change stories raise on the event in the shared shape (FLAG_FIELDS),
    one line each. US50 flags an equipment reservation on its equipment line (`line["reassessment"]`); US51 adds
    its registration flag here once it has somewhere to keep it."""
    items = []
    for line in event.equipment or []:
        flag = line.get("reassessment")
        if flag:
            name = EQUIPMENT_NAMES.get(line.get("id"), line.get("id", "equipment"))
            items.append(f"{line.get('qty', '')} × {name} requires reassessment: "
                         f"{flag.get('message', 'an accepted change affects it.')}".lstrip())
    return items

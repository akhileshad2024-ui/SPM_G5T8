"""
US22 venue booking requests: the rules for accepting a request, and the values and notification it
produces. Kept free of FastAPI so it can be unit tested directly; saving the booking is
venue_bookings.py.

The request names only the event and the venue. Everything the rules need comes from the server: the
event's status and needs from the saved event, the setup and teardown from the venue, and the bookings
that already hold the venue from the saved bookings.
"""

from datetime import datetime
from types import SimpleNamespace

from venues.availability import event_window, format_date, occupied_window, overlaps, to_datetime
from venues.suitability import SUITABLE, VERDICT_WORDS, unmet_requirements

APPROVED = "approved"
# An event that already went through a booking (a replacement venue because the first became
# unavailable, or a new request after a rejection) has moved on from Approved.
REBOOKABLE = (APPROVED, "planning", "confirmed")
# US40: an event in its Operational Safety Check (US44) can still replace a booking whose venue became unavailable.
REPLACEABLE_FROM = REBOOKABLE + ("pending_safety_review", "safety_changes_requested", "safety_approved", "safety_rejected")


class BookingRefused(Exception):
    """The request breaks a booking rule; `message` says which, for the user."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def needs_from_event(event, attendance=None, layout=None) -> SimpleNamespace:
    """The event's saved date, times, attendance, layout and needs, in the form the rules use.

    US41: one booking may be for part of the event (e.g. a breakout session), so `attendance` and
    `layout`, when given, replace the event's own for this booking.
    Refuses an event that doesn't have them yet, since there is nothing to book a venue for.
    """
    attendance = attendance or event.expected_attendance
    layout = layout or event.layout
    if event.date is None or event.start_time is None or event.end_time is None or not attendance or not layout:
        raise BookingRefused("Complete the event's date, times, attendance and layout before requesting a venue.")
    if event.end_time <= event.start_time:
        raise BookingRefused("The event's end time must be after its start time.")
    return SimpleNamespace(
        date=event.date,
        start=event.start_time.strftime("%H:%M"),
        end=event.end_time.strftime("%H:%M"),
        attendance=attendance,
        layout=layout.lower(),
        facilities=list(event.facilities or []),
        accessibility=list(event.accessibility or []),
    )


def replacement_needs(original, event, attendance=None, layout=None) -> SimpleNamespace:
    """US40: what a replacement venue must provide: the original booking's timing, attendance and layout (unless
    the coordinator changes the last two), and the event's facilities and accessibility needs."""
    needs = needs_from_event(event, attendance or original.attendance, layout or original.layout)
    needs.date, needs.start, needs.end = original.date, original.start_time, original.end_time
    return needs


def require_replaceable(original, event_id: int, open_replacement=None) -> None:
    """US40: only a booking of this event that still holds a venue and is flagged as needing alternative
    arrangements (US39) can be replaced, and only one replacement may be open at a time.
    `open_replacement` is the pending or approved booking that already replaces it, if any."""
    if original is None:
        raise BookingRefused("The booking to replace was not found.")
    if original.event_id != event_id:
        raise BookingRefused("That booking belongs to another event.")
    if original.status not in ("pending", "approved"):
        raise BookingRefused(f"That booking is {original.status}, so it can't be replaced.")
    if not original.flag:
        raise BookingRefused("That booking isn't flagged as needing alternative arrangements.")
    if open_replacement is not None:
        raise BookingRefused(f"A replacement for this booking is already {open_replacement.status}: {open_replacement.venue_name}. "
                             "Cancel it to try another venue.")


def require_bookable_event(event_status: str, rebooking: bool, replacing: bool = False) -> None:
    """Only an approved event may ask for a venue (a rebooking may also come from a planning or confirmed one, and a
    replacement for a flagged booking also from any step of the safety check)."""
    status = event_status.strip().lower()
    if status not in (REPLACEABLE_FROM if replacing else REBOOKABLE if rebooking else (APPROVED,)):
        raise BookingRefused(f"A venue can only be requested for an approved event (this event is {status.replace('_', ' ')}).")


def require_active_venue(venue) -> None:
    if not venue.is_active:
        raise BookingRefused(f"{venue.name} has been deactivated and can't be requested.")


def require_no_pending_duplicate(venue, needs, held) -> None:
    """No second pending request for the same venue and time period (setup and turnaround included).

    `held` are the bookings that currently hold venues (schemas.BookedPeriod).
    """
    mine = occupied_window(event_window(needs.date, needs.start, needs.end), venue)
    for other in held:
        if other.venue_id == venue.id and other.status == "pending":
            if overlaps(mine, occupied_window(event_window(other.date, other.start, other.end), venue)):
                raise BookingRefused(
                    f"{venue.name} already has a pending request for that period ({other.event_name or 'another event'})."
                )


def require_new_venue_for_event(venue, event_id: int, held) -> None:
    """US41: an event can book several venues, but each only once. `held` are the bookings holding `venue`."""
    if any(b.venue_id == venue.id and b.event_id == str(event_id) for b in held):
        raise BookingRefused(f"This event already has a booking for {venue.name}. Change or cancel that booking instead.")


def require_acknowledgement(verdict: str, checks: list, acknowledged: bool) -> None:
    """A venue that is not fully suitable can still be requested, but only once the coordinator accepts the warning."""
    if verdict == SUITABLE or acknowledged:
        return
    reasons = " ".join(item["reason"] for item in unmet_requirements(checks))
    raise BookingRefused(f"This venue is {VERDICT_WORDS[verdict]} for the event. Acknowledge the warning to continue. {reasons}")


def stored_override(override):
    """The override as it is saved (JSON): the same record with the time as text."""
    return None if override is None else {**override, "acknowledged_at": override["acknowledged_at"].isoformat()}


def build_booking(venue, event, needs, verdict: str, requested_by: str, requested_at: datetime, override, purpose=None,
                  replaces_booking_id=None) -> dict:
    """The values of the pending booking: the venue is held from the start of setup to the end of teardown."""
    hold = occupied_window(event_window(needs.date, needs.start, needs.end), venue)
    return {
        "event_id": event.id,
        "event_name": event.name,
        "venue_id": venue.id,
        "venue_name": venue.name,
        "status": "pending",
        "date": needs.date,
        "start_time": needs.start,
        "end_time": needs.end,
        "setup_minutes": venue.setupMinutes or 0,
        "teardown_minutes": venue.turnaroundMinutes or 0,
        "hold_start": to_datetime(hold[0]),
        "hold_end": to_datetime(hold[1]),
        "attendance": needs.attendance,
        "layout": needs.layout,
        "purpose": purpose or None,
        "verdict": verdict,
        "requested_by": requested_by,
        "requested_at": requested_at,
        "override": stored_override(override),
        "replaces_booking_id": replaces_booking_id,
    }


def build_notification(venue, event, needs, override, replaces=None) -> dict:
    """What Venue Staff are told about the new request. `replaces` is the flagged booking it replaces (US40)."""
    body = (f"{venue.name} requested for {event.name} on {format_date(needs.date)}, "
            f"{needs.start}–{needs.end} ({needs.attendance} people, {needs.layout} layout).")
    if replaces is not None:
        body += f" It replaces the booking at {replaces.venue_name}, which needs alternative arrangements."
    if override:
        body += " The coordinator went ahead despite: " + " ".join(item["reason"] for item in override["unmet"])
    return {"to": "venue", "title": "Booking request pending", "body": body}

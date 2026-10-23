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

from venue_availability import event_window, format_date, occupied_window, overlaps, to_datetime
from venue_suitability import SUITABLE, VERDICT_WORDS, unmet_requirements

APPROVED = "approved"
# An event that already went through a booking (a replacement venue because the first became
# unavailable, or a new request after a rejection) has moved on from Approved.
REBOOKABLE = (APPROVED, "planning", "confirmed")


class BookingRefused(Exception):
    """The request breaks a booking rule; `message` says which, for the user."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def needs_from_event(event) -> SimpleNamespace:
    """The event's saved date, times, attendance, layout and needs, in the form the rules use.

    Refuses an event that doesn't have them yet, since there is nothing to book a venue for.
    """
    if event.date is None or event.start_time is None or event.end_time is None or not event.expected_attendance or not event.layout:
        raise BookingRefused("Complete the event's date, times, attendance and layout before requesting a venue.")
    if event.end_time <= event.start_time:
        raise BookingRefused("The event's end time must be after its start time.")
    return SimpleNamespace(
        date=event.date,
        start=event.start_time.strftime("%H:%M"),
        end=event.end_time.strftime("%H:%M"),
        attendance=event.expected_attendance,
        layout=event.layout.lower(),
        facilities=list(event.facilities or []),
        accessibility=list(event.accessibility or []),
    )


def require_bookable_event(event_status: str, rebooking: bool) -> None:
    """Only an approved event may ask for a venue (a rebooking may also come from a planning or confirmed one)."""
    status = event_status.strip().lower()
    if status not in (REBOOKABLE if rebooking else (APPROVED,)):
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


def require_acknowledgement(verdict: str, checks: list, acknowledged: bool) -> None:
    """A venue that is not fully suitable can still be requested, but only once the coordinator accepts the warning."""
    if verdict == SUITABLE or acknowledged:
        return
    reasons = " ".join(item["reason"] for item in unmet_requirements(checks))
    raise BookingRefused(f"This venue is {VERDICT_WORDS[verdict]} for the event. Acknowledge the warning to continue. {reasons}")


def stored_override(override):
    """The override as it is saved (JSON): the same record with the time as text."""
    return None if override is None else {**override, "acknowledged_at": override["acknowledged_at"].isoformat()}


def build_booking(venue, event, needs, verdict: str, requested_by: str, requested_at: datetime, override) -> dict:
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
        "verdict": verdict,
        "requested_by": requested_by,
        "requested_at": requested_at,
        "override": stored_override(override),
    }


def build_notification(venue, event, needs, override) -> dict:
    """What Venue Staff are told about the new request."""
    body = (f"{venue.name} requested for {event.name} on {format_date(needs.date)}, "
            f"{needs.start}–{needs.end} ({needs.attendance} people, {needs.layout} layout).")
    if override:
        body += " The coordinator went ahead despite: " + " ".join(item["reason"] for item in override["unmet"])
    return {"to": "venue", "title": "Booking request pending", "body": body}

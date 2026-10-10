"""
US22 venue booking requests: the rules for accepting a request and the record and notification
it produces. Kept free of FastAPI and the database so it can be unit tested directly.

Event bookings are not stored in the backend yet (the frontend keeps events in memory), so the
request carries the event's status and the bookings that currently hold venues, and the page
keeps the resulting booking against the event. The rules are enforced here regardless.
"""

from datetime import datetime

from venue_availability import event_window, format_date, occupied_window, overlaps, to_datetime
from venue_suitability import SUITABLE, VERDICT_WORDS, unmet_requirements

APPROVED = "approved"
# An event that already went through a booking (a replacement venue because the first became
# unavailable, or a new request after a rejection) has moved on from Approved.
REBOOKABLE = (APPROVED, "planning", "confirmed")


class BookingRefused(Exception):
    """The request breaks a booking rule; `message` says which, for the coordinator."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def require_bookable_event(event_status: str, rebooking: bool) -> None:
    """Only an approved event may ask for a venue (a rebooking may also come from a planning or confirmed one)."""
    status = event_status.strip().lower()
    if status not in (REBOOKABLE if rebooking else (APPROVED,)):
        raise BookingRefused(f"A venue can only be requested for an approved event (this event is {status.replace('_', ' ')}).")


def require_active_venue(venue) -> None:
    if not venue.is_active:
        raise BookingRefused(f"{venue.name} has been deactivated and can't be requested.")


def require_no_pending_duplicate(venue, request) -> None:
    """No second pending request for the same venue and time period (setup and turnaround included)."""
    mine = occupied_window(event_window(request.date, request.start, request.end), venue)
    for other in request.bookings:
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


def build_booking(venue, request, verdict: str, requested_by: str, requested_at: datetime, override) -> dict:
    """The pending booking: the venue is held from the start of setup to the end of teardown."""
    hold = occupied_window(event_window(request.date, request.start, request.end), venue)
    return {
        "event_id": request.event_id,
        "event_name": request.event_name,
        "venue_id": venue.id,
        "venue_name": venue.name,
        "date": request.date,
        "start": request.start,
        "end": request.end,
        "setup_minutes": venue.setupMinutes or 0,
        "teardown_minutes": venue.turnaroundMinutes or 0,
        "hold_start": to_datetime(hold[0]),
        "hold_end": to_datetime(hold[1]),
        "attendance": request.attendance,
        "layout": request.layout,
        "status": "pending",
        "verdict": verdict,
        "requested_by": requested_by,
        "requested_at": requested_at,
        "override": override,
    }


def build_notification(venue, request, override) -> dict:
    """What Venue Staff are told about the new request."""
    body = (f"{venue.name} requested for {request.event_name} on {format_date(request.date)}, "
            f"{request.start}–{request.end} ({request.attendance} people, {request.layout} layout).")
    if override:
        body += " The coordinator went ahead despite: " + " ".join(item["reason"] for item in override["unmet"])
    return {"to": "venue", "title": "Booking request pending", "body": body}

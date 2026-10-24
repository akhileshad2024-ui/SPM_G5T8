"""
Saved venue bookings (US22 request, and Venue Staff's approve or reject): reading the bookings that
hold venues, saving a new request, and deciding one. Works on a database session; the rules
themselves are in booking_request.py and venue_availability.py.

US41: an event may book several venues at once, each at a different venue with its own attendance,
layout and purpose; one can be changed or cancelled without touching the others. The event keeps a
summary of them for the rest of the app (events.venue_id with events.booking_state, see summarise()):
its main venue is the first approved booking, else the first pending one.
"""

from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import List, Optional

import hold_expiry
import models
import schemas
import venue_reassessment
from booking_request import BookingRefused
from venue_availability import format_date

# A booking in these states holds its venue: nobody else can be given the slot.
HOLDING = ("pending", "approved")
# US23-AC5: how long after Venue Staff decide a request the coordinator is still shown the outcome.
DECISION_NOTICE_WINDOW = timedelta(days=7)
from venue_conflicts import HOLDING, aware as _utc, blocking, conflicts_for, holds_venue, slot_of


def held_periods(db, venue_ids: Optional[List[int]] = None, exclude_event_id: Optional[int] = None,
                 now: Optional[datetime] = None) -> List[schemas.BookedPeriod]:
    """The bookings that currently hold venues, as the availability rules read them.

    US42: a tentative hold whose expiry has passed no longer holds its venue, even before "expired"
    has been saved on it.
    """
    now = now or datetime.now(timezone.utc)
    query = db.query(models.VenueBooking).filter(models.VenueBooking.status.in_(HOLDING))
    if venue_ids is not None:
        query = query.filter(models.VenueBooking.venue_id.in_(venue_ids))
    if exclude_event_id is not None:
        query = query.filter(models.VenueBooking.event_id != exclude_event_id)
    return [
        schemas.BookedPeriod(
            venue_id=row.venue_id, date=row.date, start=row.start_time, end=row.end_time,
            status=row.status, event_id=str(row.event_id), event_name=row.event_name,
        )
        for row in query.all()
        if not hold_expiry.is_lapsed(row, now)
    ]


def to_record(row: models.VenueBooking, staff: bool = False, now: Optional[datetime] = None) -> dict:
    """A saved booking as the API shows it (schemas.VenueBooking).

    `staff` (Venue Staff) also gets the bookings a "Requires Reassessment" flag clashes with. A coordinator
    does not: those are other coordinators' events (US02).
    """
    now = now or datetime.now(timezone.utc)
    return {
        "id": row.id, "event_id": row.event_id, "event_name": row.event_name,
        "venue_id": row.venue_id, "venue_name": row.venue_name,
        "date": row.date, "start": row.start_time, "end": row.end_time,
        "setup_minutes": row.setup_minutes, "teardown_minutes": row.teardown_minutes,
        "hold_start": row.hold_start, "hold_end": row.hold_end,
        "attendance": row.attendance, "layout": row.layout, "purpose": row.purpose,
        "status": row.status, "verdict": row.verdict,
        "requested_by": row.requested_by, "requested_at": _utc(row.requested_at),
        "override": row.override,
        "decided_by": row.decided_by, "decided_at": _utc(row.decided_at), "decision_reason": row.decision_reason,
        "flag": row.flag,
        "reassessment": _reassessment(row, staff),
        # US42: when the tentative hold lapses, who set that, and what the coordinator should be told.
        "hold_expires_at": _utc(row.hold_expires_at), "hold_expiry_set_by": row.hold_expiry_set_by,
        "hold_notice": hold_expiry.hold_notice(row, now),
        # US23-AC5: the outcome the requesting coordinator should be told about.
        "decision_notice": decision_notice(row, now),
    }


def decision_notice(row, now: datetime) -> Optional[str]:
    """US23-AC5: "approved" or "rejected" while the decision is recent enough to tell the coordinator about.
    Notifications aren't stored on the server yet (US36), so the page shows these when it loads."""
    decided = _utc(getattr(row, "decided_at", None))
    if row.status not in ("approved", "rejected") or decided is None:
        return None
    return row.status if now - decided <= DECISION_NOTICE_WINDOW else None
def _reassessment(row: models.VenueBooking, staff: bool) -> Optional[dict]:
    if not row.reassessment:
        return None
    return row.reassessment if staff else {key: value for key, value in row.reassessment.items() if key != "clashes_with"}


def staff_records(db, rows: List[models.VenueBooking], now: datetime) -> List[dict]:
    """The bookings as Venue Staff see them: each booking that holds a venue comes with everything in the way
    of it right now (US46 a confirmed booking, US47 another pending request, US48 an unavailable period)."""
    venue_ids = {row.venue_id for row in rows if row.status in HOLDING}
    holding_at = defaultdict(list)
    for other in db.query(models.VenueBooking).filter(
        models.VenueBooking.venue_id.in_(venue_ids), models.VenueBooking.status.in_(HOLDING)
    ).all():
        holding_at[other.venue_id].append(slot_of(other))
    venues = {v.id: v for v in db.query(models.Venue).filter(models.Venue.id.in_(venue_ids)).all()}

    records = []
    for row in rows:
        record = to_record(row, staff=True, now=now)
        holding = row.status in HOLDING and holds_venue(row.status, _utc(row.hold_expires_at), now)
        # A booking that holds nothing (rejected, cancelled, or a hold that has expired) has nothing in its way.
        record["conflicts"] = conflicts_for(slot_of(row), venues[row.venue_id], holding_at[row.venue_id], now) if holding else []
        records.append(record)
    return records


def event_bookings(db, event_id: int) -> List[models.VenueBooking]:
    """Every booking of the event, oldest first."""
    return db.query(models.VenueBooking).filter(models.VenueBooking.event_id == event_id).order_by(models.VenueBooking.id).all()


def summarise(db, event: models.Event) -> None:
    """Keep the event's venue and booking state in step with its bookings (US41).

    venue: the first approved booking, else the first pending one, else none.
    booking_state: approved when every booking holding a venue is approved, pending while any is
    pending; with none holding a venue, rejected if Venue Staff rejected every one, else none (the
    coordinator cancelled them).
    """
    db.flush()
    rows = event_bookings(db, event.id)
    holding = [r for r in rows if r.status in HOLDING]
    if holding:
        main = next((r for r in holding if r.status == "approved"), holding[0])
        event.venue_id = main.venue_id
        event.booking_state = "approved" if all(r.status == "approved" for r in holding) else "pending"
    else:
        event.venue_id = None
        event.booking_state = "rejected" if rows and all(r.status == "rejected" for r in rows) else None


def save_request(db, event: models.Event, values: dict) -> models.VenueBooking:
    """Save the pending booking. The event's other bookings are kept (US41).

    US42: the new tentative hold gets its default expiry; Venue Staff can change it later.
    """
    row = models.VenueBooking(**values)
    if row.hold_expires_at is None:
        row.hold_expires_at = hold_expiry.default_expiry(row, row.requested_at)
    db.add(row)
    summarise(db, event)
    db.commit()
    db.refresh(row)
    return row


def require_holding(booking: models.VenueBooking) -> None:
    if booking.status not in HOLDING:
        raise BookingRefused(f"This booking is {booking.status}, so it can't be changed or cancelled.")


def change(db, booking: models.VenueBooking, values: dict) -> None:
    """US41: change one booking's attendance, layout, purpose or override. Does not commit.

    An approved booking goes back to pending, since Venue Staff approved different needs.
    """
    require_holding(booking)
    for field, value in values.items():
        setattr(booking, field, value)
    if booking.status == "approved":
        booking.status = "pending"
        booking.decided_by = booking.decided_at = booking.decision_reason = None
    summarise(db, db.get(models.Event, booking.event_id))


def cancel(db, bookings: List[models.VenueBooking]) -> None:
    """US41: cancel these bookings of one event; its other bookings are kept. Does not commit."""
    for booking in bookings:
        require_holding(booking)
        booking.status = "cancelled"
    if bookings:
        summarise(db, db.get(models.Event, bookings[0].event_id))
        # What the cancelled bookings clashed with no longer has to be reassessed (US38).
        venue_reassessment.reconcile(db, {booking.venue_id for booking in bookings}, datetime.now(timezone.utc))


def require_unobstructed(db, booking: models.VenueBooking, venue: models.Venue, now: datetime) -> None:
    """US46 and US48: a booking can only be confirmed while nothing confirmed is in its way.

    The check is made again here, from what is saved at this moment, not from what was true when the booking
    was requested. In the way: a confirmed booking at the venue whose occupied window overlaps this one, with
    the venue's current setup and turnaround around both (US46), and one of the venue's unavailable periods,
    which counts the same as a confirmed booking (US48). The refusal says what is in the way. Another pending
    request is not in the way: Venue Staff decide between those by hand (US47).
    """
    confirmed = [slot_of(row) for row in db.query(models.VenueBooking).filter(
        models.VenueBooking.venue_id == venue.id, models.VenueBooking.status == "approved").all()]
    in_the_way = blocking(conflicts_for(slot_of(booking), venue, confirmed, now))
    if in_the_way:
        raise BookingRefused("Can't approve: " + " ".join(conflict["message"] for conflict in in_the_way))


def decide(db, booking: models.VenueBooking, outcome: str, reason: str, decided_by: str, now) -> None:
    """Venue Staff approve or reject a pending request. Does not commit: the caller saves it.

    Rejecting needs a reason. Approving is refused if the venue was deactivated since, or if something
    confirmed is in the way (require_unobstructed). Approving takes a lock on the venue, so two Venue Staff
    confirming overlapping bookings at the same moment are checked one after the other, not both let through.
    """
    # US42-AC4: a hold whose expiry has passed is expired, never a confirmed booking (even if not saved yet).
    if hold_expiry.is_lapsed(booking, now):
        booking.status = "expired"
    # US23-AC7: an expired tentative hold can't be approved; there is nothing left to reject either.
    if booking.status == "expired":
        expires = hold_expiry.as_utc(booking.hold_expires_at)
        when = f" on {expires.astimezone(schemas.CAMPUS_TZ):%d %b %Y, %H:%M}" if expires else ""
        if outcome == "rejected":
            raise BookingRefused(f"This tentative hold expired{when}, so the venue has already been released.")
        raise BookingRefused(f"This tentative hold expired{when} and can't be approved.")
    if booking.status != "pending":
        raise BookingRefused(f"This request is no longer pending (it is {booking.status}).")
    reason = (reason or "").strip()
    event = db.get(models.Event, booking.event_id)

    if outcome == "rejected":
        if not reason:
            raise BookingRefused("Give a reason for rejecting the request.")
        booking.status = "rejected"
    else:
        venue = db.get(models.Venue, booking.venue_id, with_for_update=True)
        if not venue.is_active:
            raise BookingRefused(f"{venue.name} has been deactivated and can't be approved.")
        require_unobstructed(db, booking, venue, now)
        booking.status = "approved"  # the event's other bookings are kept (US41)

    booking.decided_by, booking.decided_at, booking.decision_reason = decided_by, now, reason or None
    summarise(db, event)
    # A rejected booking no longer clashes with anything, and an approved one's neighbours see it as confirmed (US38).
    venue_reassessment.reconcile(db, {booking.venue_id}, now)

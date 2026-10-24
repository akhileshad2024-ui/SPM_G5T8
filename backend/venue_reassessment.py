"""
US38 Flag Bookings Affected by Venue Time Changes (Week 7 change #1): when a venue's setup or turnaround
time changes, every pending and confirmed booking at the venue that has not happened yet is re-checked.
Bookings that now overlap another booking are marked "Requires Reassessment", keeping the booking they
clash with, so Venue Staff can see them and their coordinators can be told.

Nothing is cancelled or removed. Only a booking's hold (which follows the venue's configured times) and its
reassessment flag change. A flag stays until no clash is left: that is re-checked whenever a booking at the
venue is decided or cancelled (refresh() without the venue's previous times, which flags nothing new).

The overlap rule itself is in venue_conflicts.py. This module reads and saves the bookings.
"""

from datetime import datetime
from types import SimpleNamespace
from typing import Iterable, List, Optional, Set, Tuple

import models
import schemas
import venue_unavailability
from venue_availability import event_window, occupied_window, overlaps, to_datetime
from venue_conflicts import HOLDING, aware, as_json, booking_conflicts, holds_venue, slot_of, window_of

REASON = "venue_time_changed"


def campus_now(now: datetime) -> datetime:
    """The current campus (Singapore) wall-clock time without a time zone: the clock bookings are held on."""
    return now.astimezone(schemas.CAMPUS_TZ).replace(tzinfo=None)


def has_happened(row: models.VenueBooking, local_now: datetime) -> bool:
    """Whether the booking's event is over (a booking still running counts as not yet over)."""
    return to_datetime(event_window(row.date, row.start_time, row.end_time)[1]) <= local_now


def is_flagged(row: models.VenueBooking) -> bool:
    return bool(row.reassessment) and row.reassessment.get("reason") == REASON


def _clash_ids(row: models.VenueBooking) -> Set[int]:
    return {c["booking_id"] for c in row.reassessment["clashes_with"]} if is_flagged(row) else set()


def build_flag(venue, clashes_with: List[dict], flagged_at: str) -> dict:
    """What is saved on the booking: why it needs reassessing and the bookings it clashes with."""
    setup, turnaround = venue.setupMinutes or 0, venue.turnaroundMinutes or 0
    return {
        "reason": REASON,
        "message": (f"{venue.name}'s setup and turnaround time changed (now {setup} min setup and {turnaround} min turnaround) "
                    "and this booking now overlaps another booking at the venue. The booking is kept; it needs to be reassessed."),
        "setup_minutes": setup,
        "turnaround_minutes": turnaround,
        "clashes_with": [as_json(c) for c in clashes_with],
        "flagged_at": flagged_at,
    }


def bring_hold_into_line(row: models.VenueBooking, venue) -> None:
    """A booking is held from the start of the venue's setup to the end of its turnaround: follow the venue's current times."""
    hold = occupied_window(event_window(row.date, row.start_time, row.end_time), venue)
    row.setup_minutes, row.teardown_minutes = venue.setupMinutes or 0, venue.turnaroundMinutes or 0
    row.hold_start, row.hold_end = to_datetime(hold[0]), to_datetime(hold[1])


def refresh(db, venue, now: datetime, was: Optional[Tuple[int, int]] = None) -> List[models.VenueBooking]:
    """Re-check the bookings at `venue` and keep their "Requires Reassessment" flags right. Does not commit.

    `was` is the venue's previous (setup, turnaround) minutes when they have just changed. Then every future
    booking's hold is brought into line with the new times, and bookings that overlap now but did not under
    the old times are flagged. Without it (a booking at the venue was decided or cancelled) nothing new is
    flagged: flags are only kept, updated or cleared. A booking that is over, or no longer holds the venue,
    loses its flag.

    Returns the bookings that have been newly flagged, so their coordinators can be told.
    """
    db.flush()  # sessions here don't flush by themselves
    local_now = campus_now(now)
    flagged_before = db.query(models.VenueBooking).filter(
        models.VenueBooking.venue_id == venue.id, models.VenueBooking.reassessment.is_not(None)).all()
    holding = db.query(models.VenueBooking).filter(
        models.VenueBooking.venue_id == venue.id, models.VenueBooking.status.in_(HOLDING)).all()
    live = [r for r in holding if holds_venue(r.status, aware(r.hold_expires_at), now) and not has_happened(r, local_now)]

    if was is not None:
        for row in live:
            bring_hold_into_line(row, venue)
    old_times = SimpleNamespace(setupMinutes=was[0], turnaroundMinutes=was[1]) if was is not None else None

    slots = {row.id: slot_of(row) for row in live}
    newly_flagged = []
    for row in live:
        overlapping = {c["booking_id"]: c for c in booking_conflicts(slots[row.id], venue, slots.values(), now)}
        caused_by_change = set()
        if old_times is not None:
            before = window_of(slots[row.id], old_times)
            caused_by_change = {i for i in overlapping if not overlaps(before, window_of(slots[i], old_times))}
        partners = (_clash_ids(row) & set(overlapping)) | caused_by_change
        if partners:
            flagged_at = now.isoformat() if caused_by_change else row.reassessment["flagged_at"]
            row.reassessment = build_flag(venue, [overlapping[i] for i in sorted(partners)], flagged_at)
            if caused_by_change:
                newly_flagged.append(row)
        elif is_flagged(row):
            row.reassessment = None  # nothing clashes any more

    live_ids = set(slots)
    for row in flagged_before:
        if row.id not in live_ids:
            row.reassessment = None  # cancelled, rejected, expired or over
    return newly_flagged


def after_venue_change(db, venue, changes: dict, now: datetime) -> Tuple[List[models.VenueBooking], List[models.VenueBooking]]:
    """What a venue edit does to the bookings held at it: (flagged as venue unavailable, newly "Requires Reassessment").

    `changes` is what the edit changed, {field: {"old", "new"}}. A new setup or turnaround time re-checks the
    bookings and moves their holds (US38). The bookings caught by an unavailable period are worked out again
    when the periods changed (US39) and also when the times did, because a longer setup or turnaround can
    reach into a period. Does not commit.
    """
    times_changed = "setupMinutes" in changes or "turnaroundMinutes" in changes
    reassessed = []
    if times_changed:
        was = tuple((changes[field]["old"] if field in changes else getattr(venue, field)) or 0
                    for field in ("setupMinutes", "turnaroundMinutes"))
        reassessed = refresh(db, venue, now, was=was)
    flagged = venue_unavailability.flag_affected_bookings(db, venue, now) if "unavailability" in changes or times_changed else []
    return flagged, reassessed


def reconcile(db, venue_ids: Iterable[int], now: datetime) -> None:
    """After bookings at these venues were decided or cancelled: drop the flags whose clash is gone. Does not commit."""
    for venue_id in set(venue_ids):
        venue = db.get(models.Venue, venue_id)
        if venue is not None:
            refresh(db, venue, now)

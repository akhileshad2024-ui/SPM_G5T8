import enum
from sqlalchemy import Column, Integer, String, Boolean, JSON, DateTime, Date, Time, Text, Enum, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
from database import Base

class Venue(Base):
    __tablename__ = "venues"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    location = Column(String, nullable=False)
    
    # Updated to match frontend type names
    cap = Column(Integer, nullable=False)
    layouts = Column(JSON, default=[])
    facilities = Column(JSON, default=[])
    operatingHours = Column(String, nullable=True)
    operatingDays = Column(JSON, default=[])
    accessibility = Column(JSON, default=[])

    # Week 7 change #1: minutes the room is occupied before/after every event.
    setupMinutes = Column("setup_minutes", Integer, nullable=False, default=0, server_default="0")
    turnaroundMinutes = Column("turnaround_minutes", Integer, nullable=False, default=0, server_default="0")
    # Week 7 change #2: [{start, end, reason, note}] periods the venue can't be used.
    # Replaces the old "unavailableDates" column (see schema_changes.sql).
    unavailability = Column(JSON, default=[])
    
    is_active = Column(Boolean, default=True)
    last_updated_by = Column(String, nullable=False) 
    last_updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class VenueChange(Base):
    """Audit trail for US17: one row per create/edit/deactivate/reactivate of a venue."""
    __tablename__ = "venue_changes"

    id = Column(Integer, primary_key=True, index=True)
    venue_id = Column(Integer, ForeignKey("venues.id"), nullable=False, index=True)
    action = Column(String, nullable=False)  # create | edit | deactivate | reactivate
    changed_by = Column(String, nullable=False)
    changed_at = Column(DateTime(timezone=True), nullable=False)
    # {field: {"old": ..., "new": ...}} — only the fields that actually changed
    changes = Column(JSON, nullable=False, default={})


class EventStatus(str, enum.Enum):
    """Must stay in sync with the `EventStatus` type in lib/types.ts."""
    draft = "draft"
    submitted = "submitted"
    under_review = "under_review"
    pending_clarification = "pending_clarification"
    approved = "approved"
    confirmed = "confirmed"
    rejected = "rejected"
    cancelled = "cancelled"


class Event(Base):
    """An event request and its progress (US03/04 create it, later stories move it along).

    Mirrors `EventRecord` in lib/types.ts. Values the frontend derives (day of
    week, "submitted 2 days ago", registered count) are not stored.
    """
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, index=True)
    status = Column(Enum(EventStatus, name="event_status", native_enum=False, create_constraint=True, length=30),
                    nullable=False, default=EventStatus.draft, index=True)

    # Who: the organiser owns the request; a coordinator is assigned during review (US11).
    organiser_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    coordinator_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)

    # What (US03 request details). Nullable where a draft may still be incomplete.
    name = Column(String, nullable=False)
    purpose = Column(Text, nullable=True)
    event_type = Column(String, nullable=True)
    expected_attendance = Column(Integer, nullable=True)
    date = Column(Date, nullable=True)
    start_time = Column(Time, nullable=True)
    end_time = Column(Time, nullable=True)

    # Venue requirements as the organiser asked for them, before a venue is booked.
    venue_location = Column(String, nullable=True)
    venue_capacity = Column(Integer, nullable=True)
    layout = Column(String, nullable=True)
    facilities = Column(JSON, nullable=False, default=list)
    accessibility = Column(JSON, nullable=False, default=list)
    # [{id, qty, technicalRequirements}]
    equipment = Column(JSON, nullable=False, default=list)

    # Registration settings.
    registration_required = Column(Boolean, nullable=False, default=False)
    registration_cap = Column(Integer, nullable=True)
    registration_close = Column(Date, nullable=True)

    # Booking / equipment progress (later stories).
    venue_id = Column(Integer, ForeignKey("venues.id"), nullable=True, index=True)
    booking_state = Column(String, nullable=True)    # pending | approved | rejected
    equipment_state = Column(String, nullable=True)  # requested | reserved

    # Optional JSON values below use none_as_null, so None is stored as SQL NULL
    # (not the JSON value null) and `IS NULL` queries find them.

    # Review outcomes (US08 / US10): the latest of each, as the frontend shows them.
    clarification = Column(JSON(none_as_null=True), nullable=True)
    decision = Column(JSON(none_as_null=True), nullable=True)

    # Unfinished wizard values, so an organiser can continue a draft.
    draft_form = Column(JSON(none_as_null=True), nullable=True)

    submitted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class EventChangeRequest(Base):
    """US33 proposals and US34 decisions, separate from current event details."""
    __tablename__ = "event_change_requests"

    id = Column(Integer, primary_key=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=False)
    requested_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    requested_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    proposed_changes = Column(Text, nullable=False)
    status = Column(Text, nullable=False, default="pending", server_default="pending")
    decision = Column(JSON(none_as_null=True), nullable=True)


class EventDetailChange(Base):
    """US16: important detail changes, not status transitions or venue edits."""
    __tablename__ = "event_detail_changes"

    id = Column(Integer, primary_key=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=False)
    changed_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    changed_at = Column(DateTime(timezone=True), nullable=False)
    changes = Column(JSON, nullable=False)
    affects_arrangements = Column(Boolean, nullable=False)


class VenueBooking(Base):
    """A venue booking request for an event (US22): saved when the coordinator asks for the venue,
    so it survives a reload, Venue Staff can see it, and other searches see the venue as held.

    status: pending (the venue is held) | approved | rejected | cancelled (by the coordinator, US41)
    | expired (US42: the tentative hold lapsed before Venue Staff approved it; the venue is free again).
    An event may have several bookings at once, each at a different venue (US41).
    The venue is held from hold_start (start of setup) to hold_end (end of teardown), in the same
    local wall-clock time as the event; those two are stored without a time zone on purpose.
    """
    __tablename__ = "venue_bookings"

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=False, index=True)
    event_name = Column(String, nullable=False)
    venue_id = Column(Integer, ForeignKey("venues.id"), nullable=False, index=True)
    venue_name = Column(String, nullable=False)
    status = Column(String, nullable=False, default="pending")
    date = Column(Date, nullable=False)
    start_time = Column(String, nullable=False)  # "HH:MM"
    end_time = Column(String, nullable=False)
    setup_minutes = Column(Integer, nullable=False)
    teardown_minutes = Column(Integer, nullable=False)
    hold_start = Column(DateTime, nullable=False)
    hold_end = Column(DateTime, nullable=False)
    # US41: an event can book several venues, each with its own attendance, layout and purpose.
    attendance = Column(Integer, nullable=False)
    layout = Column(String, nullable=False)
    purpose = Column(String, nullable=True)  # e.g. "Main programme", "Breakout session"
    verdict = Column(String, nullable=False)  # suitable | partially_suitable | unsuitable, when it was requested
    requested_by = Column(String, nullable=False)
    requested_at = Column(DateTime(timezone=True), nullable=False)
    # US21: set when the coordinator went ahead with a venue that was not fully suitable.
    override = Column(JSON(none_as_null=True), nullable=True)
    decided_by = Column(String, nullable=True)
    decided_at = Column(DateTime(timezone=True), nullable=True)
    decision_reason = Column(Text, nullable=True)
    # US39: set while the venue is unavailable during this booking ({kind, reason, note, period_start,
    # period_end, message, flagged_at}). The booking is kept; the coordinator must arrange an alternative.
    flag = Column(JSON(none_as_null=True), nullable=True)
# US38: set when a change to the venue's setup or turnaround time makes this booking overlap another
    # one ({reason, message, setup_minutes, turnaround_minutes, clashes_with, flagged_at}). The booking is
    # kept; it is "Requires Reassessment" until the clash is gone.
    reassessment = Column(JSON(none_as_null=True), nullable=True)
    # US42: when this tentative hold lapses if not approved (UTC), and the Venue Staff member who last set it
    # (None while it is the default set on request). See hold_expiry.py. US48 reads it: once it has passed,
    # the hold no longer blocks the venue and is left out of every conflict check.
    hold_expires_at = Column(DateTime(timezone=True), nullable=True)
    hold_expiry_set_by = Column(String, nullable=True)


class EventStatusChange(Base):
    """US13: one row per status change of an event, oldest first, written only by
    event_status.change_status() so every story records changes the same way."""
    __tablename__ = "event_status_changes"

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=False, index=True)
    # None for the first entry, when the event is created.
    from_status = Column(Enum(EventStatus, name="event_status_from", native_enum=False, create_constraint=True, length=30),
                         nullable=True)
    to_status = Column(Enum(EventStatus, name="event_status_to", native_enum=False, create_constraint=True, length=30),
                       nullable=False)
    changed_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    changed_at = Column(DateTime(timezone=True), nullable=False)
    # Why, where the story asks for one (e.g. a rejection or cancellation reason).
    reason = Column(Text, nullable=True)

class RegistrationStatus(str, enum.Enum):
    """Must stay in sync with `RegistrationStatus` in lib/types.ts (which also has the
    display-only "cancelled", shown when the event itself is cancelled)."""
    registered = "registered"
    waitlisted = "waitlisted"
    withdrawn = "withdrawn"


class Registration(Base):
    """US29-US32: an attendee's registration for an event, written only by registrations.py.

    One row per attendee per event: registering again after withdrawing reuses the row
    (and joins the back of the queue), so an attendee can never hold two places.
    """
    __tablename__ = "registrations"
    __table_args__ = (UniqueConstraint("event_id", "attendee_id", name="uq_registration_event_attendee"),)

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=False, index=True)
    attendee_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    status = Column(Enum(RegistrationStatus, name="registration_status", native_enum=False, create_constraint=True,
                         length=20), nullable=False)
    # When the attendee last joined (registered or waitlisted): the waitlist is served in this order.
    registered_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)

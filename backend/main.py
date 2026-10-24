from fastapi import FastAPI, Depends, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.encoders import jsonable_encoder
from sqlalchemy import or_
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime, timezone
from database import engine, Base, get_db
from login import auth
from login.models import Role, User
from login.security import enforce_https, get_current_user, require_roles
import equipment, messaging, mail_worker
import event_drafts, event_submission, event_changes, event_updates
import booking_request, event_review, hold_expiry, models, registrations, schemas, venue_bookings, venue_search, venue_suitability, venue_unavailability, venue_reassessment
from venue_audit import apply_update, change_action, creation_changes, record_change
from event_access import involved_events, is_involved
from event_fields import for_role
from event_status import change_status, record_initial_status

Base.metadata.create_all(bind=engine)

app = FastAPI(title="ConnectSphere API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# US01 AC5: in production, credentials are only accepted over HTTPS.
app.middleware("http")(enforce_https)

app.include_router(auth.router)
app.include_router(equipment.router)
app.include_router(messaging.router)
with Session(engine) as equipment_db:
    equipment.seed_catalogue(equipment_db)

# RBAC: who may manage the venue catalogue (US17).
VENUE_MANAGERS = (Role.venue,)
# Who may also see deactivated venues: Venue Staff (to reactivate them) and Coordinators
# (whose events may still point at a venue that has since been deactivated).
INACTIVE_VENUE_VIEWERS = (Role.venue, Role.coordinator)
# Who may search and filter venues (US20).
VENUE_SEARCHERS = (Role.coordinator,)
# Who may check a venue's suitability for an event (US21) and request a booking (US22).
BOOKING_REQUESTERS = (Role.coordinator,)
# Who may approve or reject a booking request (Venue Staff).
BOOKING_DECIDERS = (Role.venue,)
# Who may create event requests (US03/US04).
EVENT_REQUESTERS = (Role.organiser,)
# Who may register for events (US29-US31).
REGISTRANTS = (Role.attendee,)
# Who may review event requests (US07, US08, US10): the coordinator each event is assigned to.
EVENT_REVIEWERS = (Role.coordinator,)
# Who may see the unassigned queue and assign coordinators (US43, US11): the Event Coordinator Lead.
COORDINATOR_ASSIGNERS = (Role.lead,)

EVENT_DRAFT_WRITERS = (Role.organiser,)

# Fulfills US05: save incomplete information as a persisted Draft. The
# organiser_id comes only from the signed-in session, never from request JSON.
@app.post("/event-requests/drafts", response_model=schemas.EventDraftResponse, status_code=201)
def save_event_draft(
    request: schemas.EventDraftSave,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*EVENT_DRAFT_WRITERS)),
):
    prepared = event_drafts.prepare_draft(request.event_information)
    saved = models.Event(
        status=prepared["status"],
        organiser_id=user.id,
        # ``name`` is NOT NULL in the pre-existing events table. An empty
        # technical value lets an incomplete draft be stored; draft_form keeps
        # exactly what the organiser explicitly saved.
        name=prepared["draft_form"].get("name", ""),
        purpose=prepared["draft_form"].get("purpose"),
        facilities=[],
        accessibility=[],
        equipment=[],
        registration_required=False,
        draft_form=prepared["draft_form"],
    )
    if request.event_details is not None:
        apply_event_request(saved, request.event_details.model_copy(update={"submit": False}), datetime.now(timezone.utc))
        saved.draft_form = prepared["draft_form"]
    db.add(saved)
    db.flush()
    record_initial_status(db, saved, user, datetime.now(timezone.utc))
    db.commit()
    db.refresh(saved)
    return saved

# US04: the organiser sees persisted Draft and Submitted requests after reload.
@app.get("/event-requests", response_model=List[schemas.EventRequestResponse])
def list_event_requests(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*EVENT_DRAFT_WRITERS)),
):
    return db.query(models.Event).filter(models.Event.organiser_id == user.id).all()


@app.post("/event-requests/submit", response_model=schemas.EventRequestResponse, status_code=201)
def submit_event_request(
    request: schemas.EventSubmissionSave,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*EVENT_DRAFT_WRITERS)),
):
    # A saved draft transitions in place; another user's or submitted row is rejected.
    saved = find_editable_draft(request.draft_id, db, user, for_update=True) if request.draft_id is not None else models.Event(
        organiser_id=user.id, facilities=[], accessibility=[], equipment=[], registration_required=False,
    )
    now = datetime.now(timezone.utc)
    check_event_date(request.event_details, now)
    is_new = request.draft_id is None
    if request.event_details is not None:
        # Reuse shared field mapping without adding submission-required fields.
        apply_event_request(saved, request.event_details.model_copy(update={"submit": False}), now)
    prepared = event_submission.prepare_submission(request.event_information, now)
    for field, value in prepared.items():
        if field != "status":
            setattr(saved, field, value)
    saved.name = request.event_information.get("name", "")
    saved.purpose = request.event_information.get("purpose")
    if is_new:
        saved.status = models.EventStatus.submitted
        db.add(saved)
        db.flush()
        record_initial_status(db, saved, user, now)
    else:
        change_status(db, saved, models.EventStatus.submitted, user, now)
    db.commit()
    db.refresh(saved)
    return saved


# US06: the session determines whose drafts are listed; no owner parameter is accepted.
@app.get("/event-requests/drafts", response_model=List[schemas.EventDraftResponse])
def list_event_drafts(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*EVENT_DRAFT_WRITERS)),
):
    return db.query(models.Event).filter(
        models.Event.organiser_id == user.id, models.Event.status == "draft"
    ).all()


def find_editable_draft(event_id: int, db: Session, user: User, for_update: bool = False):
    """Return one authorised draft, without revealing another organiser's record."""
    query = db.query(models.Event).filter(models.Event.id == event_id)
    if for_update:
        # Keep status checking and saving in one short transaction.
        query = query.with_for_update()
    draft = query.first()
    if draft is None or not event_drafts.can_edit_draft(draft.status, draft.organiser_id, user.id):
        raise HTTPException(status_code=404, detail="Draft not found")
    return draft


@app.get("/event-requests/drafts/{event_id}", response_model=schemas.EventDraftResponse)
def get_event_draft(
    event_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*EVENT_DRAFT_WRITERS)),
):
    return find_editable_draft(event_id, db, user)


@app.put("/event-requests/drafts/{event_id}", response_model=schemas.EventDraftResponse)
def update_event_draft(
    event_id: int,
    request: schemas.EventDraftSave,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*EVENT_DRAFT_WRITERS)),
):
    draft = find_editable_draft(event_id, db, user, for_update=True)
    prepared = event_drafts.prepare_draft(request.event_information)
    # Update the existing row, not a new Event. Ownership and status never come from JSON.
    if request.event_details is not None:
        apply_event_request(draft, request.event_details.model_copy(update={"submit": False}), datetime.now(timezone.utc))
    draft.draft_form = prepared["draft_form"]
    draft.name = prepared["draft_form"].get("name", "")
    draft.purpose = prepared["draft_form"].get("purpose")
    db.commit()
    db.refresh(draft)
    return draft


# Routes have no trailing slash so they work through the Next.js /api proxy.

# Fulfills US18: View Details (excluding deactivated ones) — any signed-in user.
# include_inactive=true also returns deactivated venues, for Venue Staff and Coordinators only.
@app.get("/venues", response_model=List[schemas.VenueResponse])
def get_venues(include_inactive: bool = Query(False), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    query = db.query(models.Venue)
    if include_inactive:
        if user.role not in INACTIVE_VENUE_VIEWERS:
            raise HTTPException(status_code=403, detail="You don't have permission to do that")
    else:
        query = query.filter(models.Venue.is_active == True)
    return query.order_by(models.Venue.id).all()

# Fulfills US20: search and filter active venues. Every filter given must match; when a date and time
# are given, only venues free for that period (setup and turnaround included) are returned.
# The bookings that hold venues are read from the saved bookings, so a venue another coordinator has requested is not free.
@app.post("/venues/search", response_model=schemas.VenueSearchResponse)
def search_venues(criteria: schemas.VenueSearchRequest, db: Session = Depends(get_db), _user: User = Depends(require_roles(*VENUE_SEARCHERS))):
    active = db.query(models.Venue).filter(models.Venue.is_active == True).order_by(models.Venue.id).all()
    found = venue_search.find_venues(active, criteria, venue_bookings.held_periods(db))
    applied = venue_search.describe_filters(criteria)
    return schemas.VenueSearchResponse(
        venues=[schemas.VenueResponse.model_validate(v) for v in found],
        total=len(found),
        applied_filters=applied,
        message=None if found else venue_search.no_match_message(applied),
    )

# Fulfills US21: how well each active venue (or only the venues asked about) fits an event's recorded
# venue needs: a verdict plus every need compared with what the venue offers, with the reason when unmet.
@app.post("/venues/suitability", response_model=schemas.SuitabilityResponse)
def check_venue_suitability(needs: schemas.SuitabilityRequest, db: Session = Depends(get_db), _user: User = Depends(require_roles(*BOOKING_REQUESTERS))):
    active = db.query(models.Venue).filter(models.Venue.is_active == True).order_by(models.Venue.id).all()
    held = venue_bookings.held_periods(db, exclude_event_id=needs.event_id)  # the asking event's own booking isn't in its way
    return schemas.SuitabilityResponse(results=[
        schemas.VenueSuitability(venue=schemas.VenueResponse.model_validate(venue), verdict=verdict, checks=checks)
        for venue, verdict, checks in venue_suitability.assess_venues(active, needs, held)
    ])

# Fulfills US22 (and the override half of US21): request a venue for an approved event. The booking is
# saved as "pending", so the venue is held, Venue Staff can see it and it survives a reload. Only the
# coordinator the event is assigned to may ask. Everything the rules need comes from the saved event, the
# venue and the saved bookings, never from the page. A venue that is not fully suitable is refused unless
# the coordinator has acknowledged the warning; the acknowledgement is kept on the booking. Rules broken -> 409.
# US41: an event may book several venues, each once, with this booking's own attendance, layout and purpose.
@app.post("/venues/{venue_id}/booking-requests", response_model=schemas.BookingRequestResponse)
def request_venue_booking(venue_id: int, request: schemas.BookingRequestCreate, db: Session = Depends(get_db), user: User = Depends(require_roles(*BOOKING_REQUESTERS))):
    venue = db.get(models.Venue, venue_id)
    if venue is None:
        raise HTTPException(status_code=404, detail="Venue not found")
    event = db.get(models.Event, request.event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.coordinator_id != user.id:
        raise HTTPException(status_code=403, detail="You don't have permission to do that")

    try:
        needs = booking_request.needs_from_event(event, request.attendance, request.layout)
        rebooking = event.booking_state is not None or bool(venue_bookings.event_bookings(db, event.id))
        booking_request.require_bookable_event(event.status.value, rebooking)
        booking_request.require_active_venue(venue)
        held = venue_bookings.held_periods(db, venue_ids=[venue.id])
        booking_request.require_new_venue_for_event(venue, event.id, held)
        booking_request.require_no_pending_duplicate(venue, needs, held)
        verdict, checks = venue_suitability.assess(venue, needs, [b for b in held if b.event_id != str(event.id)])
        booking_request.require_acknowledgement(verdict, checks, request.acknowledged)
    except booking_request.BookingRefused as refusal:
        raise HTTPException(status_code=409, detail=refusal.message)

    now = datetime.now(timezone.utc)
    override = None if verdict == venue_suitability.SUITABLE else venue_suitability.override_record(verdict, checks, user.email, now)
    row = venue_bookings.save_request(db, event, booking_request.build_booking(venue, event, needs, verdict, user.email, now, override, request.purpose))
    return schemas.BookingRequestResponse(
        booking=venue_bookings.to_record(row),
        notification=booking_request.build_notification(venue, event, needs, override),
    )

# The saved booking requests the signed-in coordinator or Venue Staff member can see: those of the events
# they are involved in (event_access.py), oldest first. The event page merges them into its events, so a
# pending request, its hold and any override are still there after a reload.
# Venue Staff also get what is in the way of each booking right now (US46 a confirmed booking, US47 another
# pending request, US48 an unavailable period) and what a "Requires Reassessment" flag clashes with (US38).
def expire_lapsed_holds(db: Session) -> None:
    """US42-AC2: save "expired" on every tentative hold whose expiry has passed, so its venue is released.
    Called before bookings or events are read; there is no background job."""
    if hold_expiry.expire_due(db, datetime.now(timezone.utc)):
        db.commit()


@app.get("/bookings", response_model=List[schemas.VenueBooking])
def list_bookings(db: Session = Depends(get_db), user: User = Depends(require_roles(Role.coordinator, Role.venue))):
    expire_lapsed_holds(db)
    visible = involved_events(db.query(models.Event), user).with_entities(models.Event.id)
    shown = models.VenueBooking.event_id.in_(visible)
    if user.role == Role.venue:
        # US42-AC4: Venue Staff also see expired holds, whose events no longer hold a venue.
        shown = or_(shown, models.VenueBooking.status == "expired")
    rows = (
        db.query(models.VenueBooking)
        .filter(shown)
        .order_by(models.VenueBooking.requested_at, models.VenueBooking.id)
        .all()
    )
    if user.role == Role.venue:
        return venue_bookings.staff_records(db, rows, datetime.now(timezone.utc))
    return [venue_bookings.to_record(row) for row in rows]

# Fulfills US42-AC1: Venue Staff set or change when a pending request's tentative hold expires. It must be in
# the future and no later than the start of setup. Rules broken -> 409.
@app.post("/bookings/{booking_id}/hold", response_model=schemas.VenueBooking)
def set_hold_expiry(booking_id: int, body: schemas.BookingHoldIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*BOOKING_DECIDERS))):
    booking = db.get(models.VenueBooking, booking_id)
    if booking is None:
        raise HTTPException(status_code=404, detail="Booking request not found")
    try:
        hold_expiry.set_expiry(booking, body.expires_at, user.email, datetime.now(timezone.utc))
    except booking_request.BookingRefused as refusal:
        raise HTTPException(status_code=409, detail=refusal.message)
    db.commit()
    db.refresh(booking)
    return venue_bookings.to_record(booking)


# Venue Staff approve or reject a pending booking request. Rejecting needs a reason. The event's current
# venue follows the decision; a confirmed booking then blocks the venue for others. Approving is checked
# again here against what is confirmed at this moment (US46) and the venue's unavailable periods (US48),
# and refused, saying what is in the way, if anything is. Rules broken -> 409.
@app.post("/bookings/{booking_id}/decision", response_model=schemas.VenueBooking)
def decide_booking(booking_id: int, body: schemas.BookingDecisionIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*BOOKING_DECIDERS))):
    expire_lapsed_holds(db)  # US42: a hold that has lapsed is saved as expired before any decision
    booking = db.get(models.VenueBooking, booking_id)
    if booking is None:
        raise HTTPException(status_code=404, detail="Booking request not found")
    try:
        venue_bookings.decide(db, booking, body.outcome, body.reason, user.email, datetime.now(timezone.utc))
    except booking_request.BookingRefused as refusal:
        db.rollback()
        raise HTTPException(status_code=409, detail=refusal.message)
    db.commit()
    db.refresh(booking)
    return venue_bookings.staff_records(db, [booking], datetime.now(timezone.utc))[0]


def coordinators_event(db: Session, event_id: int, user: User) -> models.Event:
    """The event, if `user` is the coordinator it is assigned to (404 / 403 otherwise)."""
    event = db.get(models.Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.coordinator_id != user.id:
        raise HTTPException(status_code=403, detail="You don't have permission to do that")
    return event


def coordinators_booking(db: Session, booking_id: int, user: User) -> models.VenueBooking:
    booking = db.get(models.VenueBooking, booking_id)
    if booking is None:
        raise HTTPException(status_code=404, detail="Booking request not found")
    coordinators_event(db, booking.event_id, user)
    return booking


# Fulfills US41: change one booking's attendance, layout or purpose; the event's other bookings are kept.
# The venue is checked again for the new needs (an unsuitable result needs acknowledging, as in US21),
# and an approved booking goes back to Venue Staff as pending. Rules broken -> 409.
@app.patch("/bookings/{booking_id}", response_model=schemas.VenueBooking)
def change_booking(booking_id: int, body: schemas.BookingChange, db: Session = Depends(get_db), user: User = Depends(require_roles(*BOOKING_REQUESTERS))):
    booking = coordinators_booking(db, booking_id, user)
    event = db.get(models.Event, booking.event_id)
    venue = db.get(models.Venue, booking.venue_id)
    try:
        venue_bookings.require_holding(booking)
        needs = booking_request.needs_from_event(event, body.attendance or booking.attendance, body.layout or booking.layout)
        booking_request.require_active_venue(venue)
        others = [b for b in venue_bookings.held_periods(db, venue_ids=[venue.id]) if b.event_id != str(event.id)]
        verdict, checks = venue_suitability.assess(venue, needs, others)
        booking_request.require_acknowledgement(verdict, checks, body.acknowledged)
    except booking_request.BookingRefused as refusal:
        raise HTTPException(status_code=409, detail=refusal.message)

    override = None if verdict == venue_suitability.SUITABLE else venue_suitability.override_record(verdict, checks, user.email, datetime.now(timezone.utc))
    values = {"attendance": needs.attendance, "layout": needs.layout, "verdict": verdict,
              "override": booking_request.stored_override(override)}
    if "purpose" in body.model_fields_set:
        values["purpose"] = body.purpose or None
    venue_bookings.change(db, booking, values)
    db.commit()
    db.refresh(booking)
    return venue_bookings.to_record(booking)


# Fulfills US41: cancel one of the event's bookings; the others are kept.
@app.post("/bookings/{booking_id}/cancel", response_model=schemas.VenueBooking)
def cancel_booking(booking_id: int, db: Session = Depends(get_db), user: User = Depends(require_roles(*BOOKING_REQUESTERS))):
    booking = coordinators_booking(db, booking_id, user)
    try:
        venue_bookings.cancel(db, [booking])
    except booking_request.BookingRefused as refusal:
        raise HTTPException(status_code=409, detail=refusal.message)
    db.commit()
    db.refresh(booking)
    return venue_bookings.to_record(booking)


# Fulfills US41: the coordinator explicitly cancels every booking of the event that still holds a venue.
@app.post("/events/{event_id}/bookings/cancel", response_model=List[schemas.VenueBooking])
def cancel_all_bookings(event_id: int, db: Session = Depends(get_db), user: User = Depends(require_roles(*BOOKING_REQUESTERS))):
    event = coordinators_event(db, event_id, user)
    holding = [b for b in venue_bookings.event_bookings(db, event.id) if b.status in venue_bookings.HOLDING]
    if not holding:
        raise HTTPException(status_code=409, detail="This event has no booking to cancel.")
    venue_bookings.cancel(db, holding)
    db.commit()
    return [venue_bookings.to_record(row) for row in holding]

# Fulfills US18: full details of one active venue — any signed-in user.
# A deactivated venue is "not found", the same as it being left out of the list.
@app.get("/venues/{venue_id}", response_model=schemas.VenueResponse)
def get_venue(venue_id: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    venue = db.query(models.Venue).filter(models.Venue.id == venue_id, models.Venue.is_active == True).first()
    if venue is None:
        raise HTTPException(status_code=404, detail="Venue not found")
    return venue

# Fulfills US17: Create
@app.post("/venues", response_model=schemas.VenueResponse)
def create_venue(venue: schemas.VenueCreate, db: Session = Depends(get_db), user: User = Depends(require_roles(*VENUE_MANAGERS))):
    now = datetime.now(timezone.utc)
    new_venue = models.Venue(**venue.model_dump(mode="json"), last_updated_by=user.email, last_updated_at=now)
    db.add(new_venue)
    db.flush()  # assigns new_venue.id for the audit row

    record_change(db, new_venue, "create", user.email, creation_changes(new_venue), now)
    db.commit()
    db.refresh(new_venue)
    return new_venue

# Fulfills US17: Edit & Deactivate, and US39: record, edit or end early an unavailability period.
# Bookings holding the venue during a period are flagged (never cancelled) and returned, so their
# coordinators can be told; a booking whose period was ended early or removed is un-flagged.
# US38: a new setup or turnaround time re-checks every booking at the venue that has not happened yet.
# Those that now overlap another booking are marked "Requires Reassessment" (never cancelled) and returned
# in reassessed_bookings, so their coordinators can be told. A booking's hold follows the venue's times,
# so the unavailability flags are worked out again too.
@app.put("/venues/{venue_id}", response_model=schemas.VenueUpdateResponse)
def update_venue(venue_id: int, venue_update: schemas.VenueUpdate, db: Session = Depends(get_db), user: User = Depends(require_roles(*VENUE_MANAGERS))):
    db_venue = db.query(models.Venue).filter(models.Venue.id == venue_id).first()
    if not db_venue:
        raise HTTPException(status_code=404, detail="Venue not found")

    update_data = venue_update.model_dump(mode="json", exclude_unset=True)

    changes = apply_update(db_venue, update_data)

    # Nothing actually changed: leave the venue and its audit trail untouched.
    if not changes:
        return db_venue

    now = datetime.now(timezone.utc)
    record_change(db, db_venue, change_action(changes), user.email, changes, now)
    flagged, reassessed = venue_reassessment.after_venue_change(db, db_venue, changes, now)
    db.commit()
    db.refresh(db_venue)
    # Not columns: only read by the response model (VenueUpdateResponse).
    db_venue.flagged_bookings = [venue_bookings.to_record(row, staff=True) for row in flagged]
    db_venue.reassessed_bookings = [venue_bookings.to_record(row, staff=True) for row in reassessed]
    return db_venue

# Fulfills US17: venues are never deleted, only deactivated, so their booking history is kept.
@app.delete("/venues/{venue_id}", status_code=409)
def delete_venue(venue_id: int, db: Session = Depends(get_db), _user: User = Depends(require_roles(*VENUE_MANAGERS))):
    if db.get(models.Venue, venue_id) is None:
        raise HTTPException(status_code=404, detail="Venue not found")
    raise HTTPException(
        status_code=409,
        detail="Venues can't be deleted because bookings may refer to them. Deactivate the venue instead.",
    )

# Fulfills US17: change history (oldest first), including deactivated venues
@app.get("/venues/{venue_id}/history", response_model=List[schemas.VenueChangeResponse])
def get_venue_history(venue_id: int, db: Session = Depends(get_db), _user: User = Depends(require_roles(*VENUE_MANAGERS))):
    if db.get(models.Venue, venue_id) is None:
        raise HTTPException(status_code=404, detail="Venue not found")
    return (
        db.query(models.VenueChange)
        .filter(models.VenueChange.venue_id == venue_id)
        .order_by(models.VenueChange.changed_at, models.VenueChange.id)
        .all()
    )


def utc(value: datetime | None) -> datetime | None:
    """Mark a stored timestamp as UTC (SQLite drops the timezone), so browsers convert it to local time."""
    return value.replace(tzinfo=timezone.utc) if value is not None and value.tzinfo is None else value


def event_response(db: Session, event: models.Event) -> schemas.EventResponse:
    """Build the full API view of an event, with organiser/coordinator/venue names looked up."""
    organiser = db.get(User, event.organiser_id)
    coordinator = db.get(User, event.coordinator_id) if event.coordinator_id else None
    venue = db.get(models.Venue, event.venue_id) if event.venue_id else None
    # US11: the assignment that gave the event its current coordinator.
    assignment = (
        db.query(models.EventAssignment)
        .filter(models.EventAssignment.event_id == event.id, models.EventAssignment.coordinator_id == event.coordinator_id)
        .order_by(models.EventAssignment.id.desc())
        .first()
    ) if event.coordinator_id else None
    assigner = db.get(User, assignment.assigned_by_id) if assignment else None
    return schemas.EventResponse(
        id=event.id,
        status=event.status.value,
        name=event.name,
        organiserId=event.organiser_id,
        organiser=organiser.name if organiser else "",
        coordinatorId=event.coordinator_id,
        coordinator=coordinator.name if coordinator else None,
        assignedBy=assigner.name if assigner else None,
        assignedAt=utc(assignment.assigned_at) if assignment else None,
        purpose=event.purpose or "",
        eventType=event.event_type or "",
        pax=event.expected_attendance,
        date=event.date,
        start=event.start_time,
        end=event.end_time,
        venueLocation=event.venue_location or "",
        venueCapacity=event.venue_capacity,
        layout=event.layout,
        facilities=event.facilities or [],
        access=event.accessibility or [],
        equip=event.equipment or [],
        reg=event.registration_required,
        regCap=event.registration_cap,
        regClose=event.registration_close,
        registered=registrations.registered_count(db, event.id),
        withdrawalClose=registrations.withdrawal_close(event) if event.registration_required else None,
        venue=event.venue_id,
        venueName=venue.name if venue else None,
        bookingState=event.booking_state,
        equipState=event.equipment_state,
        clarification=event.clarification,
        decision=event.decision,
        draftForm=event.draft_form,
        submittedAt=utc(event.submitted_at),
        createdAt=utc(event.created_at),
        updatedAt=utc(event.updated_at),
    )


def event_view(db: Session, event: models.Event, user: User) -> schemas.EventView:
    """The event as `user`'s role may see it (US15): their hidden fields are left out, not blanked."""
    full = event_response(db, event).model_dump()
    return schemas.EventView(**for_role(full, user))


# Fulfills US03 (save a draft) and US04 (submit for review) — Event Organisers only.
@app.post("/events", response_model=schemas.EventResponse, status_code=201)
def create_event(request: schemas.EventRequestIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*EVENT_REQUESTERS))):
    now = datetime.now(timezone.utc)
    check_submission(request, now)
    event = models.Event(organiser_id=user.id)  # from the session, never the request body
    event.status = models.EventStatus.submitted if request.submit else models.EventStatus.draft
    apply_event_request(event, request, now)
    db.add(event)
    db.flush()  # assigns event.id for the status history
    record_initial_status(db, event, user, now)
    db.commit()
    db.refresh(event)
    return event_response(db, event)


# The events the signed-in user is involved in, with their current status (US02, US13) and
# only the details their role may see (US15). Who is involved: event_access.py; which
# fields each role sees: event_fields.py.
@app.get("/events", response_model=List[schemas.EventView], response_model_exclude_unset=True)
def list_events(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    expire_lapsed_holds(db)
    query = involved_events(db.query(models.Event), user)
    return [event_view(db, event, user) for event in query.order_by(models.Event.id.desc()).all()]


# Fulfills US15: the latest saved details of one event, as the user's role may see them.
@app.get("/events/{event_id}", response_model=schemas.EventView, response_model_exclude_unset=True)
def get_event(event_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    expire_lapsed_holds(db)
    event = db.get(models.Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    if not is_involved(event, user):
        raise HTTPException(status_code=403, detail="You don't have permission to do that")
    return event_view(db, event, user)


# US33: a proposal is a separate record, not an edit or event-status transition.
@app.post("/events/{event_id}/change-requests", response_model=schemas.EventChangeRequestResponse, status_code=201)
def request_event_change(event_id: int, body: schemas.EventChangeRequestIn,
                         db: Session = Depends(get_db),
                         user: User = Depends(require_roles(Role.organiser))):
    event = db.get(models.Event, event_id)
    if event is None:
        raise HTTPException(404, "Event not found")
    try:
        prepared = event_changes.prepare_request(event, user, body.proposed_changes)
    except event_changes.ChangeRequestError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    saved = models.EventChangeRequest(event_id=event.id, requested_by_id=user.id,
                                     requested_at=datetime.now(timezone.utc), **prepared)
    db.add(saved)
    db.commit()
    db.refresh(saved)
    return saved


@app.get("/events/{event_id}/change-requests", response_model=List[schemas.EventChangeRequestResponse])
def list_event_change_requests(event_id: int, db: Session = Depends(get_db),
                               user: User = Depends(require_roles(Role.organiser, Role.coordinator))):
    event = db.get(models.Event, event_id)
    if event is None:
        raise HTTPException(404, "Event not found")
    owner = user.role == Role.organiser and event.organiser_id == user.id
    assigned = user.role == Role.coordinator and event.coordinator_id == user.id
    if not (owner or assigned):
        raise HTTPException(403, "You don't have permission to view these requests")
    return db.query(models.EventChangeRequest).filter_by(event_id=event_id).order_by(
        models.EventChangeRequest.requested_at, models.EventChangeRequest.id).all()


@app.post("/events/{event_id}/change-requests/{request_id}/decision", response_model=schemas.EventChangeRequestResponse)
def review_event_change(event_id: int, request_id: int, body: schemas.EventChangeDecisionIn,
                        db: Session = Depends(get_db),
                        user: User = Depends(require_roles(Role.coordinator))):
    event = db.get(models.Event, event_id)
    if event is None:
        raise HTTPException(404, "Event not found")
    # Serialize competing reviews of this request on Postgres. No event edits occur.
    saved = db.query(models.EventChangeRequest).filter_by(
        id=request_id, event_id=event_id).with_for_update().first()
    if saved is None:
        raise HTTPException(404, "Change request not found")
    try:
        prepared = event_changes.prepare_decision(event, saved, user, body.outcome,
                                                  body.reason, datetime.now(timezone.utc))
    except event_changes.ChangeRequestError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    saved.status = prepared["status"]
    saved.decision = prepared["decision"]
    db.commit()
    db.refresh(saved)
    # US36 notification delivery is a separate, still-pending integration.
    return saved


# Fulfills US13: an event's timestamped status history, oldest first — only for users involved in it.
@app.get("/events/{event_id}/history", response_model=List[schemas.StatusChangeResponse])
def get_event_history(event_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    event = db.get(models.Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    if not is_involved(event, user):
        raise HTTPException(status_code=403, detail="You don't have permission to do that")
    changes = (
        db.query(models.EventStatusChange)
        .filter(models.EventStatusChange.event_id == event_id)
        .order_by(models.EventStatusChange.changed_at, models.EventStatusChange.id)
        .all()
    )
    names = {u.id: u.name for u in db.query(User).filter(User.id.in_({c.changed_by_id for c in changes}))}
    return [
        schemas.StatusChangeResponse(
            fromStatus=c.from_status.value if c.from_status else None,
            toStatus=c.to_status.value,
            changedBy=names.get(c.changed_by_id, ""),
            # Always say it's UTC (SQLite drops the timezone), so browsers convert it to local time correctly.
            changedAt=c.changed_at if c.changed_at.tzinfo else c.changed_at.replace(tzinfo=timezone.utc),
            reason=c.reason,
        )
        for c in changes
    ]


# ---------------------------------------------------------------- event review (US07/US08/US10/US11)
# The rules are in event_review.py (the same as lib/events/review/ on the page); each endpoint
# returns the saved event as the coordinator sees it, so the page shows what was stored.

# Fulfills US11/US43: the Event Coordinator accounts an event can be assigned to. The Lead sees each
# one's active events through GET /events.
@app.get("/coordinators", response_model=List[schemas.CoordinatorResponse])
def list_coordinators(db: Session = Depends(get_db), _user: User = Depends(require_roles(*COORDINATOR_ASSIGNERS))):
    return [schemas.CoordinatorResponse(id=u.id, name=u.name) for u in event_review.active_coordinators(db)]


# Fulfills US43 AC1/AC3 and US11 AC1: the Lead's queue of live requests nobody coordinates yet, oldest
# submission first, with each one's basic information (the US04 handover's receiving end).
@app.get("/lead/queue", response_model=List[schemas.EventView], response_model_exclude_unset=True)
def lead_queue(db: Session = Depends(get_db), user: User = Depends(require_roles(*COORDINATOR_ASSIGNERS))):
    rows = (
        involved_events(db.query(models.Event), user)
        .filter(models.Event.coordinator_id.is_(None))
        .order_by(models.Event.submitted_at, models.Event.id)
        .all()
    )
    return [event_view(db, event, user) for event in rows]


def review_step(event_id: int, db: Session, user: User, step) -> schemas.EventView:
    """Run one review step on an event the coordinator can see, and save it (404 / 403 / 409 / 422)."""
    event = db.get(models.Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    if not is_involved(event, user):
        raise HTTPException(status_code=403, detail="You don't have permission to do that")
    try:
        step(event, datetime.now(timezone.utc))
    except event_review.ReviewError as err:
        db.rollback()
        raise HTTPException(status_code=err.status_code, detail=err.message)
    db.commit()
    db.refresh(event)
    return event_view(db, event, user)


# Fulfills US11: the Lead assigns an Event Coordinator to an unassigned event; who assigned it and
# when is recorded, and the coordinator can then see and manage the event (US43).
@app.post("/events/{event_id}/assign", response_model=schemas.EventView, response_model_exclude_unset=True)
def assign_coordinator(event_id: int, body: schemas.AssignCoordinatorIn, db: Session = Depends(get_db),
                       user: User = Depends(require_roles(*COORDINATOR_ASSIGNERS))):
    return review_step(event_id, db, user, lambda event, now: event_review.assign(db, event, user, body.coordinatorId, now))


# Fulfills US07: start reviewing a submitted request.
@app.post("/events/{event_id}/review", response_model=schemas.EventView, response_model_exclude_unset=True)
def start_review(event_id: int, db: Session = Depends(get_db), user: User = Depends(require_roles(*EVENT_REVIEWERS))):
    return review_step(event_id, db, user, lambda event, now: event_review.start_review(db, event, user, now))


# Fulfills US08: ask the organiser for a clarification or an amendment.
@app.post("/events/{event_id}/clarification", response_model=schemas.EventView, response_model_exclude_unset=True)
def request_clarification(event_id: int, body: schemas.ClarificationIn, db: Session = Depends(get_db),
                          user: User = Depends(require_roles(*EVENT_REVIEWERS))):
    return review_step(event_id, db, user,
                       lambda event, now: event_review.request_clarification(db, event, user, body.kind, body.message, now))


# US09: record an organiser response; only the coordinator explicitly resumes review.
@app.post("/events/{event_id}/clarification-response", response_model=schemas.EventView, response_model_exclude_unset=True)
def respond_to_clarification(event_id: int, body: schemas.ClarificationResponseIn,
                             db: Session = Depends(get_db), user: User = Depends(require_roles(Role.organiser))):
    return review_step(event_id, db, user,
                       lambda event, now: event_review.respond_to_clarification(event, user, body.message, now))


@app.post("/events/{event_id}/resume-review", response_model=schemas.EventView, response_model_exclude_unset=True)
def resume_event_review(event_id: int, db: Session = Depends(get_db),
                        user: User = Depends(require_roles(*EVENT_REVIEWERS))):
    return review_step(event_id, db, user, lambda event, now: event_review.resume_review(db, event, user, now))


# Fulfills US10: approve or reject a request under review.
@app.post("/events/{event_id}/decision", response_model=schemas.EventView, response_model_exclude_unset=True)
def decide_request(event_id: int, body: schemas.DecisionIn, db: Session = Depends(get_db),
                   user: User = Depends(require_roles(*EVENT_REVIEWERS))):
    return review_step(event_id, db, user,
                       lambda event, now: event_review.decide(db, event, user, body.outcome, body.reason, now))


# US16: details and important-change history are committed atomically.
@app.patch("/events/{event_id}/details", response_model=schemas.EventView, response_model_exclude_unset=True)
def update_event_details(event_id: int, body: schemas.EventDetailsUpdate,
                         db: Session = Depends(get_db),
                         user: User = Depends(require_roles(Role.coordinator))):
    # Serialize edits to this event; do not overwrite unrelated fields from a stale form.
    event = db.query(models.Event).filter(models.Event.id == event_id).with_for_update().first()
    if event is None:
        raise HTTPException(404, "Event not found")
    has_arrangements = bool(event.venue_id or event.booking_state or event.equipment_state)
    has_arrangements = has_arrangements or db.query(models.VenueBooking).filter(
        models.VenueBooking.event_id == event_id,
        models.VenueBooking.status.in_(["pending", "approved"]),
    ).first() is not None or registrations.registered_count(db, event_id) > 0
    try:
        changes, affects = event_updates.prepare_update(
            event, user, body.model_dump(include=body.model_fields_set), has_arrangements)
    except event_updates.UpdateError as err:
        db.rollback()
        raise HTTPException(err.status_code, str(err))
    if changes and set(changes) & {"equip", "date", "start", "end"}:
        if any(line.get("status") in {"reserved", "fulfilled"} for line in event.equipment or []):
            raise HTTPException(409, "Release equipment reservations before changing equipment or the event period; fulfilled items cannot be amended.")
    if changes:
        now = datetime.now(timezone.utc)
        for key, value in changes.items():
            setattr(event, event_updates.DETAIL_FIELDS[key], value)
        event.updated_at = now
        if affects:
            db.add(models.EventDetailChange(event_id=event.id, changed_by_id=user.id,
                changed_at=now, changes=jsonable_encoder(changes), affects_arrangements=True))
        db.commit()
        db.refresh(event)
    return event_view(db, event, user)


@app.get("/events/{event_id}/detail-changes", response_model=List[schemas.EventDetailChangeResponse])
def event_detail_history(event_id: int, db: Session = Depends(get_db),
                          user: User = Depends(require_roles(Role.coordinator, Role.organiser))):
    event = db.get(models.Event, event_id)
    if event is None:
        raise HTTPException(404, "Event not found")
    if not is_involved(event, user):
        raise HTTPException(403, "You don't have permission to do that")
    rows = db.query(models.EventDetailChange, User.name).join(
        User, User.id == models.EventDetailChange.changed_by_id).filter(
        models.EventDetailChange.event_id == event_id).order_by(
        models.EventDetailChange.changed_at, models.EventDetailChange.id).all()
    return [schemas.EventDetailChangeResponse(id=change.id, changes=change.changes,
        changedBy=name, changedAt=utc(change.changed_at),
        affectsArrangements=change.affects_arrangements) for change, name in rows]


# Fulfills US03: keep editing a saved draft (and US04: submit it) without creating a new request.
@app.put("/events/{event_id}", response_model=schemas.EventResponse)
def update_event(event_id: int, request: schemas.EventRequestIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*EVENT_REQUESTERS))):
    event = db.get(models.Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.organiser_id != user.id:
        raise HTTPException(status_code=403, detail="You don't have permission to do that")
    if event.status != models.EventStatus.draft:
        raise HTTPException(status_code=409, detail="Only drafts can be edited. This request has already been submitted.")

    now = datetime.now(timezone.utc)
    check_submission(request, now)
    if request.submit:
        change_status(db, event, models.EventStatus.submitted, user, now)
    apply_event_request(event, request, now)
    db.commit()
    db.refresh(event)
    return event_response(db, event)


# Fulfills US29: register for an event open to the attendee, or join its waitlist when full.
# Rules, capacity and the waitlist: registrations.py.
@app.post("/events/{event_id}/registrations", response_model=schemas.RegistrationResponse, status_code=201)
def register_for_event(event_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user: User = Depends(require_roles(*REGISTRANTS))):
    event = registrations.locked_event(db, event_id)
    if not is_involved(event, user):  # attendees only see confirmed events open for registration
        raise HTTPException(status_code=403, detail="You don't have permission to do that")
    registration = registrations.register(db, event, user, datetime.now(timezone.utc))
    messaging.registration_confirmation(db, event, user, registration)
    db.commit()
    background_tasks.add_task(mail_worker.deliver_pending)
    return registrations.response(registration, event, user)


# Fulfills US31: withdraw the signed-in attendee's registration; a freed place goes to the waitlist.
@app.delete("/events/{event_id}/registrations/me", response_model=schemas.RegistrationResponse)
def withdraw_from_event(event_id: int, db: Session = Depends(get_db), user: User = Depends(require_roles(*REGISTRANTS))):
    event = registrations.locked_event(db, event_id)
    registration = registrations.withdraw(db, event, user, datetime.now(timezone.utc))
    db.commit()
    return registrations.response(registration, event, user)


# Fulfills US30: the signed-in attendee's registrations, newest first, with each one's status.
@app.get("/registrations/me", response_model=List[schemas.RegistrationResponse])
def my_registrations(db: Session = Depends(get_db), user: User = Depends(require_roles(*REGISTRANTS))):
    rows = (
        db.query(models.Registration, models.Event)
        .join(models.Event, models.Event.id == models.Registration.event_id)
        .filter(models.Registration.attendee_id == user.id)
        .order_by(models.Registration.registered_at.desc(), models.Registration.id.desc())
        .all()
    )
    return [registrations.response(registration, event, user) for registration, event in rows]


# Fulfills US32: an event's registrations, for its organiser and its assigned coordinator only.
@app.get("/events/{event_id}/registrations", response_model=List[schemas.RegistrationResponse])
def event_registrations(event_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    event = db.get(models.Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    manages = (user.role == Role.organiser and event.organiser_id == user.id) or (
        user.role == Role.coordinator and event.coordinator_id == user.id
    )
    if not manages:
        raise HTTPException(status_code=403, detail="You don't have permission to do that")
    rows = (
        db.query(models.Registration, User)
        .join(User, User.id == models.Registration.attendee_id)
        .filter(models.Registration.event_id == event_id)
        .order_by(models.Registration.registered_at, models.Registration.id)
        .all()
    )
    return [registrations.response(registration, event, attendee) for registration, attendee in rows]


def check_submission(request: schemas.EventRequestIn, now: datetime) -> None:
    """A request being submitted must pass the US03 rules; a draft may be incomplete."""
    if not request.submit:
        return
    errors = schemas.submission_errors(request, schemas.campus_today(now))
    if errors:
        raise HTTPException(
            status_code=422,
            detail={"message": "Complete the outstanding fields before submission.", "errors": errors},
        )


PAST_DATE = "Preferred date cannot be in the past."


def check_event_date(details: schemas.EventRequestIn | None, now: datetime) -> None:
    """US03 AC6: a request can't be submitted for a date that has already passed (campus date).

    No field is mandatory (the customer never specified any), so a missing date is fine.
    """
    if details is not None and details.preferredDate is not None and details.preferredDate < schemas.campus_today(now):
        raise HTTPException(status_code=422, detail={"message": PAST_DATE, "errors": {"preferredDate": PAST_DATE}})


def apply_event_request(event: models.Event, request: schemas.EventRequestIn, now: datetime) -> None:
    """Copy the organiser's request onto the stored event (new or an existing draft)."""
    equipment = [
        {"id": item.type, "qty": item.quantity, "technicalRequirements": item.technicalRequirements}
        for item in request.equipment
    ]
    registration = request.registration
    event.name = request.name or "Untitled request"
    event.purpose = request.description or None
    event.event_type = request.eventType or None
    event.expected_attendance = request.expectedAttendance
    event.date = request.preferredDate
    event.start_time = request.startTime
    event.end_time = request.endTime
    event.venue_location = request.venue.location or None
    event.venue_capacity = request.venue.capacity
    event.layout = request.venue.layout
    event.facilities = request.venue.facilities
    event.accessibility = request.venue.accessibility
    event.equipment = equipment
    event.equipment_state = "requested" if equipment else None
    event.registration_required = registration.required
    # Capacity/closing date only mean something when registration is on.
    event.registration_cap = registration.capacityLimit if registration.required else None
    event.registration_close = registration.closingDate if registration.required else None
    # A submitted request can't be edited directly, so there's no draft to reopen.
    event.draft_form = None if request.submit else request.draftForm
    event.submitted_at = now if request.submit else None

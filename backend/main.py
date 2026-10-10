from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime, timezone
from database import engine, Base, get_db
from login import auth
from login.models import Role, User
from login.security import enforce_https, get_current_user, require_roles
import models, registrations, schemas, venue_search
import event_review, models, schemas, venue_search
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

# RBAC: who may manage the venue catalogue (US17).
VENUE_MANAGERS = (Role.venue,)
# Who may also see deactivated venues: Venue Staff (to reactivate them) and Coordinators
# (whose events may still point at a venue that has since been deactivated).
INACTIVE_VENUE_VIEWERS = (Role.venue, Role.coordinator)
# Who may search and filter venues (US20).
VENUE_SEARCHERS = (Role.coordinator,)
# Who may create event requests (US03/US04).
EVENT_REQUESTERS = (Role.organiser,)
# Who may register for events (US29-US31).
REGISTRANTS = (Role.attendee,)
# Who may review event requests and assign coordinators (US07, US08, US10, US11).
EVENT_REVIEWERS = (Role.coordinator,)

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
# POST because the page also sends the bookings that hold venues (see schemas.BookedPeriod).
@app.post("/venues/search", response_model=schemas.VenueSearchResponse)
def search_venues(criteria: schemas.VenueSearchRequest, db: Session = Depends(get_db), _user: User = Depends(require_roles(*VENUE_SEARCHERS))):
    active = db.query(models.Venue).filter(models.Venue.is_active == True).order_by(models.Venue.id).all()
    found = venue_search.find_venues(active, criteria)
    applied = venue_search.describe_filters(criteria)
    return schemas.VenueSearchResponse(
        venues=[schemas.VenueResponse.model_validate(v) for v in found],
        total=len(found),
        applied_filters=applied,
        message=None if found else venue_search.no_match_message(applied),
    )

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

# Fulfills US17: Edit & Deactivate
@app.put("/venues/{venue_id}", response_model=schemas.VenueResponse)
def update_venue(venue_id: int, venue_update: schemas.VenueUpdate, db: Session = Depends(get_db), user: User = Depends(require_roles(*VENUE_MANAGERS))):
    db_venue = db.query(models.Venue).filter(models.Venue.id == venue_id).first()
    if not db_venue:
        raise HTTPException(status_code=404, detail="Venue not found")

    update_data = venue_update.model_dump(mode="json", exclude_unset=True)

    changes = apply_update(db_venue, update_data)

    # Nothing actually changed: leave the venue and its audit trail untouched.
    if not changes:
        return db_venue

    record_change(db, db_venue, change_action(changes), user.email, changes, datetime.now(timezone.utc))
    db.commit()
    db.refresh(db_venue)
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
    return schemas.EventResponse(
        id=event.id,
        status=event.status.value,
        name=event.name,
        organiserId=event.organiser_id,
        organiser=organiser.name if organiser else "",
        coordinatorId=event.coordinator_id,
        coordinator=coordinator.name if coordinator else None,
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
    query = involved_events(db.query(models.Event), user)
    return [event_view(db, event, user) for event in query.order_by(models.Event.id.desc()).all()]


# Fulfills US15: the latest saved details of one event, as the user's role may see them.
@app.get("/events/{event_id}", response_model=schemas.EventView, response_model_exclude_unset=True)
def get_event(event_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    event = db.get(models.Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    if not is_involved(event, user):
        raise HTTPException(status_code=403, detail="You don't have permission to do that")
    return event_view(db, event, user)


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

# Fulfills US11: the Event Coordinator accounts an event can be assigned to.
@app.get("/coordinators", response_model=List[schemas.CoordinatorResponse])
def list_coordinators(db: Session = Depends(get_db), _user: User = Depends(require_roles(*EVENT_REVIEWERS))):
    return [schemas.CoordinatorResponse(id=u.id, name=u.name) for u in event_review.active_coordinators(db)]


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


# Fulfills US11: assign an Event Coordinator to an unassigned event.
@app.post("/events/{event_id}/assign", response_model=schemas.EventView, response_model_exclude_unset=True)
def assign_coordinator(event_id: int, body: schemas.AssignCoordinatorIn, db: Session = Depends(get_db),
                       user: User = Depends(require_roles(*EVENT_REVIEWERS))):
    return review_step(event_id, db, user, lambda event, now: event_review.assign(db, event, user, body.coordinatorId))


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


# Fulfills US10: approve or reject a request under review.
@app.post("/events/{event_id}/decision", response_model=schemas.EventView, response_model_exclude_unset=True)
def decide_request(event_id: int, body: schemas.DecisionIn, db: Session = Depends(get_db),
                   user: User = Depends(require_roles(*EVENT_REVIEWERS))):
    return review_step(event_id, db, user,
                       lambda event, now: event_review.decide(db, event, user, body.outcome, body.reason, now))


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
def register_for_event(event_id: int, db: Session = Depends(get_db), user: User = Depends(require_roles(*REGISTRANTS))):
    event = registrations.locked_event(db, event_id)
    if not is_involved(event, user):  # attendees only see confirmed events open for registration
        raise HTTPException(status_code=403, detail="You don't have permission to do that")
    registration = registrations.register(db, event, user, datetime.now(timezone.utc))
    db.commit()
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

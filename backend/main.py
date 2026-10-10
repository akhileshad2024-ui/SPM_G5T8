from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime, timezone
from database import engine, Base, get_db
from login import auth
from login.models import Role, User
from login.security import get_current_user, require_roles
import booking_request, models, schemas, venue_search, venue_suitability
from venue_audit import apply_update, change_action, creation_changes, record_change

Base.metadata.create_all(bind=engine)

app = FastAPI(title="ConnectSphere API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)

# RBAC: who may manage the venue catalogue (US17).
VENUE_MANAGERS = (Role.venue,)
# Who may also see deactivated venues: Venue Staff (to reactivate them) and Coordinators
# (whose events may still point at a venue that has since been deactivated).
INACTIVE_VENUE_VIEWERS = (Role.venue, Role.coordinator)
# Who may search and filter venues (US20).
VENUE_SEARCHERS = (Role.coordinator,)
# Who may check a venue's suitability for an event (US21) and request a booking (US22).
BOOKING_REQUESTERS = (Role.coordinator,)

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

# Fulfills US21: how well each active venue (or only the venues asked about) fits an event's recorded
# venue needs: a verdict plus every need compared with what the venue offers, with the reason when unmet.
@app.post("/venues/suitability", response_model=schemas.SuitabilityResponse)
def check_venue_suitability(needs: schemas.SuitabilityRequest, db: Session = Depends(get_db), _user: User = Depends(require_roles(*BOOKING_REQUESTERS))):
    active = db.query(models.Venue).filter(models.Venue.is_active == True).order_by(models.Venue.id).all()
    return schemas.SuitabilityResponse(results=[
        schemas.VenueSuitability(venue=schemas.VenueResponse.model_validate(venue), verdict=verdict, checks=checks)
        for venue, verdict, checks in venue_suitability.assess_venues(active, needs)
    ])

# Fulfills US22 (and the override half of US21): request a venue for an approved event. The venue is
# provisionally held (status "pending") and Venue Staff are told. A venue that is not fully suitable is
# refused unless the coordinator has acknowledged the warning, and the acknowledgement is returned to be
# kept against the event. Rules broken -> 409 with the reason.
@app.post("/venues/{venue_id}/booking-requests", response_model=schemas.BookingRequestResponse)
def request_venue_booking(venue_id: int, request: schemas.BookingRequestCreate, db: Session = Depends(get_db), user: User = Depends(require_roles(*BOOKING_REQUESTERS))):
    venue = db.get(models.Venue, venue_id)
    if venue is None:
        raise HTTPException(status_code=404, detail="Venue not found")

    here = [b for b in request.bookings if b.venue_id == venue.id]
    try:
        booking_request.require_bookable_event(request.event_status, request.rebooking)
        booking_request.require_active_venue(venue)
        booking_request.require_no_pending_duplicate(venue, request)
        verdict, checks = venue_suitability.assess(venue, request, here)
        booking_request.require_acknowledgement(verdict, checks, request.acknowledged)
    except booking_request.BookingRefused as refusal:
        raise HTTPException(status_code=409, detail=refusal.message)

    now = datetime.now(timezone.utc)
    override = None if verdict == venue_suitability.SUITABLE else venue_suitability.override_record(verdict, checks, user.email, now)
    return schemas.BookingRequestResponse(
        booking=booking_request.build_booking(venue, request, verdict, user.email, now, override),
        notification=booking_request.build_notification(venue, request, override),
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

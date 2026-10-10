from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List
from database import engine, Base, get_db
from login import auth
from login.models import Role, User
from login.security import get_current_user, require_roles
import event_drafts, models, schemas

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
# US05: only Event Organisers save their own draft requests.
EVENT_DRAFT_WRITERS = (Role.organiser,)

# Routes have no trailing slash so they work through the Next.js /api proxy.


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
    db.add(saved)
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
    draft.draft_form = prepared["draft_form"]
    draft.name = prepared["draft_form"].get("name", "")
    draft.purpose = prepared["draft_form"].get("purpose")
    db.commit()
    db.refresh(draft)
    return draft

# Fulfills US18: View Details (excluding deactivated ones) — any signed-in user.
@app.get("/venues", response_model=List[schemas.VenueResponse])
def get_venues(db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    return db.query(models.Venue).filter(models.Venue.is_active == True).all()

# Fulfills US17: Create
@app.post("/venues", response_model=schemas.VenueResponse)
def create_venue(venue: schemas.VenueCreate, db: Session = Depends(get_db), user: User = Depends(require_roles(*VENUE_MANAGERS))):
    venue_data = venue.model_dump()

    new_venue = models.Venue(**venue_data, last_updated_by=user.email)
    db.add(new_venue)
    db.commit()
    db.refresh(new_venue)
    return new_venue

# Fulfills US17: Edit & Deactivate
@app.put("/venues/{venue_id}", response_model=schemas.VenueResponse)
def update_venue(venue_id: int, venue_update: schemas.VenueUpdate, db: Session = Depends(get_db), user: User = Depends(require_roles(*VENUE_MANAGERS))):
    db_venue = db.query(models.Venue).filter(models.Venue.id == venue_id).first()
    if not db_venue:
        raise HTTPException(status_code=404, detail="Venue not found")

    update_data = venue_update.model_dump(exclude_unset=True)

    for key, value in update_data.items():
        setattr(db_venue, key, value)
    
    db_venue.last_updated_by = user.email
    
    db.commit()
    db.refresh(db_venue)
    return db_venue

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List
from database import engine, Base, get_db
from login import auth
from login.models import Role, User
from login.security import get_current_user, require_roles
import models, schemas

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

# Routes have no trailing slash so they work through the Next.js /api proxy.

# Fulfills US18: View Details (excluding deactivated ones) — any signed-in user
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
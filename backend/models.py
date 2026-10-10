from sqlalchemy import Column, Integer, String, Boolean, JSON, Date, DateTime, ForeignKey, Time
from sqlalchemy.sql import func
from database import Base

class Venue(Base):
    __tablename__ = "venues"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    building = Column("location", String, nullable=False)
    
    # Updated to match frontend type names
    cap = Column(Integer, nullable=False)
    layouts = Column(JSON, default=[])
    facilities = Column(JSON, default=[])
    stepFree = Column(Boolean, default=False)
    operatingHours = Column(String, nullable=True)
    operatingDays = Column(JSON, default=[])
    unavailableDates = Column(JSON, default=[])
    characteristics = Column(JSON, default=[])
    
    is_active = Column(Boolean, default=True)
    last_updated_by = Column(String, nullable=False) 
    last_updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Event(Base):
    """Existing ``events`` table: only the fields needed to save a US05 draft.

    The table already exists in Supabase. Empty technical defaults allow an
    incomplete request to be stored without changing its schema; the organiser's
    actual saved information remains in ``draft_form``.
    """
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, index=True)
    status = Column(String, nullable=False)
    organiser_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    coordinator_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    name = Column(String, nullable=False, default="")
    purpose = Column(String, nullable=True)
    event_type = Column(String, nullable=True)
    expected_attendance = Column(Integer, nullable=True)
    date = Column(Date, nullable=True)
    start_time = Column(Time, nullable=True)
    end_time = Column(Time, nullable=True)
    venue_location = Column(String, nullable=True)
    venue_capacity = Column(Integer, nullable=True)
    layout = Column(String, nullable=True)
    facilities = Column(JSON, nullable=False, default=list)
    accessibility = Column(JSON, nullable=False, default=list)
    equipment = Column(JSON, nullable=False, default=list)
    registration_required = Column(Boolean, nullable=False, default=False)
    registration_cap = Column(Integer, nullable=True)
    registration_close = Column(Date, nullable=True)
    venue_id = Column(Integer, ForeignKey("venues.id"), nullable=True)
    booking_state = Column(String, nullable=True)
    equipment_state = Column(String, nullable=True)
    clarification = Column(JSON, nullable=True)
    decision = Column(JSON, nullable=True)
    draft_form = Column(JSON, nullable=True)
    submitted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

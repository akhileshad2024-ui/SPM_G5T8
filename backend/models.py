from sqlalchemy import Column, Integer, String, Boolean, JSON, DateTime, ForeignKey
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

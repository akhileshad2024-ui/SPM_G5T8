from sqlalchemy import Column, Integer, String, Boolean, JSON, DateTime
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
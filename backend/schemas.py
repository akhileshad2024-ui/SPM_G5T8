from pydantic import BaseModel, Field, ConfigDict
from typing import Any, Dict, List, Literal, Optional
from datetime import datetime

class VenueBase(BaseModel):
    name: str
    building: str
    # Validates US17 requirement for non-positive capacity
    cap: int = Field(..., gt=0, description="Capacity must be > 0")
    layouts: List[str] = []
    facilities: List[str] = []
    stepFree: bool = False
    operatingHours: Optional[str] = None
    unavailableDates: List[str] = []
    characteristics: List[str] = []
    operatingDays: List[str] = []


# The editor is taken from the login session, never from the request body.
class VenueCreate(VenueBase):
    pass

class VenueUpdate(BaseModel):
    name: Optional[str] = None
    building: Optional[str] = None
    cap: Optional[int] = Field(None, gt=0)
    layouts: Optional[List[str]] = None
    facilities: Optional[List[str]] = None
    stepFree: Optional[bool] = None
    is_active: Optional[bool] = None
    operatingHours: Optional[str] = None
    unavailableDates: Optional[List[str]] = None
    characteristics: Optional[List[str]] = None
    operatingDays: List[str] = []


class VenueResponse(VenueBase):
    id: int
    is_active: bool
    last_updated_by: str
    last_updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------- event-request drafts (US05)

class EventDraftSave(BaseModel):
    """Only the event information is accepted; organiser identity comes from the session."""
    event_information: Dict[str, Any]


class EventDraftResponse(BaseModel):
    id: int
    status: Literal["draft"]
    draft_form: Dict[str, Any]

    model_config = ConfigDict(from_attributes=True)


class EventSubmissionSave(EventDraftSave):
    draft_id: Optional[int] = None


class EventRequestResponse(BaseModel):
    id: int
    status: str
    draft_form: Optional[Dict[str, Any]] = None
    submitted_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

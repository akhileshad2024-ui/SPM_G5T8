import re
from datetime import datetime
from typing import Annotated, Any, Dict, List, Literal, Optional

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

# Trimmed, and must not be empty or whitespace-only (US17 validation)
RequiredText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]

WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")

# Setup/turnaround are minutes before/after each event (Week 7 change #1); a day is the sane upper bound.
BufferMinutes = Annotated[int, Field(ge=0, le=24 * 60)]

UnavailabilityReason = Literal["maintenance", "equipment_failure", "renovation", "safety", "internal_activity", "other"]

_HOURS_RE = re.compile(r"^\s*([01]\d|2[0-3]):([0-5]\d)\s*-\s*([01]\d|2[0-3]):([0-5]\d)\s*$")


def _dedupe(items: List[str]) -> List[str]:
    """Drop repeats (case-insensitive), keeping the first spelling and the original order."""
    seen, out = set(), []
    for item in items:
        if item.lower() not in seen:
            seen.add(item.lower())
            out.append(item)
    return out


def _lower_dedupe(items: List[str]) -> List[str]:
    # Layouts are matched against event layouts ("banquet", "theatre", ...), which are lower case.
    return _dedupe([i.lower() for i in items])


def _check_operating_hours(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    match = _HOURS_RE.match(value)
    if not match:
        raise ValueError('must look like "08:00 - 22:00"')
    oh, om, ch, cm = match.groups()
    if (int(ch), int(cm)) <= (int(oh), int(om)):
        raise ValueError("closing time must be after opening time")
    return f"{oh}:{om} - {ch}:{cm}"


def _check_operating_days(days: List[str]) -> List[str]:
    lookup = {d.lower(): d for d in WEEKDAYS}
    unknown = [d for d in days if d.lower() not in lookup]
    if unknown:
        raise ValueError(f"unknown day(s): {', '.join(unknown)}; use {', '.join(WEEKDAYS)}")
    picked = {lookup[d.lower()] for d in days}
    if not picked:
        raise ValueError("pick at least one operating day")
    return [d for d in WEEKDAYS if d in picked]  # week order, no repeats


TextList = Annotated[List[RequiredText], AfterValidator(_dedupe)]
LayoutList = Annotated[List[RequiredText], AfterValidator(_lower_dedupe)]
OperatingHours = Annotated[Optional[str], AfterValidator(_check_operating_hours)]
OperatingDays = Annotated[List[str], AfterValidator(_check_operating_days)]


class UnavailabilityPeriod(BaseModel):
    """A block of time when the venue can't be used (Week 7 change #2), e.g. maintenance."""
    start: datetime
    end: datetime
    reason: UnavailabilityReason
    note: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]] = None

    @model_validator(mode="after")
    def _check(self):
        if self.end <= self.start:
            raise ValueError("end must be after start")
        if self.reason == "other" and not self.note:
            raise ValueError('a note is required when the reason is "other"')
        return self


# ---------------------------------------------------------------- venue input (validated)

# The editor is taken from the login session, never from the request body.
class VenueCreate(BaseModel):
    name: RequiredText
    building: RequiredText
    # Validates US17 requirement for non-positive capacity
    cap: int = Field(..., gt=0, description="Capacity must be > 0")
    layouts: LayoutList = []
    facilities: TextList = []
    accessibility: TextList = []
    operatingHours: OperatingHours = None
    operatingDays: OperatingDays = list(WEEKDAYS[:5])
    unavailability: List[UnavailabilityPeriod] = []
    setupMinutes: BufferMinutes = 0
    turnaroundMinutes: BufferMinutes = 0


class VenueUpdate(BaseModel):
    """Partial update: only the fields sent are changed."""
    name: Optional[RequiredText] = None
    building: Optional[RequiredText] = None
    cap: Optional[int] = Field(None, gt=0)
    layouts: Optional[LayoutList] = None
    facilities: Optional[TextList] = None
    accessibility: Optional[TextList] = None
    operatingHours: OperatingHours = None
    operatingDays: Optional[OperatingDays] = None
    unavailability: Optional[List[UnavailabilityPeriod]] = None
    setupMinutes: Optional[BufferMinutes] = None
    turnaroundMinutes: Optional[BufferMinutes] = None
    is_active: Optional[bool] = None

    @model_validator(mode="after")
    def _no_nulls_for_required_fields(self):
        # "Not sent" means "leave alone"; an explicit null would try to blank a required column.
        nullable = {"operatingHours"}
        nulled = [f for f in self.model_fields_set if f not in nullable and getattr(self, f) is None]
        if nulled:
            raise ValueError(f"cannot be null: {', '.join(sorted(nulled))}")
        return self


# ---------------------------------------------------------------- venue output (lenient)

class UnavailabilityPeriodResponse(BaseModel):
    start: str
    end: str
    reason: str
    note: Optional[str] = None


# Output models don't re-validate, so older rows saved under looser rules still load.
class VenueResponse(BaseModel):
    id: int
    name: str
    building: str
    cap: int
    layouts: List[str] = []
    facilities: List[str] = []
    accessibility: List[str] = []
    operatingHours: Optional[str] = None
    operatingDays: List[str] = []
    unavailability: List[UnavailabilityPeriodResponse] = []
    setupMinutes: int = 0
    turnaroundMinutes: int = 0
    is_active: bool
    last_updated_by: str
    last_updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @field_validator("layouts", "facilities", "accessibility", "operatingDays", "unavailability", mode="before")
    @classmethod
    def _none_as_empty(cls, v):
        return v or []

    @field_validator("setupMinutes", "turnaroundMinutes", mode="before")
    @classmethod
    def _none_as_zero(cls, v):
        return v or 0


class VenueChangeResponse(BaseModel):
    id: int
    venue_id: int
    action: str
    changed_by: str
    changed_at: datetime
    changes: Dict[str, Dict[str, Any]]

    model_config = ConfigDict(from_attributes=True)

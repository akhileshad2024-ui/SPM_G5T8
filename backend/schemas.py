import re
from datetime import date as DateOnly, datetime
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


# The accessibility features Venue Staff can record. Kept the same as VENUE_ACCESSIBILITY_OPTIONS in
# lib/data.ts (a unit test fails if the two lists differ).
ACCESSIBILITY_FEATURES = ("Wheelchair Access", "Special Physical Seating", "Mobility/Facility Arrangements")


def _check_accessibility(items: List[str]) -> List[str]:
    lookup = {f.lower(): f for f in ACCESSIBILITY_FEATURES}
    unknown = [i for i in items if i.lower() not in lookup]
    if unknown:
        raise ValueError(f"unknown accessibility feature(s): {', '.join(unknown)}; use {', '.join(ACCESSIBILITY_FEATURES)}")
    picked = {lookup[i.lower()] for i in items}
    return [f for f in ACCESSIBILITY_FEATURES if f in picked]  # fixed order, no repeats


TextList = Annotated[List[RequiredText], AfterValidator(_dedupe)]
AccessibilityList = Annotated[List[RequiredText], AfterValidator(_check_accessibility)]
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
    location: RequiredText
    # Validates US17 requirement for non-positive capacity
    cap: int = Field(..., gt=0, description="Capacity must be > 0")
    layouts: LayoutList = []
    facilities: TextList = []
    accessibility: AccessibilityList = []
    operatingHours: OperatingHours = None
    operatingDays: OperatingDays = list(WEEKDAYS[:5])
    unavailability: List[UnavailabilityPeriod] = []
    setupMinutes: BufferMinutes = 0
    turnaroundMinutes: BufferMinutes = 0


class VenueUpdate(BaseModel):
    """Partial update: only the fields sent are changed."""
    name: Optional[RequiredText] = None
    location: Optional[RequiredText] = None
    cap: Optional[int] = Field(None, gt=0)
    layouts: Optional[LayoutList] = None
    facilities: Optional[TextList] = None
    accessibility: Optional[AccessibilityList] = None
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
    location: str
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


# ---------------------------------------------------------------- venue search, suitability, booking requests (US20-22)

# "09:30", 24-hour. Because they are zero-padded, "09:30" < "10:00" is also true as text.
ClockTime = Annotated[str, StringConstraints(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]


def _blank_to_none(value: Optional[str]) -> Optional[str]:
    """A search box left empty (or only spaces) is no filter at all."""
    return (value or "").strip() or None


def _clean_layout(value: Optional[str]) -> Optional[str]:
    # Layouts are stored lower case ("theatre", "classroom", ...).
    cleaned = _blank_to_none(value)
    return cleaned.lower() if cleaned else None


def _end_after_start(start: str, end: str) -> None:
    if end <= start:
        raise ValueError("end must be after start")


OptionalText = Annotated[Optional[str], AfterValidator(_blank_to_none)]
OptionalLayout = Annotated[Optional[str], AfterValidator(_clean_layout)]
RequiredLayout = Annotated[RequiredText, AfterValidator(str.lower)]


class BookedPeriod(BaseModel):
    """A booking that currently holds a venue, so a search can leave that venue out.

    Event bookings are not stored in the backend yet (the frontend keeps them in memory),
    so the page sends the ones that hold a venue along with the request.
    """
    venue_id: int
    date: DateOnly
    start: ClockTime
    end: ClockTime
    status: Literal["pending", "approved"] = "approved"
    event_id: Optional[str] = None
    event_name: Optional[str] = None


class TimingFields(BaseModel):
    """An optional period (date, start and end go together) plus the bookings that could be in the way of it."""
    date: Optional[DateOnly] = None
    start: Optional[ClockTime] = None
    end: Optional[ClockTime] = None
    bookings: List[BookedPeriod] = []

    @model_validator(mode="after")
    def _timing(self):
        given = [self.date is not None, self.start is not None, self.end is not None]
        if any(given) and not all(given):
            raise ValueError("date, start and end must be given together")
        if self.start is not None:
            _end_after_start(self.start, self.end)
        return self


class VenueSearchRequest(TimingFields):
    """What the Event Coordinator is looking for. Every field is optional; those given must all match."""
    attendance: Optional[int] = Field(None, gt=0)
    location: OptionalText = None
    accessibility: AccessibilityList = []
    layout: OptionalLayout = None
    facilities: TextList = []


class AppliedFilter(BaseModel):
    """One filter in use, for display ("Layout: Theatre"); `key` says which one a page should clear."""
    key: Literal["timing", "attendance", "location", "accessibility", "layout", "facilities"]
    label: str
    value: str


class VenueSearchResponse(BaseModel):
    venues: List[VenueResponse]
    total: int
    applied_filters: List[AppliedFilter]
    message: Optional[str] = None  # set when nothing matched


# ---- US21: is this venue suitable for the event?

Verdict = Literal["suitable", "partially_suitable", "unsuitable"]


class SuitabilityRequest(TimingFields):
    """The event's recorded venue needs. The period is optional because an event may not have a date yet."""
    attendance: int = Field(..., gt=0)
    layout: OptionalLayout = None
    facilities: TextList = []
    accessibility: AccessibilityList = []
    venue_ids: Optional[List[int]] = None  # only these venues; None = every active venue


class RequirementCheck(BaseModel):
    """One of the event's needs compared with what the venue offers."""
    key: Literal["capacity", "layout", "facility", "accessibility", "availability"]
    label: str
    needed: str
    offered: str
    met: bool
    severity: Literal["block", "warn"]  # how serious it is when not met
    reason: Optional[str] = None  # set when not met


class VenueSuitability(BaseModel):
    venue: VenueResponse
    verdict: Verdict
    checks: List[RequirementCheck]


class SuitabilityResponse(BaseModel):
    results: List[VenueSuitability]


class UnmetRequirement(BaseModel):
    label: str
    severity: Literal["block", "warn"]
    reason: str


class BookingOverride(BaseModel):
    """The coordinator went ahead with a venue that was not fully suitable (kept against the event)."""
    verdict: Verdict
    acknowledged_by: str
    acknowledged_at: datetime
    unmet: List[UnmetRequirement]


# ---- US22: request a venue booking

class BookingRequestCreate(BaseModel):
    """A coordinator's request to book a venue for an event. The coordinator comes from the login session."""
    event_id: RequiredText
    event_name: RequiredText
    event_status: RequiredText
    rebooking: bool = False  # the event already went through a booking (replacement venue, or after a rejection)
    date: DateOnly
    start: ClockTime
    end: ClockTime
    attendance: int = Field(..., gt=0)
    layout: RequiredLayout
    facilities: TextList = []
    accessibility: AccessibilityList = []
    acknowledged: bool = False  # the coordinator accepted the warning about an unsuitable venue
    bookings: List[BookedPeriod] = []

    @model_validator(mode="after")
    def _times(self):
        _end_after_start(self.start, self.end)
        return self


class VenueBooking(BaseModel):
    event_id: str
    event_name: str
    venue_id: int
    venue_name: str
    date: DateOnly
    start: str
    end: str
    setup_minutes: int
    teardown_minutes: int
    hold_start: datetime  # the venue is held from the start of setup ...
    hold_end: datetime  # ... to the end of the teardown
    attendance: int
    layout: str
    status: Literal["pending"]
    verdict: Verdict
    requested_by: str
    requested_at: datetime
    override: Optional[BookingOverride] = None


class BookingNotification(BaseModel):
    to: str  # the role to tell
    title: str
    body: str


class BookingRequestResponse(BaseModel):
    booking: VenueBooking
    notification: BookingNotification


class VenueChangeResponse(BaseModel):
    id: int
    venue_id: int
    action: str
    changed_by: str
    changed_at: datetime
    changes: Dict[str, Dict[str, Any]]

    model_config = ConfigDict(from_attributes=True)

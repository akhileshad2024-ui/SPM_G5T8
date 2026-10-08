import re
from datetime import date as Date, datetime, time as Time, timedelta, timezone
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


# ---------------------------------------------------------------- event request input
#
# Same shape as `EventRequestDraft` in lib/types.ts, so the frontend can send what
# its form adapter already builds. Types and ranges are checked here for every
# save; the "is everything filled in" rules only apply on submit, see
# submission_errors() below.

Layout = Literal["banquet", "theatre", "standing", "boardroom", "classroom"]
PositiveInt = Annotated[int, Field(gt=0)]
Text = Annotated[str, StringConstraints(strip_whitespace=True)]


class EventVenueRequirements(BaseModel):
    location: Text = ""
    capacity: Optional[PositiveInt] = None
    layout: Optional[Layout] = None
    accessibility: TextList = []
    facilities: TextList = []


class EventEquipmentLine(BaseModel):
    # Equipment catalogue id (e.g. "E1"), matching `EquipmentLine.id` on the frontend.
    type: RequiredText
    quantity: PositiveInt
    technicalRequirements: Text = ""


class EventRegistration(BaseModel):
    required: bool = False
    capacityLimit: Optional[PositiveInt] = None
    closingDate: Optional[Date] = None


class EventRequestIn(BaseModel):
    """Body for creating or saving an event request (US03/US04).

    The organiser is taken from the login session, never from the request body.
    `submit=False` saves a draft (anything may still be missing);
    `submit=True` sends it for review and must pass submission_errors().
    """
    submit: bool = False
    name: Text = ""
    description: Text = ""
    eventType: Text = ""
    expectedAttendance: Optional[PositiveInt] = None
    preferredDate: Optional[Date] = None
    startTime: Optional[Time] = None
    endTime: Optional[Time] = None
    venue: EventVenueRequirements = EventVenueRequirements()
    equipment: List[EventEquipmentLine] = []
    registration: EventRegistration = EventRegistration()
    # The wizard's raw form values, kept so a draft can be reopened exactly as left.
    draftForm: Optional[Dict[str, Any]] = None


# Campus time (Singapore, UTC+8, no daylight saving). "Today" for date rules must be the
# campus date, not the UTC date, which is still yesterday until 8am.
CAMPUS_TZ = timezone(timedelta(hours=8), "SGT")


def campus_today(now: Optional[datetime] = None) -> Date:
    return (now or datetime.now(timezone.utc)).astimezone(CAMPUS_TZ).date()


def submission_errors(request: EventRequestIn, today: Date) -> Dict[str, str]:
    """US03 rules for a request being submitted, keyed and worded like
    validateEventRequest() in lib/events/request/validation.ts so the form can show
    them beside the same inputs. Empty dict = OK to submit."""
    errors: Dict[str, str] = {}

    if not request.name:
        errors["name"] = "Event name is required."
    if not request.description:
        errors["description"] = "Event description is required."
    if not request.eventType:
        errors["eventType"] = "Event type is required."
    if request.preferredDate is None:
        errors["preferredDate"] = "Preferred date is required."
    elif request.preferredDate < today:
        errors["preferredDate"] = "Preferred date cannot be in the past."
    if request.startTime is None:
        errors["startTime"] = "Start time is required."
    if request.endTime is None:
        errors["endTime"] = "End time is required."
    elif request.startTime is not None and request.endTime <= request.startTime:
        errors["endTime"] = "End time must be later than start time."
    if request.expectedAttendance is None:
        errors["expectedAttendance"] = "Expected attendance must be a positive whole number."

    if not request.venue.location:
        errors["venue.location"] = "Venue location is required."
    if request.venue.capacity is None:
        errors["venue.capacity"] = "Venue capacity must be a positive whole number."
    if request.venue.layout is None:
        errors["venue.layout"] = "Venue layout is required."

    for i, item in enumerate(request.equipment):
        if not item.technicalRequirements:
            errors[f"equipment.{i}.technicalRequirements"] = "Equipment technical requirements are required."

    if request.registration.required:
        if request.registration.capacityLimit is None:
            errors["registration.capacityLimit"] = "Registration capacity must be a positive whole number."
        closing = request.registration.closingDate
        if closing is None:
            errors["registration.closingDate"] = "Registration closing date is required."
        elif closing < today:
            errors["registration.closingDate"] = "Registration closing date cannot be in the past."
        elif request.preferredDate is not None and request.preferredDate >= today and closing > request.preferredDate:
            # (an invalid event date already has its own error)
            # Attendees can't sign up for an event that has already happened.
            errors["registration.closingDate"] = "Registration must close on or before the event date."

    return errors


# ---------------------------------------------------------------- event output

class StatusChangeResponse(BaseModel):
    """One entry of an event's status history (US13), oldest first."""
    fromStatus: Optional[str] = None  # None for the first entry, when the event was created
    toStatus: str
    changedBy: str
    changedAt: datetime
    reason: Optional[str] = None


class EventEquipmentResponse(BaseModel):
    id: str
    qty: int
    technicalRequirements: str = ""


class EventResponse(BaseModel):
    """One event, named like `EventRecord` in lib/types.ts.

    Values the frontend works out itself (day of week, "submitted 2 days ago",
    registered count, activity log) are not included. Dates are ISO strings.
    """
    id: int
    status: str
    name: str
    organiserId: int
    organiser: str
    coordinatorId: Optional[int] = None
    coordinator: Optional[str] = None
    purpose: str = ""
    eventType: str = ""
    pax: Optional[int] = None
    date: Optional[Date] = None
    start: Optional[Time] = None
    end: Optional[Time] = None
    venueLocation: str = ""
    venueCapacity: Optional[int] = None
    layout: Optional[str] = None
    facilities: List[str] = []
    access: List[str] = []
    equip: List[EventEquipmentResponse] = []
    reg: bool = False
    regCap: Optional[int] = None
    regClose: Optional[Date] = None
    venue: Optional[int] = None
    bookingState: Optional[str] = None
    equipState: Optional[str] = None
    clarification: Optional[Dict[str, Any]] = None
    decision: Optional[Dict[str, Any]] = None
    draftForm: Optional[Dict[str, Any]] = None
    submittedAt: Optional[datetime] = None
    createdAt: datetime
    updatedAt: datetime

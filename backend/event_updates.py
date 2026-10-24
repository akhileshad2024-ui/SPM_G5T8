"""Planning detail updates (US16), separate from drafts and change requests.

AC1: only the assigned coordinator edits planning details.
AC4: identify arrangement-sensitive changes; this does NOT rebook/reapprove.
The API owns the transaction and AC2 history. US36 notification delivery is pending.
"""
# Implementation boundary: planning is submitted through approved, not a new AC
# defining every future workflow state. Confirmed-event direct editing is unopened.
# Use stored string values rather than importing ORM enums: this pure module
# must be importable without database configuration (including in unit-test CI).
PLANNING_STATUSES = {
    "submitted", "under_review", "pending_clarification", "approved",
}

# Public API field -> existing events column. Never allow ownership/status edits.
DETAIL_FIELDS = {
    "name": "name", "purpose": "purpose", "eventType": "event_type",
    "pax": "expected_attendance", "date": "date",
    "start": "start_time", "end": "end_time",
    "venueLocation": "venue_location", "venueCapacity": "venue_capacity",
    "layout": "layout", "facilities": "facilities", "access": "accessibility",
    "equip": "equipment", "reg": "registration_required",
    "regCap": "registration_cap", "regClose": "registration_close",
}

# Date/time/attendance/venue/equipment are named in the written requirements.
# Registration setting edits also concern an existing arrangement directly.
ARRANGEMENT_FIELDS = set(DETAIL_FIELDS) - {"name", "purpose", "eventType"}


class UpdateError(Exception):
    def __init__(self, status_code, message):
        super().__init__(message)
        self.status_code = status_code


def prepare_update(event, user, values, has_arrangements=False):
    """Return actual changes and their impact without changing the event.

    Unit tests use simple objects: no HTTP client or database is needed here.
    Existing arrangements make even a descriptive edit potentially important;
    the flag is a warning, not a claim that every booking is invalid.
    """
    if user.role != "coordinator" or event.coordinator_id != user.id:
        raise UpdateError(403, "Only the assigned Event Coordinator can edit these details.")
    if event.status not in PLANNING_STATUSES:
        raise UpdateError(409, "Direct detail editing is available only during planning.")
    if not set(values).issubset(DETAIL_FIELDS):
        raise UpdateError(422, "Only event-detail fields can be changed.")
    changes = {key: value for key, value in values.items()
               if getattr(event, DETAIL_FIELDS[key]) != value}
    affects = bool(changes) and (has_arrangements or bool(set(changes) & ARRANGEMENT_FIELDS))
    return changes, affects

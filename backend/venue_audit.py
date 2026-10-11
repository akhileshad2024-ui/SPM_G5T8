"""
US17 change-recording logic: what changed in a venue edit, what kind of change it
was, and the audit row that records it. Kept free of FastAPI so it can be unit
tested directly.
"""

from datetime import datetime

import models

# Fields tracked in the US17 audit trail (everything a Venue Staff member can edit).
AUDITED_FIELDS = (
    "name", "location", "cap", "layouts", "facilities", "accessibility",
    "operatingHours", "operatingDays", "unavailability", "setupMinutes", "turnaroundMinutes", "is_active",
)


def creation_changes(venue) -> dict:
    """Every audited field of a new venue, as {field: {"old": None, "new": value}}."""
    return {f: {"old": None, "new": getattr(venue, f)} for f in AUDITED_FIELDS}


def apply_update(venue, update_data: dict) -> dict:
    """Set each sent field that differs on `venue`; return {field: {"old", "new"}} for those only."""
    changes = {}
    for key, value in update_data.items():
        old = getattr(venue, key)
        if old != value:
            changes[key] = {"old": old, "new": value}
            setattr(venue, key, value)
    return changes


def change_action(changes: dict) -> str:
    """'deactivate' / 'reactivate' when is_active changed, otherwise 'edit'."""
    if "is_active" in changes:
        return "reactivate" if changes["is_active"]["new"] else "deactivate"
    return "edit"


def record_change(db, venue, action: str, editor_email: str, changes: dict, now: datetime) -> None:
    """Stamp the venue and add an audit row; committed together with the venue change."""
    venue.last_updated_by = editor_email
    venue.last_updated_at = now
    db.add(models.VenueChange(venue_id=venue.id, action=action, changed_by=editor_email, changed_at=now, changes=changes))

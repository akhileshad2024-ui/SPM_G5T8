"""
US15: which event details each role may see.

Whether a user may see an event at all is decided by event_access.py (US02/US13). This
module decides which of its fields they get. Fields a role may not see are left out of
the API response entirely (not sent as empty), so the page has nothing to show and the
data never reaches that user's browser.

Field names are those of schemas.EventResponse.
"""

from login.models import Role, User

# Every involved user: what the event is, when, who runs it, and how current the details are.
BASICS = {"id", "status", "name", "purpose", "eventType", "date", "start", "end",
          "organiserId", "organiser", "updatedAt"}
# Staff working on the event: who coordinates it and how many people to plan for.
STAFF = {"coordinatorId", "coordinator", "pax"}
VENUE_NEEDS = {"venueLocation", "venueCapacity", "layout", "facilities"}
ACCESSIBILITY = {"access"}
BOOKING = {"venue", "venueName", "bookingState"}
VENUE_NAME = {"venueName"}  # where it takes place, without the booking details
EQUIPMENT = {"equip", "equipState"}
REGISTRATION = {"reg", "regCap", "regClose", "registered", "withdrawalClose"}
REVIEW = {"clarification", "decision", "submittedAt", "createdAt"}  # between organiser and coordinator
DRAFT = {"draftForm"}  # the organiser's unfinished form values

VISIBLE_FIELDS: dict[Role, frozenset[str]] = {
    Role.organiser: frozenset(BASICS | STAFF | VENUE_NEEDS | ACCESSIBILITY | BOOKING | EQUIPMENT
                              | REGISTRATION | REVIEW | DRAFT),
    Role.coordinator: frozenset(BASICS | STAFF | VENUE_NEEDS | ACCESSIBILITY | BOOKING | EQUIPMENT
                                | REGISTRATION | REVIEW),
    Role.venue: frozenset(BASICS | STAFF | VENUE_NEEDS | ACCESSIBILITY | BOOKING),
    Role.tech: frozenset(BASICS | STAFF | VENUE_NAME | EQUIPMENT),
    Role.attendee: frozenset(BASICS | ACCESSIBILITY | VENUE_NAME | REGISTRATION),
}


def visible_fields(user: User) -> frozenset[str]:
    """The event fields `user`'s role may see (nothing for an unknown role)."""
    return VISIBLE_FIELDS.get(user.role, frozenset())


def for_role(event: dict, user: User) -> dict:
    """`event` (a full EventResponse as a dict) with only the fields `user` may see."""
    allowed = visible_fields(user)
    return {name: value for name, value in event.items() if name in allowed}

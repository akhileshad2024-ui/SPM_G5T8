"""
US15 AC1/AC2: which event fields each role may see, in backend/event_fields.py.

The expected fields for each role are written out here independently of the module, from
the field table agreed for US15, so a change to the rules has to be made in both places.
"""

from types import SimpleNamespace

import pytest

import schemas
from event_fields import VISIBLE_FIELDS, for_role, visible_fields
from login.models import Role

ALL_FIELDS = set(schemas.EventResponse.model_fields)

# Every involved user: name, status, date/time, description, type, organiser, last updated.
EVERYONE = {"id", "status", "name", "purpose", "eventType", "date", "start", "end",
            "organiserId", "organiser", "updatedAt"}

EXPECTED = {
    Role.organiser: ALL_FIELDS,
    Role.coordinator: ALL_FIELDS - {"draftForm"},
    Role.venue: EVERYONE | {"coordinatorId", "coordinator", "pax",
                            "venueLocation", "venueCapacity", "layout", "facilities", "access",
                            "venue", "venueName", "bookingState"},
    Role.tech: EVERYONE | {"coordinatorId", "coordinator", "pax", "venueName", "equip", "equipState"},
    Role.attendee: EVERYONE | {"access", "venueName", "reg", "regCap", "regClose"},
}


def user(role):
    return SimpleNamespace(id=1, role=role)


def full_event() -> dict:
    """Every EventResponse field, each with a distinct value."""
    return {name: f"value of {name}" for name in ALL_FIELDS}


@pytest.mark.parametrize("role", list(Role), ids=lambda r: r.value)
def test_each_role_sees_exactly_the_agreed_fields(role):
    assert visible_fields(user(role)) == EXPECTED[role]


def test_every_role_has_a_rule():
    assert set(VISIBLE_FIELDS) == set(Role)


def test_every_rule_names_real_fields():
    """A typo in a field name would silently hide that field from everyone."""
    for role, fields in VISIBLE_FIELDS.items():
        assert fields <= ALL_FIELDS, (role, fields - ALL_FIELDS)


def test_every_field_is_visible_to_someone():
    assert set().union(*VISIBLE_FIELDS.values()) == ALL_FIELDS


@pytest.mark.parametrize("role", list(Role), ids=lambda r: r.value)
def test_every_role_sees_the_basics_and_the_last_updated_time(role):
    assert EVERYONE <= visible_fields(user(role))


def test_only_the_organiser_sees_their_unfinished_draft_form():
    assert [r for r in Role if "draftForm" in visible_fields(user(r))] == [Role.organiser]


def test_review_notes_stay_between_organiser_and_coordinator():
    for field in ("clarification", "decision", "submittedAt", "createdAt"):
        assert {r for r in Role if field in visible_fields(user(r))} == {Role.organiser, Role.coordinator}, field


def test_tech_and_attendees_see_where_the_event_is_but_not_the_booking():
    for role in (Role.tech, Role.attendee):
        fields = visible_fields(user(role))
        assert "venueName" in fields
        assert not fields & {"venue", "bookingState"}, role


@pytest.mark.parametrize("role", list(Role), ids=lambda r: r.value)
def test_for_role_leaves_hidden_fields_out_rather_than_blanking_them(role):
    event = full_event()

    shown = for_role(event, user(role))

    assert set(shown) == EXPECTED[role]
    assert all(shown[name] == event[name] for name in shown)  # visible values pass through unchanged
    assert None not in shown.values()


def test_for_role_keeps_visible_fields_that_have_no_value():
    event = full_event() | {"coordinator": None, "venueName": None, "facilities": []}

    shown = for_role(event, user(Role.venue))

    assert shown["coordinator"] is None
    assert shown["venueName"] is None
    assert shown["facilities"] == []


def test_for_role_does_not_change_the_full_event():
    event = full_event()

    for_role(event, user(Role.attendee))

    assert event == full_event()


def test_an_account_with_an_unknown_role_sees_no_fields():
    stranger = SimpleNamespace(id=999, role="guest")

    assert visible_fields(stranger) == frozenset()
    assert for_role(full_event(), stranger) == {}

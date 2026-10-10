"""
US13 AC1/AC4 (and US02): who is involved in an event, in backend/event_access.py.

The rule is written twice: involved_events() filters a database query (GET /events) and
is_involved() checks one loaded event (GET /events/{id}/history). These tests build every
combination of the fields the rule looks at and check, for each role, that both versions
give the same answer and that the answer is the documented rule.
"""

from itertools import product
from types import SimpleNamespace

import pytest

import models
from auth_testkit import get_user
from event_access import involved_events, is_involved
from login.models import Role

S = models.EventStatus


def expected(event, user):
    """The rule as event_access.py documents it, written out independently."""
    if user.role == Role.organiser:
        return event.organiser_id == user.id
    if event.status == S.draft:
        return False  # drafts are only ever visible to their organiser
    if user.role == Role.coordinator:
        assigned_to_me = event.coordinator_id == user.id
        awaiting_pickup = event.coordinator_id is None and event.status == S.submitted
        return assigned_to_me or awaiting_pickup
    if user.role == Role.venue:
        return event.venue_id is not None
    if user.role == Role.tech:
        return event.equipment_state is not None
    if user.role == Role.attendee:
        return event.status == S.confirmed and event.registration_required
    return False


@pytest.fixture
def every_kind_of_event(db):
    """One event for each combination of the fields the involvement rule depends on."""
    organiser = get_user(db, Role.organiser)
    coordinator = get_user(db, Role.coordinator)
    other_organiser_id = get_user(db, Role.tech).id      # any other existing user id
    other_coordinator_id = get_user(db, Role.attendee).id

    venue = models.Venue(name="Grand Hall", location="Central", cap=300, last_updated_by="test")
    db.add(venue)
    db.flush()

    combos = product(
        S,                                                   # status
        [organiser.id, other_organiser_id],                  # organiser
        [None, coordinator.id, other_coordinator_id],        # coordinator
        [None, venue.id],                                    # venue booking
        [None, "requested"],                                 # equipment
        [False, True],                                       # registration open
    )
    for status, organiser_id, coordinator_id, venue_id, equipment_state, registration in combos:
        db.add(models.Event(
            name=f"{status.value}", status=status, organiser_id=organiser_id, coordinator_id=coordinator_id,
            venue_id=venue_id, equipment_state=equipment_state, registration_required=registration,
            facilities=[], accessibility=[], equipment=[],
        ))
    db.commit()
    return db.query(models.Event).all(), other_coordinator_id


@pytest.mark.parametrize("role", list(Role), ids=lambda r: r.value)
def test_list_and_single_event_rules_agree_with_the_documented_rule(db, every_kind_of_event, role):
    events, _ = every_kind_of_event
    user = get_user(db, role)

    listed = {e.id for e in involved_events(db.query(models.Event), user).all()}
    one_by_one = {e.id for e in events if is_involved(e, user)}
    documented = {e.id for e in events if expected(e, user)}

    assert len(events) == 8 * 2 * 3 * 2 * 2 * 2
    assert listed == one_by_one, "GET /events and GET /events/{id}/history would disagree"
    assert listed == documented


@pytest.mark.parametrize("role", list(Role), ids=lambda r: r.value)
def test_nobody_but_the_organiser_ever_sees_a_draft(db, every_kind_of_event, role):
    events, _ = every_kind_of_event
    user = get_user(db, role)

    visible_drafts = [e for e in involved_events(db.query(models.Event), user).all() if e.status == S.draft]

    if role == Role.organiser:
        assert visible_drafts and all(e.organiser_id == user.id for e in visible_drafts)
    else:
        assert visible_drafts == []


def test_an_account_with_an_unknown_role_is_involved_in_nothing(db, every_kind_of_event):
    events, _ = every_kind_of_event
    stranger = SimpleNamespace(id=999, role="guest")

    assert involved_events(db.query(models.Event), stranger).all() == []
    assert not any(is_involved(e, stranger) for e in events)

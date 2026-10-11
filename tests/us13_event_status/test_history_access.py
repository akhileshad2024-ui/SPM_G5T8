"""
US13 — GET /events/{id}/history: what each entry says (AC3) and that people who aren't
involved in an event are refused its history (AC4), role by role.
"""

from datetime import datetime

import pytest

import models
from login.models import Role

from test_status_history import add_user, create, history, move, seed

S = models.EventStatus


def refused(session, event_id):
    response = session.get(f"/events/{event_id}/history")
    return response.status_code == 403 and response.json()["detail"] == "You don't have permission to do that"


# ---------------------------------------------------------------- AC3: what each entry says

def test_each_entry_names_the_person_who_made_the_change(signed_in, db):
    organiser = signed_in(Role.organiser)
    event_id = create(organiser)
    move(db, event_id, S.under_review, by=Role.coordinator)

    entries = history(organiser, event_id)

    assert [e["changedBy"] for e in entries] == ["Maya Rahman", "Priya Tan"]


def test_each_timestamp_includes_its_time_zone(signed_in):
    organiser = signed_in(Role.organiser)
    event_id = create(organiser)

    changed_at = datetime.fromisoformat(history(organiser, event_id)[0]["changedAt"].replace("Z", "+00:00"))

    assert changed_at.utcoffset() is not None, "browsers would read a time without a zone as local time"


def test_a_change_without_a_reason_has_none(signed_in, db):
    organiser = signed_in(Role.organiser)
    event_id = create(organiser)
    move(db, event_id, S.under_review)

    assert [e["reason"] for e in history(organiser, event_id)] == [None, None]


def test_the_history_endpoint_returns_only_that_events_changes(signed_in, db):
    organiser = signed_in(Role.organiser)
    first, second = create(organiser), create(organiser)
    move(db, second, S.under_review, S.approved)

    assert len(history(organiser, first)) == 1
    assert len(history(organiser, second)) == 3


# ---------------------------------------------------------------- AC4: not involved -> refused

def test_an_organiser_cannot_see_another_organisers_history(signed_in, db):
    event_id = create(signed_in(Role.organiser))
    other = add_user(db, "lin.chen@connectsphere.edu", "Lin Chen", Role.organiser)

    assert refused(other, event_id)


def test_a_coordinator_cannot_see_an_event_assigned_to_another_coordinator(signed_in, db):
    event_id = create(signed_in(Role.organiser))
    move(db, event_id, S.under_review)
    other = add_user(db, "marcus.lee@connectsphere.edu", "Marcus Lee", Role.coordinator)
    seed(db, event_id, coordinator_id=other.get("/auth/me").json()["id"])

    coordinator = signed_in(Role.coordinator)
    assert refused(coordinator, event_id)
    assert event_id not in [e["id"] for e in coordinator.get("/events").json()]


def test_a_coordinator_sees_an_unassigned_event_under_review_so_it_can_still_be_assigned(signed_in, db):
    event_id = create(signed_in(Role.organiser))
    move(db, event_id, S.under_review)

    assert [e["toStatus"] for e in history(signed_in(Role.coordinator), event_id)] == ["submitted", "under_review"]


def test_a_coordinator_sees_the_history_once_the_event_is_assigned_to_them(signed_in, db):
    event_id = create(signed_in(Role.organiser))
    move(db, event_id, S.under_review)
    seed(db, event_id, coordinator_id=signed_in(Role.coordinator).get("/auth/me").json()["id"])

    assert [e["toStatus"] for e in history(signed_in(Role.coordinator), event_id)] == ["submitted", "under_review"]


def test_venue_staff_cannot_see_an_event_without_a_venue_booking(signed_in):
    event_id = create(signed_in(Role.organiser))

    assert refused(signed_in(Role.venue), event_id)


def test_technical_support_cannot_see_an_event_without_equipment(signed_in):
    event_id = create(signed_in(Role.organiser), equipment=[])

    assert refused(signed_in(Role.tech), event_id)


@pytest.mark.parametrize("registration_open, status", [
    (True, S.approved),     # approved but not yet confirmed
    (False, S.confirmed),   # confirmed but registration is off
])
def test_attendees_cannot_see_events_that_are_not_open_to_them(signed_in, db, registration_open, status):
    event_id = create(signed_in(Role.organiser))
    seed(db, event_id, registration_required=registration_open)
    path = [S.under_review, S.approved] + ([S.confirmed] if status == S.confirmed else [])
    move(db, event_id, *path)

    attendee = signed_in(Role.attendee)
    assert refused(attendee, event_id)
    assert event_id not in [e["id"] for e in attendee.get("/events").json()]


@pytest.mark.parametrize("role", [Role.coordinator, Role.venue, Role.tech, Role.attendee], ids=lambda r: r.value)
def test_nobody_but_the_organiser_can_see_a_drafts_history(signed_in, db, role):
    event_id = create(signed_in(Role.organiser), submit=False)
    seed(db, event_id, venue_id=None, registration_required=True)

    assert refused(signed_in(role), event_id)

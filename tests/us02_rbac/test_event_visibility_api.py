"""
US02 — "can view only the events they are associated with or authorised to see" (backend).

GET /events returns only the events the signed-in user is involved in; the rule lives in
backend/event_access.py. One fixed set of events is seeded below, and each role's expected
list is written out by hand from the rule:

    organiser          their own events, drafts included
    coordinator        events assigned to them + submitted events nobody has picked up yet
    venue staff        events with a venue booking
    technical support  events that request equipment
    attendee           confirmed events open for registration
    (nobody but the organiser ever sees a draft)
"""

import pytest

import models
from auth_testkit import PASSWORD, get_user
from login import security
from login.models import Role, User

S = models.EventStatus

# name: (organiser, status, coordinator, venue booked, equipment requested, registration open)
#   organiser:   "maya" = the signed-in organiser, "other" = another organiser
#   coordinator: "priya" = the signed-in coordinator, "other" = another coordinator, None = unassigned
EVENTS = {
    "draft_mine":         ("maya",  S.draft,        None,    True,  True,  True),
    "submitted_mine":     ("maya",  S.submitted,    None,    False, True,  False),
    "submitted_other":    ("other", S.submitted,    None,    False, False, False),
    "review_priya":       ("other", S.under_review, "priya", False, False, False),
    "review_other_coord": ("maya",  S.under_review, "other", False, False, False),
    "review_unassigned":  ("other", S.under_review, None,    False, True,  False),
    "approved_booked":    ("maya",  S.approved,     "priya", True,  True,  True),
    "confirmed_open":     ("other", S.confirmed,    "priya", True,  False, True),
    "confirmed_closed":   ("other", S.confirmed,    "other", True,  False, False),
    "cancelled_booked":   ("other", S.cancelled,    None,    True,  True,  False),
}

VISIBLE_TO = {
    Role.organiser:   {"draft_mine", "submitted_mine", "review_other_coord", "approved_booked"},
    Role.coordinator: {"submitted_mine", "submitted_other", "review_priya", "approved_booked", "confirmed_open"},
    Role.venue:       {"approved_booked", "confirmed_open", "confirmed_closed", "cancelled_booked"},
    Role.tech:        {"submitted_mine", "review_unassigned", "approved_booked", "cancelled_booked"},
    Role.attendee:    {"confirmed_open"},
}


def add_user(db, email, name, role):
    user = User(email=email, name=name, role=role, password_hash=security.hash_password(PASSWORD),
                is_active=True, failed_login_attempts=0, session_version=0)
    db.add(user)
    db.flush()
    return user.id


@pytest.fixture
def seeded(db):
    """The events above, stored straight in the database; returns name -> event id."""
    ids = {
        "maya": get_user(db, Role.organiser).id,
        "priya": get_user(db, Role.coordinator).id,
    }
    other_organiser = add_user(db, "lin.chen@connectsphere.edu", "Lin Chen", Role.organiser)
    other_coordinator = add_user(db, "marcus.lee@connectsphere.edu", "Marcus Lee", Role.coordinator)
    venue = models.Venue(name="Grand Hall", building="Central", cap=300, last_updated_by="test")
    db.add(venue)
    db.flush()

    event_ids = {}
    for name, (organiser, status, coordinator, booked, equipment, registration) in EVENTS.items():
        event = models.Event(
            name=name, status=status,
            organiser_id=ids["maya"] if organiser == "maya" else other_organiser,
            coordinator_id={"priya": ids["priya"], "other": other_coordinator, None: None}[coordinator],
            venue_id=venue.id if booked else None,
            booking_state="approved" if booked else None,
            equipment=[{"id": "E2", "qty": 1, "technicalRequirements": "HDMI"}] if equipment else [],
            equipment_state="requested" if equipment else None,
            registration_required=registration,
            facilities=[], accessibility=[],
        )
        db.add(event)
        db.flush()
        event_ids[name] = event.id
    db.commit()
    return event_ids


def visible_names(session, event_ids):
    response = session.get("/events")
    assert response.status_code == 200, response.text
    names_by_id = {v: k for k, v in event_ids.items()}
    return {names_by_id[e["id"]] for e in response.json()}


@pytest.mark.parametrize("role", list(Role), ids=lambda r: r.value)
def test_each_role_sees_exactly_the_events_it_is_associated_with(signed_in, seeded, role):
    assert visible_names(signed_in(role), seeded) == VISIBLE_TO[role]


@pytest.mark.parametrize("role", [r for r in Role if r is not Role.organiser], ids=lambda r: r.value)
def test_no_other_role_sees_a_draft_even_when_it_matches_their_rule(signed_in, seeded, role):
    # draft_mine has a venue booking, equipment and open registration, but is still a draft
    assert "draft_mine" not in visible_names(signed_in(role), seeded)


def test_an_organiser_never_sees_another_organisers_events(signed_in, seeded):
    others = {name for name, spec in EVENTS.items() if spec[0] == "other"}

    assert visible_names(signed_in(Role.organiser), seeded).isdisjoint(others)


def test_a_coordinator_does_not_see_events_assigned_to_another_coordinator(signed_in, seeded):
    visible = visible_names(signed_in(Role.coordinator), seeded)

    assert "review_other_coord" not in visible
    assert "confirmed_closed" not in visible


def test_a_coordinator_only_sees_unassigned_events_while_they_await_pickup(signed_in, seeded):
    visible = visible_names(signed_in(Role.coordinator), seeded)

    assert {"submitted_mine", "submitted_other"} <= visible
    assert "review_unassigned" not in visible   # already under review, but not assigned to them
    assert "cancelled_booked" not in visible


def test_attendees_see_only_confirmed_events_with_registration_open(signed_in, seeded):
    visible = visible_names(signed_in(Role.attendee), seeded)

    assert "approved_booked" not in visible      # registration open, but not confirmed yet
    assert "confirmed_closed" not in visible     # confirmed, but registration is off
    assert visible == {"confirmed_open"}


def test_the_rule_follows_a_role_change_immediately(signed_in, seeded, db):
    session = signed_in(Role.venue)
    assert visible_names(session, seeded) == VISIBLE_TO[Role.venue]

    user = get_user(db, Role.venue)
    user.role = Role.attendee
    db.commit()

    assert visible_names(session, seeded) == VISIBLE_TO[Role.attendee]


def test_signed_out_users_cannot_list_events(client, seeded):
    assert client.get("/events").status_code == 401

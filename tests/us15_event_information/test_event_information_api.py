"""
US15: GET /events/{id} and GET /events give each role the event's latest saved details,
with the fields their role may not see left out (not sent as empty) and a last-updated time.

    AC1  view the current event information permitted for their role
    AC2  fields not permitted for the role are hidden rather than shown as empty
    AC3  the most recently saved values, with a last-updated timestamp
    AC4  the same information other authorised users see at the same time
"""

from datetime import date, datetime, time, timedelta, timezone

import pytest

import models
from auth_testkit import get_user
from login.models import Role

S = models.EventStatus

EVERYONE = {"id", "status", "name", "purpose", "eventType", "date", "start", "end",
            "organiserId", "organiser", "updatedAt"}
EXPECTED = {
    Role.organiser: EVERYONE | {"coordinatorId", "coordinator", "pax",
                                "venueLocation", "venueCapacity", "layout", "facilities", "access",
                                "venue", "venueName", "bookingState", "equip", "equipState",
                                "reg", "regCap", "regClose", "registered", "withdrawalClose",
                                "clarification", "decision", "submittedAt", "createdAt", "draftForm"},
    Role.coordinator: EVERYONE | {"coordinatorId", "coordinator", "pax",
                                  "venueLocation", "venueCapacity", "layout", "facilities", "access",
                                  "venue", "venueName", "bookingState", "equip", "equipState",
                                  "reg", "regCap", "regClose", "registered", "withdrawalClose",
                                  "clarification", "decision", "submittedAt", "createdAt"},
    Role.venue: EVERYONE | {"coordinatorId", "coordinator", "pax",
                            "venueLocation", "venueCapacity", "layout", "facilities", "access",
                            "venue", "venueName", "bookingState"},
    Role.tech: EVERYONE | {"coordinatorId", "coordinator", "pax", "venueName", "equip", "equipState"},
    Role.attendee: EVERYONE | {"access", "venueName", "reg", "regCap", "regClose", "registered", "withdrawalClose"},
}


def parse(timestamp: str) -> datetime:
    return datetime.fromisoformat(timestamp.replace("Z", "+00:00"))


@pytest.fixture
def venue(db):
    hall = models.Venue(name="Grand Hall", location="Central", cap=300, last_updated_by="test")
    db.add(hall)
    db.commit()
    return hall


@pytest.fixture
def confirmed_event(db, venue):
    """A confirmed event every role is involved in, with every field filled in."""
    event = models.Event(
        status=S.confirmed,
        organiser_id=get_user(db, Role.organiser).id,
        coordinator_id=get_user(db, Role.coordinator).id,
        name="Startup Pitch Night",
        purpose="Eight student ventures pitch to investors.",
        event_type="networking",
        expected_attendance=95,
        date=date(2026, 11, 26),
        start_time=time(18, 30),
        end_time=time(21, 0),
        venue_location="Central campus",
        venue_capacity=120,
        layout="standing",
        facilities=["Projector"],
        accessibility=["Step-free access"],
        equipment=[{"id": "E1", "qty": 2, "technicalRequirements": "HDMI to stage"}],
        registration_required=True,
        registration_cap=120,
        registration_close=date(2026, 11, 20),
        venue_id=venue.id,
        booking_state="approved",
        equipment_state="reserved",
        clarification={"kind": "clarification", "message": "Which investors?",
                       "requestedBy": "Priya Tan", "requestedAt": "2026-10-01T02:00:00Z"},
        decision={"outcome": "approved", "reason": "Well planned", "by": "Priya Tan", "at": "2026-10-02T02:00:00Z"},
        submitted_at=datetime(2026, 9, 30, 2, 0, tzinfo=timezone.utc),
    )
    db.add(event)
    db.commit()
    return event.id


@pytest.fixture
def new_request(db):
    """A submitted request nobody has picked up: no coordinator, no venue, no equipment."""
    event = models.Event(
        status=S.submitted, organiser_id=get_user(db, Role.organiser).id, name="Quiet reading hour",
        facilities=[], accessibility=[], equipment=[], registration_required=False,
        submitted_at=datetime(2026, 10, 1, 2, 0, tzinfo=timezone.utc),
    )
    db.add(event)
    db.commit()
    return event.id


def get_event(session, event_id):
    response = session.get(f"/events/{event_id}")
    assert response.status_code == 200, response.text
    return response.json()


def listed(session, event_id):
    response = session.get("/events")
    assert response.status_code == 200, response.text
    return next(e for e in response.json() if e["id"] == event_id)


# ---------------------------------------------------------------- AC1 / AC2: role-permitted fields

@pytest.mark.parametrize("role", list(Role), ids=lambda r: r.value)
def test_each_role_gets_exactly_the_fields_permitted_for_it(signed_in, confirmed_event, role):
    assert set(get_event(signed_in(role), confirmed_event)) == EXPECTED[role]


@pytest.mark.parametrize("role", list(Role), ids=lambda r: r.value)
def test_the_event_list_gives_the_same_fields(signed_in, confirmed_event, role):
    assert set(listed(signed_in(role), confirmed_event)) == EXPECTED[role]


def test_the_organiser_sees_every_saved_detail_of_their_event(signed_in, db, confirmed_event):
    event = get_event(signed_in(Role.organiser), confirmed_event)

    assert event["name"] == "Startup Pitch Night"
    assert event["purpose"] == "Eight student ventures pitch to investors."
    assert event["date"] == "2026-11-26"
    assert (event["start"], event["end"]) == ("18:30:00", "21:00:00")
    assert event["organiser"] == "Maya Rahman"
    assert event["coordinator"] == "Priya Tan"
    assert event["pax"] == 95
    assert event["venueName"] == "Grand Hall"
    assert event["bookingState"] == "approved"
    assert event["equip"] == [{"id": "E1", "qty": 2, "technicalRequirements": "HDMI to stage"}]
    assert event["equipState"] == "reserved"
    assert (event["reg"], event["regCap"], event["regClose"]) == (True, 120, "2026-11-20")
    assert event["decision"]["reason"] == "Well planned"
    assert event["clarification"]["message"] == "Which investors?"


def test_attendees_see_the_public_details_and_nothing_internal(signed_in, confirmed_event):
    event = get_event(signed_in(Role.attendee), confirmed_event)

    assert event["venueName"] == "Grand Hall"
    assert event["access"] == ["Step-free access"]
    assert (event["reg"], event["regCap"], event["regClose"]) == (True, 120, "2026-11-20")
    for hidden in ("coordinator", "pax", "equip", "equipState", "venue", "bookingState",
                   "decision", "clarification", "draftForm", "venueCapacity"):
        assert hidden not in event, hidden  # left out, not sent as null


def test_tech_support_sees_equipment_and_where_but_not_the_booking(signed_in, confirmed_event):
    event = get_event(signed_in(Role.tech), confirmed_event)

    assert event["equip"] == [{"id": "E1", "qty": 2, "technicalRequirements": "HDMI to stage"}]
    assert event["equipState"] == "reserved"
    assert event["venueName"] == "Grand Hall"
    for hidden in ("venue", "bookingState", "reg", "regCap", "access", "decision"):
        assert hidden not in event, hidden


def test_venue_staff_see_the_venue_needs_but_not_equipment_or_registration(signed_in, confirmed_event, venue):
    event = get_event(signed_in(Role.venue), confirmed_event)

    assert (event["venue"], event["venueName"], event["bookingState"]) == (venue.id, "Grand Hall", "approved")
    assert (event["venueCapacity"], event["layout"], event["facilities"]) == (120, "standing", ["Projector"])
    for hidden in ("equip", "equipState", "reg", "regCap", "regClose", "registered", "withdrawalClose", "decision", "clarification"):
        assert hidden not in event, hidden


def test_a_permitted_field_with_no_value_is_sent_empty_not_left_out(signed_in, new_request):
    event = get_event(signed_in(Role.coordinator), new_request)

    assert event["coordinator"] is None
    assert event["venueName"] is None
    assert event["bookingState"] is None
    assert event["equip"] == []
    assert event["decision"] is None
    assert set(event) == EXPECTED[Role.coordinator]


def test_only_the_organiser_gets_their_draft_form(signed_in, db):
    organiser = signed_in(Role.organiser)
    created = organiser.post("/events", json={"submit": False, "name": "Half done", "draftForm": {"step": 2}})
    assert created.status_code == 201, created.text

    assert get_event(organiser, created.json()["id"])["draftForm"] == {"step": 2}


# ---------------------------------------------------------------- AC3: latest saved values, last updated

def test_the_last_updated_time_is_the_saved_one_and_says_it_is_utc(signed_in, db, confirmed_event):
    stored = db.get(models.Event, confirmed_event).updated_at

    updated_at = get_event(signed_in(Role.attendee), confirmed_event)["updatedAt"]

    assert parse(updated_at).tzinfo is not None
    assert parse(updated_at).replace(tzinfo=None) == stored.replace(tzinfo=None)


def test_an_edit_shows_the_new_values_and_a_later_last_updated_time(signed_in, db):
    organiser = signed_in(Role.organiser)
    event_id = organiser.post("/events", json={"submit": False, "name": "First name"}).json()["id"]
    event = db.get(models.Event, event_id)
    event.updated_at = datetime(2026, 1, 1, tzinfo=timezone.utc)  # saved a while ago
    db.commit()
    before = parse(get_event(organiser, event_id)["updatedAt"])

    saved = organiser.put(f"/events/{event_id}", json={"submit": False, "name": "Second name", "expectedAttendance": 40})
    assert saved.status_code == 200, saved.text

    after = get_event(organiser, event_id)
    assert after["name"] == "Second name"
    assert after["pax"] == 40
    assert parse(after["updatedAt"]) > before


def test_a_change_saved_elsewhere_shows_on_the_next_view(signed_in, db, confirmed_event):
    attendee = signed_in(Role.attendee)
    assert get_event(attendee, confirmed_event)["regCap"] == 120

    event = db.get(models.Event, confirmed_event)
    event.registration_cap = 150
    db.commit()

    assert get_event(attendee, confirmed_event)["regCap"] == 150


# ---------------------------------------------------------------- AC4: consistent across users

def test_every_role_sees_the_same_values_for_the_fields_they_share(signed_in, confirmed_event):
    views = {role: get_event(signed_in(role), confirmed_event) for role in Role}
    full = views[Role.organiser]

    for role, event in views.items():
        assert {name: full[name] for name in event} == event, role


def test_after_a_submit_organiser_and_coordinator_see_the_same_saved_request(signed_in):
    organiser = signed_in(Role.organiser)
    event_id = organiser.post("/events", json={"submit": False, "name": "Draft name"}).json()["id"]
    soon = date.today() + timedelta(days=60)
    submitted = organiser.put(f"/events/{event_id}", json={
        "submit": True, "name": "Robotics Showcase", "description": "Student robots on show.",
        "eventType": "Exhibition", "expectedAttendance": 80, "preferredDate": soon.isoformat(),
        "startTime": "10:00", "endTime": "16:00",
        "venue": {"location": "Central campus", "capacity": 100, "layout": "standing",
                  "accessibility": [], "facilities": ["Power outlets"]},
    })
    assert submitted.status_code == 200, submitted.text

    mine = get_event(organiser, event_id)
    theirs = get_event(signed_in(Role.coordinator), event_id)

    assert theirs["name"] == mine["name"] == "Robotics Showcase"
    assert theirs["status"] == mine["status"] == "submitted"
    assert theirs["updatedAt"] == mine["updatedAt"]
    assert {name: mine[name] for name in theirs} == theirs


@pytest.mark.parametrize("role", list(Role), ids=lambda r: r.value)
def test_the_list_and_the_details_view_agree(signed_in, confirmed_event, role):
    session = signed_in(role)

    assert listed(session, confirmed_event) == get_event(session, confirmed_event)


# ---------------------------------------------------------------- who may open an event

@pytest.mark.parametrize("role", [Role.venue, Role.tech, Role.attendee], ids=lambda r: r.value)
def test_staff_not_involved_in_the_event_are_refused(signed_in, new_request, role):
    response = signed_in(role).get(f"/events/{new_request}")

    assert response.status_code == 403
    assert response.json()["detail"] == "You don't have permission to do that"


def test_another_organisers_event_is_refused(signed_in, db, confirmed_event):
    event = db.get(models.Event, confirmed_event)
    event.organiser_id = get_user(db, Role.tech).id  # someone else's request
    db.commit()

    assert signed_in(Role.organiser).get(f"/events/{confirmed_event}").status_code == 403


def test_a_draft_is_refused_to_everyone_but_its_organiser(signed_in):
    organiser = signed_in(Role.organiser)
    draft = organiser.post("/events", json={"submit": False, "name": "Secret plan"}).json()["id"]

    assert organiser.get(f"/events/{draft}").status_code == 200
    for role in (Role.coordinator, Role.venue, Role.tech, Role.attendee):
        assert signed_in(role).get(f"/events/{draft}").status_code == 403, role


def test_an_event_that_does_not_exist_is_not_found(signed_in):
    response = signed_in(Role.coordinator).get("/events/9999")

    assert response.status_code == 404
    assert response.json()["detail"] == "Event not found"


def test_signed_out_users_cannot_view_an_event(client, confirmed_event):
    assert client.get(f"/events/{confirmed_event}").status_code == 401

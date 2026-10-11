"""
GET /events: stored requests come back after a reload (US03), and the server decides who
may see which (US02): organisers only their own, attendees only published events open for
registration, other staff everything except drafts.
"""

from fastapi.testclient import TestClient

import models
from auth_testkit import PASSWORD, get_user, login
from login import security
from login.models import Role, User
from main import app
from test_create_event import full_request


def create(session, **overrides):
    response = session.post("/events", json=full_request(**overrides))
    assert response.status_code == 201, response.text
    return response.json()["id"]


def ids(session):
    response = session.get("/events")
    assert response.status_code == 200, response.text
    return sorted(e["id"] for e in response.json())


def publish(db, event_id, status=models.EventStatus.confirmed):
    event = db.get(models.Event, event_id)
    event.status = status
    db.commit()


def test_an_organisers_saved_requests_come_back(signed_in):
    organiser = signed_in(Role.organiser)
    draft = create(organiser, submit=False, name="My draft")
    submitted = create(organiser, submit=True)

    events = {e["id"]: e for e in organiser.get("/events").json()}

    assert set(events) == {draft, submitted}
    assert events[draft]["status"] == "draft"
    assert events[draft]["draftForm"] is None or isinstance(events[draft]["draftForm"], dict)
    assert events[submitted]["status"] == "submitted"
    assert events[submitted]["name"] == "Startup Pitch Night"


def test_organisers_see_only_their_own_requests(signed_in, db):
    maya_event = create(signed_in(Role.organiser))
    db.add(User(email="lin.chen@connectsphere.edu", name="Lin Chen", role=Role.organiser,
                password_hash=security.hash_password(PASSWORD), is_active=True,
                failed_login_attempts=0, session_version=0))
    db.commit()
    lin = TestClient(app)
    login(lin, "lin.chen@connectsphere.edu")
    lin_event = create(lin, name="Lin's symposium")

    assert ids(signed_in(Role.organiser)) == [maya_event]
    assert ids(lin) == [lin_event]


def test_drafts_stay_private_to_their_organiser(signed_in):
    organiser = signed_in(Role.organiser)
    draft = create(organiser, submit=False)  # requests equipment too, like the submitted one
    submitted = create(organiser, submit=True)

    # Staff see only events they are involved in (US13); a draft is never one of them.
    assert ids(signed_in(Role.coordinator)) == [submitted]  # submitted and not yet picked up
    assert ids(signed_in(Role.tech)) == [submitted]  # requests equipment
    assert ids(signed_in(Role.venue)) == []  # no venue booking yet
    for role in (Role.coordinator, Role.venue, Role.tech):
        assert draft not in ids(signed_in(role)), role


def test_attendees_see_only_confirmed_events_open_for_registration(signed_in, db):
    organiser = signed_in(Role.organiser)
    create(organiser, submit=False)
    under_review = create(organiser, submit=True)
    approved = create(organiser, submit=True)
    published = create(organiser, submit=True)
    published_no_registration = create(organiser, submit=True, registration={"required": False})
    publish(db, approved, models.EventStatus.approved)
    publish(db, published)
    publish(db, published_no_registration)

    attendee_sees = ids(signed_in(Role.attendee))

    assert attendee_sees == [published]
    assert under_review not in attendee_sees
    assert approved not in attendee_sees  # still being arranged: venue or date may change


def test_signed_out_users_cannot_list_events(client):
    assert client.get("/events").status_code == 401


def test_listing_shows_names_not_ids(signed_in, db):
    create(signed_in(Role.organiser))

    event = signed_in(Role.coordinator).get("/events").json()[0]

    assert event["organiser"] == "Maya Rahman"
    assert event["organiserId"] == get_user(db, Role.organiser).id

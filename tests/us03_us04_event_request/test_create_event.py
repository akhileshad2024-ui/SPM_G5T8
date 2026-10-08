"""
POST /events: an organiser saves a draft (US03) or submits a request for review (US04),
and the request is stored in the events table.
"""

from datetime import date, timedelta

import pytest

import models
from auth_testkit import get_user
from login.models import Role

FUTURE = (date.today() + timedelta(days=30)).isoformat()
CLOSES = (date.today() + timedelta(days=20)).isoformat()


def full_request(**overrides) -> dict:
    """A complete request in the shape lib/events/request/form-adapter.ts builds."""
    body = {
        "submit": True,
        "name": "Startup Pitch Night",
        "description": "Eight student ventures pitch to investors.",
        "eventType": "Networking",
        "expectedAttendance": 95,
        "preferredDate": FUTURE,
        "startTime": "18:30",
        "endTime": "21:00",
        "venue": {"location": "Central campus", "capacity": 120, "layout": "standing",
                  "accessibility": ["Step-free access"], "facilities": ["Projector"]},
        "equipment": [{"type": "E1", "quantity": 2, "technicalRequirements": "HDMI to stage"}],
        "registration": {"required": True, "capacityLimit": 120, "closingDate": CLOSES},
    }
    body.update(overrides)
    return body


def stored(db, event_id: int) -> models.Event:
    db.expire_all()
    return db.get(models.Event, event_id)


# ---------------------------------------------------------------- submit (US04)

def test_organiser_submits_a_complete_request_and_it_is_stored(signed_in, db):
    response = signed_in(Role.organiser).post("/events", json=full_request())

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == "submitted"
    assert body["organiser"] == "Maya Rahman"
    assert body["submittedAt"] is not None

    event = stored(db, body["id"])
    assert event.status == models.EventStatus.submitted
    assert event.organiser_id == get_user(db, Role.organiser).id
    assert event.date.isoformat() == FUTURE
    assert event.start_time.strftime("%H:%M") == "18:30"
    assert event.equipment == [{"id": "E1", "qty": 2, "technicalRequirements": "HDMI to stage"}]
    assert event.equipment_state == "requested"
    assert event.registration_cap == 120
    assert event.draft_form is None


def test_response_uses_the_frontend_field_names(signed_in):
    body = signed_in(Role.organiser).post("/events", json=full_request()).json()

    assert body["pax"] == 95
    assert body["start"] == "18:30:00" and body["end"] == "21:00:00"
    assert body["access"] == ["Step-free access"]
    assert body["equip"] == [{"id": "E1", "qty": 2, "technicalRequirements": "HDMI to stage"}]
    assert body["reg"] is True and body["regCap"] == 120 and body["regClose"] == CLOSES


def test_incomplete_submission_is_refused_with_field_errors_and_nothing_is_saved(signed_in, db):
    response = signed_in(Role.organiser).post("/events", json={"submit": True, "name": "Half done"})

    assert response.status_code == 422
    errors = response.json()["detail"]["errors"]
    assert errors["description"] == "Event description is required."
    assert errors["venue.location"] == "Venue location is required."
    assert "name" not in errors
    assert db.query(models.Event).count() == 0


@pytest.mark.parametrize("overrides, field, message", [
    ({"preferredDate": (date.today() - timedelta(days=1)).isoformat()},
     "preferredDate", "Preferred date cannot be in the past."),
    ({"endTime": "18:00"}, "endTime", "End time must be later than start time."),
    ({"registration": {"required": True, "capacityLimit": 120, "closingDate": None}},
     "registration.closingDate", "Registration closing date is required."),
    ({"equipment": [{"type": "E1", "quantity": 1, "technicalRequirements": "  "}]},
     "equipment.0.technicalRequirements", "Equipment technical requirements are required."),
])
def test_submission_rules_match_the_frontend(signed_in, overrides, field, message):
    response = signed_in(Role.organiser).post("/events", json=full_request(**overrides))

    assert response.status_code == 422
    assert response.json()["detail"]["errors"] == {field: message}


# ---------------------------------------------------------------- drafts (US03)

def test_organiser_can_save_an_incomplete_draft(signed_in, db):
    form = {"name": "", "pax": "40"}
    response = signed_in(Role.organiser).post("/events", json={"expectedAttendance": 40, "draftForm": form})

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == "draft"
    assert body["name"] == "Untitled request"
    assert body["submittedAt"] is None
    assert stored(db, body["id"]).draft_form == form


def test_draft_still_rejects_invalid_values(signed_in, db):
    response = signed_in(Role.organiser).post("/events", json={"expectedAttendance": -5})

    assert response.status_code == 422
    assert db.query(models.Event).count() == 0


def test_registration_details_are_dropped_when_registration_is_off(signed_in, db):
    body = full_request(registration={"required": False, "capacityLimit": 50, "closingDate": CLOSES})
    event = stored(db, signed_in(Role.organiser).post("/events", json=body).json()["id"])

    assert event.registration_required is False
    assert event.registration_cap is None and event.registration_close is None


# ---------------------------------------------------------------- access control

@pytest.mark.parametrize("role", [Role.coordinator, Role.venue, Role.tech, Role.attendee])
def test_other_roles_cannot_create_event_requests(signed_in, db, role):
    response = signed_in(role).post("/events", json=full_request())

    assert response.status_code == 403
    assert db.query(models.Event).count() == 0


def test_signed_out_user_cannot_create_event_requests(client, db):
    assert client.post("/events", json=full_request()).status_code == 401
    assert db.query(models.Event).count() == 0


def test_organiser_comes_from_the_session_not_the_request_body(signed_in, db):
    coordinator_id = get_user(db, Role.coordinator).id
    body = full_request(organiser_id=coordinator_id, organiserId=coordinator_id, status="approved")
    response = signed_in(Role.organiser).post("/events", json=body).json()

    assert response["organiserId"] == get_user(db, Role.organiser).id
    assert response["status"] == "submitted"


# ---------------------------------------------------------------- registration closing date

def _closing(days_from_today: int) -> str:
    return (date.today() + timedelta(days=days_from_today)).isoformat()


@pytest.mark.parametrize(
    "closing, message",
    [
        (_closing(-1), "Registration closing date cannot be in the past."),
        (_closing(31), "Registration must close on or before the event date."),
    ],
)
def test_invalid_registration_closing_date_is_refused(signed_in, closing, message):
    body = full_request(registration={"required": True, "capacityLimit": 120, "closingDate": closing})

    response = signed_in(Role.organiser).post("/events", json=body)

    assert response.status_code == 422
    assert response.json()["detail"]["errors"]["registration.closingDate"] == message


@pytest.mark.parametrize("closing", [_closing(0), _closing(30)])  # today, and the event day itself
def test_registration_may_close_from_today_up_to_the_event_day(signed_in, closing):
    body = full_request(registration={"required": True, "capacityLimit": 120, "closingDate": closing})

    assert signed_in(Role.organiser).post("/events", json=body).status_code == 201


def test_registration_without_a_capacity_limit_is_refused(signed_in):
    body = full_request(registration={"required": True, "capacityLimit": None, "closingDate": CLOSES})

    response = signed_in(Role.organiser).post("/events", json=body)

    assert response.status_code == 422
    assert response.json()["detail"]["errors"] == {
        "registration.capacityLimit": "Registration capacity must be a positive whole number."
    }

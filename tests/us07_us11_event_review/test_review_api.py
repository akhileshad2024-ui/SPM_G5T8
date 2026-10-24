"""
US07 / US08 / US10 / US11 / US43 — the review steps, saved through the API.

    POST /events/{id}/assign         US11  the Lead assigns a coordinator account to an unassigned event
    POST /events/{id}/review         US07  Submitted -> Under Review (the assigned coordinator)
    POST /events/{id}/clarification  US08  Under Review -> Pending Clarification
    POST /events/{id}/decision       US10  Under Review -> Approved / Rejected
    GET  /coordinators               US11  the coordinator accounts the Lead chooses from
    GET  /lead/queue                 US43  the Lead's queue of unassigned requests

Since US43 only the Event Coordinator Lead sees unassigned requests and assigns them; a coordinator
sees and manages only the events assigned to them.

The rules match lib/events/review/ (tested in tests/unit/event-review/); these tests check the
server enforces them too, saves the result, and records each status change (US13 history).
Criterion IDs (e.g. US10-AC2) are in the test names, as in docs/user-stories/event-review-acceptance-criteria.md.
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import models
from auth_testkit import PASSWORD, get_user, login
from login import security
from login.models import Role, User
from main import app

S = models.EventStatus

QUESTION = "Can you confirm the expected attendance?"
REASON = "The requested date clashes with exam week."
NOT_A_REVIEWER = [Role.organiser, Role.venue, Role.tech, Role.attendee, Role.lead]


def create(session, submit=True):
    """A request saved by the organiser through the API (submitted unless submit=False)."""
    future = (datetime.now(timezone.utc) + timedelta(days=30)).date().isoformat()
    response = session.post("/events", json={
        "submit": submit, "name": "Design Week Keynote", "description": "Opening keynote.", "eventType": "Conference",
        "expectedAttendance": 120, "preferredDate": future, "startTime": "10:00", "endTime": "12:00",
        "venue": {"location": "Central campus", "capacity": 150, "layout": "theatre", "accessibility": [], "facilities": []},
        "equipment": [],
        "registration": {"required": False, "capacityLimit": None, "closingDate": None},
    })
    assert response.status_code == 201, response.text
    return response.json()["id"]


def history(session, event_id):
    response = session.get(f"/events/{event_id}/history")
    assert response.status_code == 200, response.text
    return response.json()


def steps(entries):
    return [(e["fromStatus"], e["toStatus"]) for e in entries]


def seed(db, event_id, **fields):
    db.expire_all()
    event = db.get(models.Event, event_id)
    for name, value in fields.items():
        setattr(event, name, value)
    db.commit()


def add_user(db, email, name, role):
    """Another account, returned as a signed-in session."""
    db.add(User(email=email, name=name, role=role, password_hash=security.hash_password(PASSWORD),
                is_active=True, failed_login_attempts=0, session_version=0))
    db.commit()
    session = TestClient(app)
    assert login(session, email).status_code == 200
    return session


@pytest.fixture
def organiser(signed_in):
    return signed_in(Role.organiser)


@pytest.fixture
def coordinator(signed_in):
    return signed_in(Role.coordinator)


@pytest.fixture
def lead(signed_in):
    return signed_in(Role.lead)


def me(session):
    return session.get("/auth/me").json()


def post(session, event_id, step, **body):
    return session.post(f"/events/{event_id}/{step}", json=body)


def assign(lead, event_id, coordinator):
    """The Lead assigns `coordinator` (a signed-in session) to the event."""
    response = post(lead, event_id, "assign", coordinatorId=me(coordinator)["id"])
    assert response.status_code == 200, response.text
    return response


def under_review(organiser, coordinator, lead):
    """A submitted request, assigned by the Lead to the signed-in coordinator, who starts the review."""
    event_id = create(organiser)
    assign(lead, event_id, coordinator)
    assert post(coordinator, event_id, "review").status_code == 200
    return event_id


def stored(db, event_id):
    db.expire_all()
    return db.get(models.Event, event_id)


def refused(response, status, message=None):
    assert response.status_code == status, response.text
    if message is not None:
        assert response.json()["detail"] == message
    return True


# ---------------------------------------------------------------- US11: the Lead assigns a coordinator

def test_US11_AC2_the_lead_assigns_a_coordinator_and_the_event_is_returned(organiser, coordinator, lead, db):
    event_id = create(organiser)
    response = assign(lead, event_id, coordinator)

    assert response.json()["coordinator"] == me(coordinator)["name"]
    assert stored(db, event_id).coordinator_id == me(coordinator)["id"]
    assert stored(db, event_id).status == S.submitted        # assigning doesn't change the status


def test_US11_AC3_the_assignment_is_recorded_with_the_assigning_user_and_a_timestamp(organiser, coordinator, lead, db):
    event_id = create(organiser)
    before = datetime.now(timezone.utc)
    body = assign(lead, event_id, coordinator).json()

    assert body["assignedBy"] == "Grace Ong"
    assert datetime.fromisoformat(body["assignedAt"].replace("Z", "+00:00")) >= before - timedelta(seconds=1)
    row = db.query(models.EventAssignment).filter(models.EventAssignment.event_id == event_id).one()
    assert (row.coordinator_id, row.assigned_by_id) == (me(coordinator)["id"], get_user(db, Role.lead).id)
    # The organiser and the coordinator see it too.
    for session in (organiser, coordinator):
        assert session.get(f"/events/{event_id}").json()["assignedBy"] == "Grace Ong"


def test_US11_AC4_the_assigned_coordinator_is_granted_access_and_others_are_not(organiser, coordinator, lead, db):
    other = add_user(db, "marcus.lee@connectsphere.edu", "Marcus Lee", Role.coordinator)
    event_id = create(organiser)
    assert event_id not in [e["id"] for e in coordinator.get("/events").json()]

    assign(lead, event_id, other)

    assert event_id in [e["id"] for e in other.get("/events").json()]
    assert event_id not in [e["id"] for e in coordinator.get("/events").json()]


def test_US11_the_organiser_sees_who_is_coordinating(organiser, coordinator, lead):
    event_id = create(organiser)
    assign(lead, event_id, coordinator)

    mine = next(e for e in organiser.get("/events").json() if e["id"] == event_id)
    assert mine["coordinator"] == me(coordinator)["name"]


@pytest.mark.parametrize("role", [Role.organiser, Role.coordinator, Role.venue, Role.tech, Role.attendee], ids=lambda r: r.value)
def test_US43_only_the_lead_can_assign(signed_in, organiser, db, role):
    event_id = create(organiser)
    priya = get_user(db, Role.coordinator).id

    assert refused(post(signed_in(role), event_id, "assign", coordinatorId=priya), 403)
    assert stored(db, event_id).coordinator_id is None


@pytest.mark.parametrize("role", [Role.organiser, Role.venue, Role.tech, Role.attendee, Role.lead], ids=lambda r: r.value)
def test_US11_AC5_only_coordinator_accounts_can_be_assigned(organiser, lead, db, role):
    event_id = create(organiser)
    not_a_coordinator = get_user(db, role)

    response = post(lead, event_id, "assign", coordinatorId=not_a_coordinator.id)

    assert refused(response, 422, f"{not_a_coordinator.name} is not an Event Coordinator.")
    assert stored(db, event_id).coordinator_id is None


def test_US11_AC5_an_unknown_or_deactivated_account_cannot_be_assigned(organiser, lead, db):
    event_id = create(organiser)
    assert refused(post(lead, event_id, "assign", coordinatorId=99999), 422, "That person is not an Event Coordinator.")

    other = add_user(db, "marcus.lee@connectsphere.edu", "Marcus Lee", Role.coordinator)
    marcus_id = me(other)["id"]
    db.get(User, marcus_id).is_active = False
    db.commit()
    assert refused(post(lead, event_id, "assign", coordinatorId=marcus_id), 422, "Marcus Lee is not an Event Coordinator.")


def test_US11_drafts_cannot_be_assigned(organiser, coordinator, lead, db):
    event_id = create(organiser, submit=False)

    # a draft is only visible to its organiser, so to the Lead it is someone else's event
    assert refused(post(lead, event_id, "assign", coordinatorId=me(coordinator)["id"]), 403)
    assert stored(db, event_id).coordinator_id is None


def test_US11_closed_events_cannot_be_assigned(organiser, coordinator, lead, db):
    event_id = create(organiser)
    seed(db, event_id, status=S.cancelled)

    # cancelled: not live, so the Lead doesn't oversee it
    assert refused(post(lead, event_id, "assign", coordinatorId=me(coordinator)["id"]), 403)


def test_US11_an_assigned_event_cannot_be_assigned_again(organiser, coordinator, lead, db):
    event_id = create(organiser)
    assign(lead, event_id, coordinator)
    other = add_user(db, "marcus.lee@connectsphere.edu", "Marcus Lee", Role.coordinator)

    response = post(lead, event_id, "assign", coordinatorId=me(other)["id"])

    assert refused(response, 409, f"{me(coordinator)['name']} is already coordinating this event.")
    assert stored(db, event_id).coordinator_id == me(coordinator)["id"]


def test_US11_an_unassigned_event_under_review_can_still_be_assigned(organiser, coordinator, lead, db):
    event_id = create(organiser)
    seed(db, event_id, status=S.under_review)  # e.g. picked up before US43, when coordinators could

    response = assign(lead, event_id, coordinator)

    assert response.json()["status"] == "under_review"


def test_US11_AC2_the_coordinator_list_has_only_active_coordinator_accounts(coordinator, lead, db):
    add_user(db, "marcus.lee@connectsphere.edu", "Marcus Lee", Role.coordinator)
    add_user(db, "aisha.noor@connectsphere.edu", "Aisha Noor", Role.coordinator)
    db.query(User).filter(User.email == "aisha.noor@connectsphere.edu").one().is_active = False
    db.commit()

    names = [c["name"] for c in lead.get("/coordinators").json()]

    assert names == sorted([me(coordinator)["name"], "Marcus Lee"])


@pytest.mark.parametrize("role", [Role.organiser, Role.coordinator, Role.venue, Role.tech, Role.attendee], ids=lambda r: r.value)
def test_US43_only_the_lead_can_list_the_coordinators(signed_in, role):
    assert refused(signed_in(role).get("/coordinators"), 403)


# ---------------------------------------------------------------- US43: the Lead's oversight

def test_US43_AC1_AC3_the_lead_queue_lists_unassigned_live_requests_with_their_basic_information(organiser, coordinator, lead, db):
    first, second, assigned = create(organiser), create(organiser), create(organiser)
    draft = create(organiser, submit=False)
    cancelled = create(organiser)
    seed(db, cancelled, status=S.cancelled)
    assign(lead, assigned, coordinator)

    queue = lead.get("/lead/queue").json()

    assert [e["id"] for e in queue] == [first, second]
    assert draft not in [e["id"] for e in queue]
    for field in ("name", "organiser", "date", "start", "end", "pax", "purpose", "eventType", "status"):
        assert field in queue[0], field
    assert queue[0]["coordinator"] is None


def test_US43_AC2_the_lead_sees_each_coordinators_active_events(organiser, coordinator, lead, db):
    other = add_user(db, "marcus.lee@connectsphere.edu", "Marcus Lee", Role.coordinator)
    mine, theirs = create(organiser), create(organiser)
    assign(lead, mine, coordinator)
    assign(lead, theirs, other)

    by_coordinator = {e["id"]: e["coordinator"] for e in lead.get("/events").json()}

    assert by_coordinator[mine] == me(coordinator)["name"]
    assert by_coordinator[theirs] == "Marcus Lee"


@pytest.mark.parametrize("role", [Role.organiser, Role.coordinator, Role.venue, Role.tech, Role.attendee], ids=lambda r: r.value)
def test_US43_AC5_only_the_lead_can_read_the_queue(signed_in, role, client):
    assert refused(signed_in(role).get("/lead/queue"), 403)
    assert refused(client.get("/lead/queue"), 401)


def test_US43_AC4_a_coordinator_cannot_see_or_act_on_an_unassigned_request(organiser, coordinator, db):
    event_id = create(organiser)

    assert event_id not in [e["id"] for e in coordinator.get("/events").json()]
    assert refused(coordinator.get(f"/events/{event_id}"), 403)
    assert refused(post(coordinator, event_id, "review"), 403)
    assert stored(db, event_id).status == S.submitted


# ---------------------------------------------------------------- US07: start the review

def test_US07_AC6_starting_a_review_moves_submitted_to_under_review_and_records_it(organiser, coordinator, lead):
    event_id = create(organiser)
    assign(lead, event_id, coordinator)
    response = post(coordinator, event_id, "review")

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "under_review"
    assert steps(history(organiser, event_id)) == [(None, "submitted"), ("submitted", "under_review")]
    assert history(organiser, event_id)[-1]["changedBy"] == me(coordinator)["name"]


def test_US07_AC6_only_submitted_requests_can_be_moved_into_review(organiser, coordinator, lead):
    event_id = under_review(organiser, coordinator, lead)

    assert refused(post(coordinator, event_id, "review"), 409, "Only newly submitted requests can be moved into review.")
    assert len(history(organiser, event_id)) == 2       # nothing extra recorded


@pytest.mark.parametrize("role", NOT_A_REVIEWER, ids=lambda r: r.value)
def test_US07_AC1_only_coordinators_can_start_a_review(signed_in, organiser, db, role):
    event_id = create(organiser)

    assert refused(post(signed_in(role), event_id, "review"), 403)
    assert stored(db, event_id).status == S.submitted


def test_US07_an_event_that_does_not_exist_is_not_found(coordinator):
    assert refused(post(coordinator, 99999, "review"), 404, "Event not found")


def test_US07_a_coordinator_cannot_act_on_another_coordinators_event(organiser, coordinator, lead, db):
    other = add_user(db, "marcus.lee@connectsphere.edu", "Marcus Lee", Role.coordinator)
    event_id = create(organiser)
    assign(lead, event_id, other)

    assert refused(post(coordinator, event_id, "review"), 403)
    assert stored(db, event_id).status == S.submitted


# ---------------------------------------------------------------- US08: clarification / amendment

@pytest.mark.parametrize("kind", ["clarification", "amendment"])
def test_US08_AC1_AC3_a_request_moves_to_pending_clarification_and_is_recorded(organiser, coordinator, lead, db, kind):
    event_id = under_review(organiser, coordinator, lead)
    response = post(coordinator, event_id, "clarification", kind=kind, message=f"  {QUESTION}  ")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "pending_clarification"
    assert body["clarification"]["kind"] == kind
    assert body["clarification"]["message"] == QUESTION         # trimmed
    assert body["clarification"]["requestedBy"] == me(coordinator)["name"]
    assert body["clarification"]["requestedAt"].endswith("Z")
    label = "Clarification" if kind == "clarification" else "Amendment"
    assert history(organiser, event_id)[-1]["reason"] == f"{label}: {QUESTION}"


def test_US08_AC3_the_organiser_sees_the_clarification_request(organiser, coordinator, lead):
    event_id = under_review(organiser, coordinator, lead)
    post(coordinator, event_id, "clarification", kind="clarification", message=QUESTION)

    mine = next(e for e in organiser.get("/events").json() if e["id"] == event_id)
    assert mine["status"] == "pending_clarification"
    assert mine["clarification"]["message"] == QUESTION


@pytest.mark.parametrize("message, error", [
    ("", "Clarification message is required."),
    ("   ", "Clarification message is required."),
    ("x" * 1001, "Clarification message must be 1000 characters or fewer."),
])
def test_US08_AC2_a_message_of_1_to_1000_characters_is_required(organiser, coordinator, lead, db, message, error):
    event_id = under_review(organiser, coordinator, lead)

    assert refused(post(coordinator, event_id, "clarification", kind="clarification", message=message), 422, error)
    assert stored(db, event_id).status == S.under_review
    assert stored(db, event_id).clarification is None


def test_US08_AC2_exactly_1000_characters_is_accepted(organiser, coordinator, lead):
    event_id = under_review(organiser, coordinator, lead)

    assert post(coordinator, event_id, "clarification", kind="amendment", message="x" * 1000).status_code == 200


def test_US08_AC4_a_request_pending_clarification_cannot_be_decided(organiser, coordinator, lead, db):
    event_id = under_review(organiser, coordinator, lead)
    post(coordinator, event_id, "clarification", kind="clarification", message=QUESTION)

    for outcome in ("approved", "rejected"):
        response = post(coordinator, event_id, "decision", outcome=outcome, reason=REASON)
        assert refused(response, 409, "Waiting for the organiser to respond to your clarification request.")
    assert stored(db, event_id).status == S.pending_clarification


def test_US08_AC5_only_while_under_review(organiser, coordinator, lead):
    event_id = create(organiser)
    assign(lead, event_id, coordinator)

    response = post(coordinator, event_id, "clarification", kind="clarification", message=QUESTION)
    assert refused(response, 409, "Start the review before making a decision on this request.")


def test_US08_AC5_only_once_a_coordinator_is_assigned(organiser, coordinator, db):
    event_id = create(organiser)
    seed(db, event_id, status=S.under_review)  # under review but nobody assigned

    # US43: an unassigned request isn't the coordinator's to act on at all.
    response = post(coordinator, event_id, "clarification", kind="clarification", message=QUESTION)
    assert refused(response, 403)


def test_US08_an_unknown_kind_is_rejected(organiser, coordinator, lead):
    event_id = under_review(organiser, coordinator, lead)

    assert post(coordinator, event_id, "clarification", kind="question", message=QUESTION).status_code == 422


# ---------------------------------------------------------------- US10: approve / reject

def test_US10_AC1_AC3_approving_records_the_decision_and_the_note(organiser, coordinator, lead):
    event_id = under_review(organiser, coordinator, lead)
    response = post(coordinator, event_id, "decision", outcome="approved", reason="  Looks good.  ")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "approved"
    assert body["decision"]["outcome"] == "approved"
    assert body["decision"]["by"] == me(coordinator)["name"]
    assert body["decision"]["reason"] == "Looks good."
    assert steps(history(organiser, event_id))[-1] == ("under_review", "approved")
    assert history(organiser, event_id)[-1]["reason"] == "Looks good."


def test_US10_AC1_the_approval_note_is_optional(organiser, coordinator, lead):
    event_id = under_review(organiser, coordinator, lead)
    response = post(coordinator, event_id, "decision", outcome="approved")

    assert response.status_code == 200, response.text
    assert "reason" not in response.json()["decision"]
    assert history(organiser, event_id)[-1]["reason"] is None


def test_US10_AC1_an_approval_note_over_1000_characters_is_refused(organiser, coordinator, lead, db):
    event_id = under_review(organiser, coordinator, lead)

    response = post(coordinator, event_id, "decision", outcome="approved", reason="x" * 1001)
    assert refused(response, 422, "Approval note must be 1000 characters or fewer.")
    assert stored(db, event_id).status == S.under_review


def test_US10_AC2_AC4_rejecting_records_the_reason_for_the_organiser(organiser, coordinator, lead):
    event_id = under_review(organiser, coordinator, lead)
    response = post(coordinator, event_id, "decision", outcome="rejected", reason=REASON)

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "rejected"
    mine = next(e for e in organiser.get("/events").json() if e["id"] == event_id)
    assert mine["decision"] == {"outcome": "rejected", "by": me(coordinator)["name"], "at": mine["decision"]["at"], "reason": REASON}
    assert history(organiser, event_id)[-1]["reason"] == REASON


@pytest.mark.parametrize("reason, error", [
    ("", "Rejection reason is required."),
    ("Too vague", "Rejection reason must be at least 10 characters."),      # 9 characters
    ("x" * 1001, "Rejection reason must be 1000 characters or fewer."),
])
def test_US10_AC2_a_rejection_needs_a_reason_of_10_to_1000_characters(organiser, coordinator, lead, db, reason, error):
    event_id = under_review(organiser, coordinator, lead)

    assert refused(post(coordinator, event_id, "decision", outcome="rejected", reason=reason), 422, error)
    assert stored(db, event_id).status == S.under_review
    assert stored(db, event_id).decision is None


def test_US10_AC2_exactly_10_characters_is_accepted(organiser, coordinator, lead):
    event_id = under_review(organiser, coordinator, lead)

    assert post(coordinator, event_id, "decision", outcome="rejected", reason="Wrong date").status_code == 200


def test_US10_AC5_only_once_a_coordinator_is_assigned(organiser, coordinator, db):
    event_id = create(organiser)
    seed(db, event_id, status=S.under_review)  # under review but nobody assigned

    response = post(coordinator, event_id, "decision", outcome="approved")
    assert refused(response, 403)  # US43: not the coordinator's event


def test_US10_AC5_not_before_the_review_has_started(organiser, coordinator, lead):
    event_id = create(organiser)
    assign(lead, event_id, coordinator)

    response = post(coordinator, event_id, "decision", outcome="approved")
    assert refused(response, 409, "Start the review before making a decision on this request.")


@pytest.mark.parametrize("first", ["approved", "rejected"])
def test_US10_AC6_a_decided_request_cannot_be_decided_again(organiser, coordinator, lead, db, first):
    event_id = under_review(organiser, coordinator, lead)
    post(coordinator, event_id, "decision", outcome=first, reason=REASON)

    for outcome in ("approved", "rejected"):
        response = post(coordinator, event_id, "decision", outcome=outcome, reason=REASON)
        assert refused(response, 409, "A decision has already been made on this request.")
    assert stored(db, event_id).status == S(first)
    assert len(history(organiser, event_id)) == 3


@pytest.mark.parametrize("role", NOT_A_REVIEWER, ids=lambda r: r.value)
def test_US10_only_coordinators_can_decide(signed_in, organiser, coordinator, lead, db, role):
    event_id = under_review(organiser, coordinator, lead)

    assert refused(post(signed_in(role), event_id, "decision", outcome="approved"), 403)
    assert stored(db, event_id).status == S.under_review


# ---------------------------------------------------------------- the whole flow (US13 history)

def test_the_full_review_is_recorded_step_by_step(organiser, coordinator, lead):
    event_id = create(organiser)
    assign(lead, event_id, coordinator)
    post(coordinator, event_id, "review")
    post(coordinator, event_id, "clarification", kind="clarification", message=QUESTION)

    assert steps(history(organiser, event_id)) == [
        (None, "submitted"),
        ("submitted", "under_review"),
        ("under_review", "pending_clarification"),
    ]

"""Unit tests for event_review's US09 functions: no HTTP and no real database."""
from copy import deepcopy
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import event_review as rules
from login.models import Role

NOW = datetime(2026, 10, 23, 8, 0, tzinfo=timezone.utc)


def organiser(**overrides):
    return SimpleNamespace(**{"id": 1, "name": "Maya", "role": Role.organiser, **overrides})


def pending(**overrides):
    return SimpleNamespace(**{"id": 10, "organiser_id": 1, "coordinator_id": 2,
        "status": rules.S.pending_clarification, "name": "Test event", "expected_attendance": 85,
        "clarification": {"kind": "clarification", "message": "Includes speakers?",
                          "requestedBy": "Priya", "requestedAt": "2026-10-23T07:00:00Z"}, **overrides})


def test_US09_AC2_reply_is_trimmed_and_retained_without_editing_event_or_status():
    event = pending()
    question = deepcopy(event.clarification)
    rules.respond_to_clarification(event, organiser(), "  Yes, includes speakers.  ", NOW)
    assert event.clarification == {**question, "response": {
        "message": "Yes, includes speakers.", "respondedBy": "Maya", "respondedAt": rules.iso(NOW)}}
    assert event.name == "Test event" and event.expected_attendance == 85
    assert event.status == rules.S.pending_clarification


@pytest.mark.parametrize("user", [organiser(id=9), organiser(role=Role.coordinator)])
def test_US09_ownership_rejects_other_people(user):
    with pytest.raises(rules.ReviewError, match="Only the event organiser") as error:
        rules.respond_to_clarification(pending(), user, "Answer", NOW)
    assert error.value.status_code == 403


@pytest.mark.parametrize("overrides", [{"status": rules.S.submitted}, {"clarification": None}])
def test_US09_requires_an_outstanding_question(overrides):
    with pytest.raises(rules.ReviewError, match="no outstanding"):
        rules.respond_to_clarification(pending(**overrides), organiser(), "Answer", NOW)


def test_US09_a_second_reply_does_not_replace_the_saved_reply():
    event = pending()
    rules.respond_to_clarification(event, organiser(), "First answer", NOW)
    before = deepcopy(event.clarification)
    with pytest.raises(rules.ReviewError, match="already been recorded"):
        rules.respond_to_clarification(event, organiser(), "Second answer", NOW)
    assert event.clarification == before


@pytest.mark.parametrize("message", ["", "   ", "x" * 1001])
def test_US09_response_uses_existing_review_note_validation(message):
    event = pending()
    with pytest.raises(rules.ReviewError) as error:
        rules.respond_to_clarification(event, organiser(), message, NOW)
    assert error.value.status_code == 422 and "response" not in event.clarification


def test_US09_AC3_only_coordinator_action_resumes_review():
    event = pending()
    rules.respond_to_clarification(event, organiser(), "Answer", NOW)
    db = Mock()
    rules.resume_review(db, event, organiser(id=2, role=Role.coordinator), NOW)
    assert event.status == rules.S.under_review
    assert event.clarification["response"]["message"] == "Answer"
    db.add.assert_called_once()  # Status history shares the endpoint transaction.


@pytest.mark.parametrize("user", [organiser(id=3, role=Role.coordinator), organiser(id=2)])
def test_US09_unassigned_person_cannot_resume(user):
    with pytest.raises(rules.ReviewError, match="Only the assigned coordinator"):
        rules.resume_review(Mock(), pending(), user, NOW)


@pytest.mark.parametrize("event", [pending(), pending(status=rules.S.under_review), pending(clarification=None)])
def test_US09_resume_requires_pending_status_and_saved_reply(event):
    with pytest.raises(rules.ReviewError, match="response is required"):
        rules.resume_review(Mock(), event, organiser(id=2, role=Role.coordinator), NOW)


def test_US09_AC2_next_round_keeps_previous_question_and_reply():
    event = pending()
    rules.respond_to_clarification(event, organiser(), "Answer", NOW)
    original = deepcopy(event.clarification)
    event.status = rules.S.under_review
    coordinator = organiser(id=2, role=Role.coordinator)
    rules.request_clarification(Mock(), event, coordinator, "amendment", "Please clarify timing.", NOW)
    assert event.clarification["history"] == [original]
    assert "response" not in event.clarification
    rules.respond_to_clarification(event, organiser(), "Timing answer", NOW)
    second = {k: v for k, v in event.clarification.items() if k != "history"}
    event.status = rules.S.under_review
    rules.request_clarification(Mock(), event, coordinator, "clarification", "Third question", NOW)
    assert event.clarification["history"] == [original, second]


def test_shared_review_guard_requires_an_assigned_coordinator():
    """Shared-module regression, not an additional US09 customer AC."""
    event = pending(status=rules.S.under_review, coordinator_id=None)
    with pytest.raises(rules.ReviewError, match="Assign a coordinator"):
        rules.check_decision_allowed(Mock(), event, organiser(id=2, role=Role.coordinator))


def test_shared_assignment_guard_rejects_closed_events():
    """Protect the existing US11 branch while extending the shared review module."""
    db = Mock()
    db.get.return_value = SimpleNamespace(id=2, name="Priya", role=Role.coordinator, is_active=True)
    with pytest.raises(rules.ReviewError, match="can't be assigned"):
        rules.assign(db, pending(status=rules.S.cancelled), organiser(id=2, role=Role.coordinator), 2)


def test_shared_review_guard_rejects_a_different_assigned_coordinator():
    db = Mock()
    db.get.return_value = SimpleNamespace(name="Assigned coordinator")
    with pytest.raises(rules.ReviewError, match="Only the assigned coordinator"):
        rules.check_decision_allowed(db, pending(status=rules.S.under_review),
                                     organiser(id=3, role=Role.coordinator))

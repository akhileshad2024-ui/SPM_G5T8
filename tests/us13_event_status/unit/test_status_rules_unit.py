"""
US13 unit tests for backend/event_status.py: the defined status set (AC2), which status
changes the workflow allows, and that every change is recorded with who and when (AC3).
"""

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import models
from event_status import TRANSITIONS, can_change, change_status, label, record_initial_status

S = models.EventStatus
NOW = datetime(2026, 10, 8, 9, 0, tzinfo=timezone.utc)
USER = SimpleNamespace(id=3)


class FakeDB:
    def __init__(self):
        self.added = []

    def add(self, row):
        self.added.append(row)


def event(status):
    return SimpleNamespace(id=11, status=status)


# ---------------------------------------------------------------- AC2: the defined set

def test_statuses_are_exactly_the_defined_set():
    assert [label(s) for s in S] == [
        "Draft", "Submitted", "Under Review", "Pending Clarification", "Approved", "Confirmed", "Rejected", "Cancelled",
    ]


def test_every_status_has_transition_rules():
    assert set(TRANSITIONS) == set(S)


# ---------------------------------------------------------------- allowed changes

@pytest.mark.parametrize("start", [S.draft, S.submitted])
def test_a_request_starts_as_a_draft_or_submitted(start):
    assert can_change(None, start)


@pytest.mark.parametrize("start", [S.under_review, S.approved, S.confirmed, S.rejected, S.cancelled])
def test_a_request_cannot_start_further_along(start):
    assert not can_change(None, start)


@pytest.mark.parametrize("current, new", [
    (S.draft, S.submitted),                    # US04
    (S.submitted, S.under_review),             # US07
    (S.under_review, S.pending_clarification), # US08
    (S.pending_clarification, S.under_review), # US09
    (S.under_review, S.approved),              # US10
    (S.under_review, S.rejected),              # US10
    (S.approved, S.confirmed),                 # US14
    (S.confirmed, S.cancelled),                # US37
])
def test_the_workflow_steps_are_allowed(current, new):
    assert can_change(current, new)


@pytest.mark.parametrize("current, new", [
    (S.draft, S.approved),
    (S.submitted, S.approved),     # must be reviewed first
    (S.approved, S.draft),
    (S.confirmed, S.under_review),
])
def test_skipping_or_going_backwards_is_refused(current, new):
    assert not can_change(current, new)


@pytest.mark.parametrize("closed", [S.rejected, S.cancelled])
def test_rejected_and_cancelled_events_are_final(closed):
    assert all(not can_change(closed, new) for new in S)


def test_a_draft_cannot_be_cancelled_it_is_deleted_instead():
    assert not can_change(S.draft, S.cancelled)


# ---------------------------------------------------------------- AC3: every change recorded

def test_a_change_updates_the_status_and_records_who_and_when():
    db, e = FakeDB(), event(S.under_review)

    change_status(db, e, S.rejected, USER, NOW, reason="Clashes with exams")

    assert e.status == S.rejected
    [row] = db.added
    assert (row.event_id, row.from_status, row.to_status) == (11, S.under_review, S.rejected)
    assert (row.changed_by_id, row.changed_at, row.reason) == (3, NOW, "Clashes with exams")


def test_a_blank_reason_is_stored_as_none():
    db = FakeDB()
    change_status(db, event(S.submitted), S.under_review, USER, NOW, reason="")
    assert db.added[0].reason is None


def test_setting_the_same_status_records_nothing():
    db, e = FakeDB(), event(S.draft)

    change_status(db, e, S.draft, USER, NOW)

    assert db.added == []
    assert e.status == S.draft


def test_a_refused_change_leaves_the_event_and_history_alone():
    db, e = FakeDB(), event(S.submitted)

    with pytest.raises(HTTPException) as err:
        change_status(db, e, S.confirmed, USER, NOW)

    assert err.value.status_code == 409
    assert err.value.detail == "An event that is Submitted can't be changed to Confirmed."
    assert e.status == S.submitted
    assert db.added == []


def test_the_first_entry_has_no_previous_status():
    db = FakeDB()
    record_initial_status(db, event(S.draft), USER, NOW)
    [row] = db.added
    assert (row.from_status, row.to_status, row.changed_at) == (None, S.draft, NOW)

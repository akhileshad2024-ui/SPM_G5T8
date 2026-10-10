"""
US13 unit tests: the complete status-change table (AC2/AC3).

test_status_rules_unit.py checks the workflow's main steps; this file checks every one of
the 8 x 8 possible changes against the table below, written out independently from the
code, so an extra allowed change (or a missing one) is caught.
"""

import pytest
from fastapi import HTTPException

import models
from event_status import can_change, change_status, label

from test_status_rules_unit import NOW, USER, FakeDB, event

S = models.EventStatus

# Where each status may go next, from the backlog: submit (US04), start review (US07),
# clarification (US08), approve / reject (US10), confirm (US14), cancel (US37).
EXPECTED = {
    S.draft: {S.submitted},
    S.submitted: {S.under_review, S.cancelled},
    S.under_review: {S.pending_clarification, S.approved, S.rejected, S.cancelled},
    S.pending_clarification: {S.under_review, S.cancelled},
    S.approved: {S.confirmed, S.cancelled},
    S.confirmed: {S.cancelled},
    S.rejected: set(),
    S.cancelled: set(),
}

ALL_PAIRS = [(current, new) for current in S for new in S if current != new]


@pytest.mark.parametrize("current, new", ALL_PAIRS, ids=lambda s: s.value)
def test_every_status_change_matches_the_workflow(current, new):
    assert can_change(current, new) is (new in EXPECTED[current])


@pytest.mark.parametrize("current, new", ALL_PAIRS, ids=lambda s: s.value)
def test_change_status_applies_exactly_the_allowed_changes(current, new):
    db, e = FakeDB(), event(current)

    if new in EXPECTED[current]:
        change_status(db, e, new, USER, NOW)
        assert e.status == new
        assert [(r.from_status, r.to_status) for r in db.added] == [(current, new)]
    else:
        with pytest.raises(HTTPException) as refused:
            change_status(db, e, new, USER, NOW)
        assert refused.value.status_code == 409
        assert e.status == current
        assert db.added == []


def test_a_refused_change_explains_itself_with_status_names():
    with pytest.raises(HTTPException) as refused:
        change_status(FakeDB(), event(S.rejected), S.approved, USER, NOW)

    assert refused.value.detail == "An event that is Rejected can't be changed to Approved."


@pytest.mark.parametrize("status, expected", [
    (S.draft, "Draft"),
    (S.submitted, "Submitted"),
    (S.under_review, "Under Review"),
    (S.pending_clarification, "Pending Clarification"),
    (S.approved, "Approved"),
    (S.rejected, "Rejected"),
    (S.confirmed, "Confirmed"),
    (S.cancelled, "Cancelled"),
])
def test_every_status_has_its_us13_name(status, expected):
    assert label(status) == expected


def test_the_reason_given_is_recorded_with_the_change():
    db = FakeDB()

    change_status(db, event(S.under_review), S.rejected, USER, NOW, reason="Venue capacity too small")

    assert db.added[0].reason == "Venue capacity too small"
    assert db.added[0].changed_by_id == USER.id
    assert db.added[0].changed_at == NOW

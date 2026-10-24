"""Unit tests of the event_updates module; US16-TC01, no HTTP/database."""
from types import SimpleNamespace
from pathlib import Path
import sys
import os
import subprocess

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "backend"))

import pytest
import event_updates as rules


def event(**overrides):
    values = {column: None for column in rules.DETAIL_FIELDS.values()}
    return SimpleNamespace(**{**values, "coordinator_id": 2,
        "status": "under_review", "purpose": "Original", "expected_attendance": 85, **overrides})


def coordinator(**overrides):
    return SimpleNamespace(**{"id": 2, "role": "coordinator", **overrides})


def test_AC1_TC01_prepares_edit_without_mutating_event():
    saved = event()
    assert rules.prepare_update(saved, coordinator(), {"purpose": "Revised"}) == ({"purpose": "Revised"}, False)
    assert saved.purpose == "Original"


@pytest.mark.parametrize("user", [coordinator(id=9), coordinator(role="organiser")])
def test_AC1_denies_unassigned_people(user):
    with pytest.raises(rules.UpdateError) as error:
        rules.prepare_update(event(), user, {"purpose": "Revised"})
    assert error.value.status_code == 403


@pytest.mark.parametrize("status", ["draft", "submitted", "under_review", "pending_clarification",
                                    "approved", "confirmed", "rejected", "cancelled"])
def test_planning_boundary_does_not_open_confirmed_or_closed_events(status):
    if status in rules.PLANNING_STATUSES:
        assert rules.prepare_update(event(status=status), coordinator(), {}) == ({}, False)
    else:
        with pytest.raises(rules.UpdateError) as error:
            rules.prepare_update(event(status=status), coordinator(), {})
        assert error.value.status_code == 409


def test_technical_allowlist_never_changes_owner_or_status():
    with pytest.raises(rules.UpdateError) as error:
        rules.prepare_update(event(), coordinator(), {"organiser_id": 99})
    assert error.value.status_code == 422


def test_AC4_TC01_attendance_change_is_arrangement_sensitive():
    assert rules.prepare_update(event(), coordinator(), {"pax": 90}) == ({"pax": 90}, True)


def test_AC4_description_can_also_matter_when_arrangements_exist():
    assert rules.prepare_update(event(), coordinator(), {"purpose": "Revised"}, True)[1] is True


@pytest.mark.parametrize("arranged", [False, True])
def test_unchanged_input_does_not_create_a_change(arranged):
    assert rules.prepare_update(event(), coordinator(), {"pax": 85}, arranged) == ({}, False)


@pytest.mark.parametrize("key", sorted(rules.ARRANGEMENT_FIELDS))
def test_AC4_each_arrangement_field_is_classified(key):
    # Test the confirmed field mapping, not framework type conversion.
    changes, affects = rules.prepare_update(event(), coordinator(), {key: "changed"})
    assert changes == {key: "changed"} and affects


def test_technical_import_needs_no_database_or_auth_configuration():
    """CI regression: a fresh interpreter must not import the database at all.

    pytest's conftest sets a SQLite URL; this subprocess prevents that setup
    from hiding accidental ORM imports in a supposedly pure business module.
    """
    backend = str(Path(__file__).resolve().parents[3] / "backend")
    script = (
        f"import sys; sys.path.insert(0, {backend!r}); import event_updates; "
        "assert 'database' not in sys.modules; assert 'models' not in sys.modules; "
        "assert 'login.models' not in sys.modules"
    )
    result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True,
        env={**os.environ, "DATABASE_URL": "", "JWT_SECRET": ""})
    assert result.returncode == 0, result.stderr

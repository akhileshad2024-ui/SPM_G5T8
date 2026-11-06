"""
US36 - the two parts of the notification lifecycle that the other tests do not reach:
the hold sweeper that starts and stops with the application, and the rule that the person
who made a change is left out of its notices.
"""

import threading
from datetime import date

import pytest
from fastapi.testclient import TestClient

import main
import messaging
import models
from auth_testkit import get_user
from login.models import Role


def test_application_starts_the_hold_sweeper_and_stops_it_on_shutdown(monkeypatch):
    """US42-AC3 / US36: hold warnings keep going out while nobody uses the app, and stop with it."""
    started = threading.Event()
    seen = {}

    def fake_sweeper(stop):
        # Stands in for sweep_holds_forever: records what the app handed it, then returns at once.
        seen["stop"] = stop
        seen["thread"] = threading.current_thread()
        seen["stopped_while_running"] = stop.is_set()
        started.set()

    monkeypatch.setattr(messaging, "sweep_holds_forever", fake_sweeper)

    with TestClient(main.app):
        assert started.wait(timeout=5), "the sweeper thread was never started"
        assert seen["stop"].is_set() is False  # still running while the app is up
        assert seen["thread"].name == "hold-sweeper"
        assert seen["thread"].daemon is True  # must never keep the process alive on its own

    assert seen["stopped_while_running"] is False
    assert seen["stop"].is_set() is True  # shutdown asks the sweeper to stop


@pytest.fixture
def event(db):
    row = models.Event(organiser_id=get_user(db, Role.organiser).id, coordinator_id=get_user(db, Role.coordinator).id,
                       name="Design Keynote", status=models.EventStatus.approved, date=date(2027, 1, 4))
    db.add(row)
    db.flush()
    return row


def inbox(db, user_id):
    db.flush()
    return db.query(models.Notification).filter_by(recipient_id=user_id).all()


def test_notify_all_leaves_out_the_person_who_made_the_change(db, event):
    organiser = get_user(db, Role.organiser).id
    coordinator = get_user(db, Role.coordinator).id

    messaging.notify_all(db, [organiser, coordinator], event, "Details changed", "Venue updated", skip=coordinator)

    assert inbox(db, coordinator) == []
    assert [n.title for n in inbox(db, organiser)] == ["Details changed"]


def test_notify_all_sends_once_per_person_and_to_everyone_when_nobody_is_skipped(db, event):
    organiser = get_user(db, Role.organiser).id
    coordinator = get_user(db, Role.coordinator).id

    messaging.notify_all(db, [organiser, coordinator, organiser], event, "Details changed", "Venue updated")

    assert len(inbox(db, organiser)) == 1  # a repeated id still gets one notice
    assert len(inbox(db, coordinator)) == 1

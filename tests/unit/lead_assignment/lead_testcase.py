"""
Shared setup for the US43 (Event Coordinator Lead Oversight) and US11 (Assign Event Coordinator) unit tests.

A real in-memory SQLite database (never Supabase), reusing the US22 test setup, with real user rows:
assigning looks the coordinator up, and the event's response names who assigned it.
"""

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "venue"))

from fastapi import HTTPException

from test_us22_submit_booking_request import DatabaseTestCase
import main
import models
import schemas
from event_access import involved_events
from login.models import Role, User

S = models.EventStatus
NOW = datetime(2027, 1, 4, 9, 30, tzinfo=timezone.utc)
CLOSED = [S.draft, S.rejected, S.cancelled]


class LeadTestCase(DatabaseTestCase):
    """Maya (organiser), Priya and Marcus (coordinators), Grace (the Lead) and Daniel (Venue Staff)."""

    def setUp(self):
        super().setUp()
        self.maya = self.user("Maya Rahman", Role.organiser)
        self.priya = self.user("Priya Tan", Role.coordinator)
        self.marcus = self.user("Marcus Lee", Role.coordinator)
        self.grace = self.user("Grace Ong", Role.lead)
        self.daniel = self.user("Daniel Ortiz", Role.venue)

    def user(self, name, role, active=True) -> User:
        user = User(email=f"{name.split()[0].lower()}@connectsphere.edu", name=name, role=role, password_hash="x",
                    is_active=active, failed_login_attempts=0, session_version=0)
        self.db.add(user)
        self.db.commit()
        return user

    def request(self, name="Open Day", status=S.submitted, coordinator=None, submitted_at=None, **fields) -> models.Event:
        """Unlike the US22 event(), unassigned by default."""
        return self.event(name=name, status=status, organiser_id=self.maya.id,
                          coordinator_id=coordinator.id if coordinator else None, submitted_at=submitted_at, **fields)

    def assign(self, event, coordinator, user=None):
        body = schemas.AssignCoordinatorIn(coordinatorId=coordinator.id)
        return main.assign_coordinator(event.id, body, db=self.db, user=user or self.grace)

    def refusal(self, call, *args, **kwargs) -> HTTPException:
        with self.assertRaises(HTTPException) as ctx:
            call(*args, **kwargs)
        return ctx.exception

    def visible(self, user):
        return [e.name for e in involved_events(self.db.query(models.Event), user).order_by(models.Event.id)]

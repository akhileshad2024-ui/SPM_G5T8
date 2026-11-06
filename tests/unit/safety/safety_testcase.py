"""
Shared setup for the US44 (Operational Safety Check) unit tests.

A real in-memory SQLite database (never Supabase), reusing the US22 test setup, with real user rows: the
safety check names its reviewers, notifies real accounts and records who decided.
"""

import sys
from datetime import datetime, time, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "venue"))

from fastapi import HTTPException

from test_us22_submit_booking_request import MON, DatabaseTestCase
import main
import models
import schemas
import bookings.service as venue_bookings
from auth.models import Role, User

S = models.EventStatus
NOW = datetime(2027, 1, 4, 9, 30, tzinfo=timezone.utc)


class SafetyTestCase(DatabaseTestCase):
    """Maya (organiser), Priya and Marcus (coordinators), Hannah and Ravi (Safety Officers), Grace (the Lead),
    Daniel (Venue Staff) and Wei (Technical Support)."""

    def setUp(self):
        super().setUp()
        self.maya = self.user("Maya Rahman", Role.organiser)
        self.priya = self.user("Priya Tan", Role.coordinator)
        self.marcus = self.user("Marcus Lee", Role.coordinator)
        self.hannah = self.user("Hannah Lau", Role.safety)
        self.ravi = self.user("Ravi Menon", Role.safety)
        self.grace = self.user("Grace Ong", Role.lead)
        self.daniel = self.user("Daniel Ortiz", Role.venue)
        self.wei = self.user("Wei Lim", Role.tech)

    def user(self, name, role, active=True) -> User:
        user = User(email=f"{name.split()[0].lower()}@connectsphere.edu", name=name, role=role, password_hash="x",
                    is_active=active, failed_login_attempts=0, session_version=0)
        self.db.add(user)
        self.db.commit()
        return user

    def book(self, event, venue, status="approved", attendance=None, layout="theatre") -> models.VenueBooking:
        """A venue booking of the event, and the event's own booking state brought in line with it."""
        booking = models.VenueBooking(
            event_id=event.id, event_name=event.name, venue_id=venue.id, venue_name=venue.name, status=status, date=event.date,
            start_time=event.start_time.strftime("%H:%M"), end_time=event.end_time.strftime("%H:%M"),
            setup_minutes=venue.setupMinutes, teardown_minutes=venue.turnaroundMinutes,
            hold_start=datetime.combine(event.date, time(9, 30)), hold_end=datetime.combine(event.date, time(12, 45)),
            attendance=attendance or event.expected_attendance, layout=layout, verdict="suitable",
            requested_by=self.priya.email, requested_at=NOW)
        self.db.add(booking)
        venue_bookings.summarise(self.db, event)
        self.db.commit()
        return booking

    def ready_event(self, name="Career Fair", venue=None, **fields) -> models.Event:
        """An approved event of Priya's whose one venue booking is approved and that asks for no equipment:
        its venue and technical arrangements are confirmed, so it can be sent to the safety check."""
        fields.setdefault("organiser_id", self.maya.id)
        fields.setdefault("coordinator_id", self.priya.id)
        event = self.event(name=name, **fields)
        self.book(event, venue or self.venue(name=f"Hall for {name}"))
        return event

    def waiting_event(self, name="Career Fair", **fields) -> models.Event:
        """A ready event that Priya has sent to the safety check."""
        event = self.ready_event(name, **fields)
        self.send_to_check(event, self.priya)
        return event

    def send_to_check(self, event, user):
        """The coordinator's request for the safety check, through the endpoint, as the page makes it."""
        return main.request_safety_check(event.id, db=self.db, user=user)

    def decide_check(self, event, outcome, comment="", user=None):
        body = schemas.SafetyDecisionIn(outcome=outcome, comment=comment)
        return main.decide_safety_check(event.id, body, db=self.db, user=user or self.hannah)

    def refusal(self, call, *args, **kwargs) -> HTTPException:
        with self.assertRaises(HTTPException) as ctx:
            call(*args, **kwargs)
        return ctx.exception

    def stored(self, event) -> models.Event:
        self.db.expire_all()
        return self.db.get(models.Event, event.id)

    def history(self, event) -> list:
        self.db.expire_all()
        rows = (self.db.query(models.EventStatusChange).filter_by(event_id=event.id)
                .order_by(models.EventStatusChange.id).all())
        return [(r.from_status, r.to_status, r.changed_by_id, r.reason) for r in rows]

    def notices(self, user) -> list:
        self.db.expire_all()
        return [(n.title, n.body) for n in self.db.query(models.Notification).filter_by(recipient_id=user.id).order_by(models.Notification.id)]

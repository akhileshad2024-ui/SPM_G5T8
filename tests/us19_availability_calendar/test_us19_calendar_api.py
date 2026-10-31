"""
US19 — View Venue Availability Calendar (Week 7 changes CR-W7-1, CR-W7-4), through the API.

"As an authorised internal user, I want to view a venue availability calendar showing bookings and
recorded unavailable periods so that I can identify potential event times."

Drives the real FastAPI app with real session cookies on a throwaway SQLite database, never Supabase.
Bookings are made the way users make them, then the viewer reads GET /venues/availability. The criterion
each test covers (US19-AC1..AC6) is in its name. Day, week and month navigation (AC2) and how the periods
look (AC4) are on the page: see calendar.unit.test.ts and tests/functional/us19-availability-calendar.spec.ts.
"""

from datetime import datetime, timedelta, timezone

import pytest

import models
from auth_testkit import get_user
from login.models import Role

MON = "2027-01-04"  # a Monday
TUE = "2027-01-05"
WEEK_END = "2027-01-10"
THEATRE = {
    "name": "Lecture Theatre 1", "location": "North wing", "cap": 250,
    "layouts": ["theatre", "classroom"], "facilities": ["Projector"], "accessibility": [],
    "operatingHours": "08:00 - 22:00", "operatingDays": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    "setupMinutes": 30, "turnaroundMinutes": 45,
}


@pytest.fixture
def staff(signed_in):
    return signed_in(Role.venue)


@pytest.fixture
def coordinator(signed_in):
    return signed_in(Role.coordinator)


@pytest.fixture
def organiser(signed_in):
    return signed_in(Role.organiser)


@pytest.fixture
def lead(signed_in):
    return signed_in(Role.lead)


@pytest.fixture
def venue(staff):
    res = staff.post("/venues", json=THEATRE)
    assert res.status_code == 200, res.text
    return res.json()


@pytest.fixture
def approved_event(organiser, coordinator, lead, db):
    """make() -> the id of an event assigned to Priya by the Lead, reviewed and approved, ready to book."""

    def make(name="Design Keynote", day=MON, start="10:00", end="12:00"):
        res = organiser.post("/events", json={
            "submit": True, "name": name, "description": "US19 test.", "eventType": "Conference",
            "expectedAttendance": 100, "preferredDate": day, "startTime": start, "endTime": end,
            "venue": {"location": "North wing", "capacity": 200, "layout": "theatre", "accessibility": [], "facilities": []},
            "equipment": [], "registration": {"required": False, "capacityLimit": None, "closingDate": None},
        })
        assert res.status_code == 201, res.text
        event_id = res.json()["id"]
        priya = get_user(db, Role.coordinator)
        assert lead.post(f"/events/{event_id}/assign", json={"coordinatorId": priya.id}).is_success
        for step, body in (("review", {}), ("decision", {"outcome": "approved", "reason": ""})):
            assert coordinator.post(f"/events/{event_id}/{step}", json=body).is_success
        return event_id

    return make


@pytest.fixture
def held(coordinator, venue, approved_event):
    """make() -> a pending booking request (a tentative hold) for a new approved event."""

    def make(name="Design Keynote", **when):
        res = coordinator.post(f"/venues/{venue['id']}/booking-requests", json={"event_id": approved_event(name, **when)})
        assert res.status_code == 200, res.text
        return res.json()["booking"]

    return make


@pytest.fixture
def confirmed(held, staff):
    """make() -> a booking Venue Staff have approved."""

    def make(name="Design Keynote", **when):
        booking = held(name, **when)
        res = staff.post(f"/bookings/{booking['id']}/decision", json={"outcome": "approved", "reason": ""})
        assert res.status_code == 200, res.text
        return booking

    return make


def calendar(session, start=MON, end=WEEK_END):
    res = session.get("/venues/availability", params={"start": start, "end": end})
    assert res.status_code == 200, res.text
    return res.json()


def periods(session, venue, **days):
    return next(v for v in calendar(session, **days) if v["id"] == venue["id"])["periods"]


def expire(db, booking):
    """Given: the hold's expiry has passed."""
    row = db.get(models.VenueBooking, booking["id"])
    row.hold_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()


class TestAC1ShowsBookingsAndUnavailablePeriods:
    def test_US19_AC1_each_venue_shows_its_confirmed_pending_and_unavailable_periods(self, staff, venue, confirmed, held):
        confirmed("Gala", day=MON)
        held("Workshop", day=TUE)
        assert staff.put(f"/venues/{venue['id']}", json={"unavailability": [
            {"start": "2027-01-06T08:00", "end": "2027-01-06T20:00", "reason": "maintenance", "note": "Floor repairs"},
        ]}).is_success

        rows = periods(staff, venue)
        assert [(p["kind"], p["start"][:10]) for p in rows] == [
            ("confirmed", MON), ("pending", TUE), ("unavailable", "2027-01-06"),
        ]
        assert (rows[2]["reason"], rows[2]["note"]) == ("maintenance", "Floor repairs")

    def test_US19_AC1_a_venue_with_nothing_booked_is_still_listed(self, staff, venue):
        assert calendar(staff) == [{
            "id": venue["id"], "name": "Lecture Theatre 1", "setup_minutes": 30, "turnaround_minutes": 45, "periods": [],
        }]

    def test_US19_AC1_a_deactivated_venue_is_left_out(self, staff, venue):
        assert staff.put(f"/venues/{venue['id']}", json={"is_active": False}).is_success
        assert calendar(staff) == []

    def test_US19_AC1_rejected_and_cancelled_bookings_are_left_out(self, staff, coordinator, venue, held):
        rejected = held("Rejected One", day=MON)
        cancelled = held("Cancelled One", day=TUE)
        assert staff.post(f"/bookings/{rejected['id']}/decision", json={"outcome": "rejected", "reason": "Closed."}).is_success
        assert coordinator.post(f"/bookings/{cancelled['id']}/cancel").is_success
        assert periods(staff, venue) == []


class TestAC2OnlyTheDaysAskedFor:
    def test_US19_AC2_only_periods_within_the_days_asked_for_are_returned(self, staff, venue, confirmed):
        confirmed("Gala", day=MON)
        assert len(periods(staff, venue, start=MON, end=MON)) == 1
        assert periods(staff, venue, start=TUE, end=WEEK_END) == []

    def test_US19_AC2_a_period_that_starts_before_the_range_still_shows(self, staff, venue):
        assert staff.put(f"/venues/{venue['id']}", json={"unavailability": [
            {"start": "2026-12-28T08:00", "end": "2027-01-04T20:00", "reason": "renovation"},
        ]}).is_success
        assert [p["kind"] for p in periods(staff, venue, start=MON, end=MON)] == ["unavailable"]

    def test_US19_AC2_end_before_start_is_refused(self, staff):
        res = staff.get("/venues/availability", params={"start": TUE, "end": MON})
        assert res.status_code == 422
        assert res.json()["detail"] == "The end date can't be before the start date."

    def test_US19_AC2_a_range_beyond_a_month_view_is_refused(self, staff):
        res = staff.get("/venues/availability", params={"start": "2027-01-01", "end": "2027-03-04"})
        assert res.status_code == 422
        assert res.json()["detail"] == "The calendar shows at most 62 days at a time."


class TestAC3SetupAndTurnaround:
    def test_US19_AC3_the_time_range_includes_the_venues_setup_and_turnaround(self, staff, venue, confirmed):
        # The backlog's worked example: 10:00-12:00 with 30 min setup and 45 min turnaround.
        confirmed("Gala", day=MON, start="10:00", end="12:00")
        period = periods(staff, venue)[0]
        assert (period["start"], period["end"]) == (f"{MON}T09:30", f"{MON}T12:45")
        assert (period["event_start"], period["event_end"]) == ("10:00", "12:00")
        assert (period["setup_minutes"], period["turnaround_minutes"]) == (30, 45)

    def test_US19_AC3_the_range_follows_the_venues_current_settings(self, staff, venue, confirmed):
        confirmed("Gala", day=MON)
        assert staff.put(f"/venues/{venue['id']}", json={"setupMinutes": 60, "turnaroundMinutes": 15}).is_success
        period = periods(staff, venue)[0]
        assert (period["start"], period["end"]) == (f"{MON}T09:00", f"{MON}T12:15")


class TestAC5DetailsOnlyForAuthorisedViewers:
    def test_US19_AC5_the_assigned_coordinator_sees_their_event(self, coordinator, venue, confirmed):
        confirmed("Gala")
        assert periods(coordinator, venue)[0]["event_name"] == "Gala"

    def test_US19_AC5_venue_staff_see_every_event(self, staff, venue, confirmed):
        confirmed("Gala")
        assert periods(staff, venue)[0]["event_name"] == "Gala"

    def test_US19_AC5_the_lead_sees_live_events(self, lead, venue, confirmed):
        confirmed("Gala")
        assert periods(lead, venue)[0]["event_name"] == "Gala"

    def test_US19_AC5_technical_support_see_the_venue_busy_but_not_the_event(self, signed_in, venue, confirmed):
        confirmed("Secret Summit")
        tech = signed_in(Role.tech)

        res = tech.get("/venues/availability", params={"start": MON, "end": WEEK_END})
        assert res.status_code == 200, res.text
        assert "Secret Summit" not in res.text
        period = next(v for v in res.json() if v["id"] == venue["id"])["periods"][0]
        assert period["kind"] == "confirmed"
        assert (period["event_id"], period["event_name"]) == (None, None)
        assert period["start"] == f"{MON}T09:30"

    def test_US19_AC5_another_coordinator_sees_the_venue_busy_but_not_the_event(self, db, signed_in, venue, confirmed):
        confirmed("Secret Summit")
        event = db.query(models.Event).filter(models.Event.name == "Secret Summit").one()
        event.coordinator_id = None  # no longer this coordinator's event
        db.commit()

        res = signed_in(Role.coordinator).get("/venues/availability", params={"start": MON, "end": WEEK_END})
        assert res.status_code == 200, res.text
        assert "Secret Summit" not in res.text

    @pytest.mark.parametrize("role", [Role.organiser, Role.attendee])
    def test_US19_AC5_organisers_and_attendees_can_not_read_the_calendar(self, signed_in, role):
        res = signed_in(role).get("/venues/availability", params={"start": MON, "end": WEEK_END})
        assert res.status_code == 403

    def test_US19_AC5_it_needs_a_signed_in_user(self, client):
        assert client.get("/venues/availability", params={"start": MON, "end": WEEK_END}).status_code == 401


class TestAC6HoldExpiry:
    def test_US19_AC6_a_tentative_hold_shows_when_it_expires(self, staff, venue, held):
        booking = held("Workshop")
        period = periods(staff, venue)[0]
        assert period["kind"] == "pending"
        assert period["hold_expires_at"][:16] == booking["hold_expires_at"][:16]

    def test_US19_AC6_an_expired_hold_shows_as_released(self, db, staff, venue, held):
        expire(db, held("Workshop"))
        period = periods(staff, venue)[0]
        assert period["kind"] == "expired"
        assert period["hold_expires_at"] is not None

    def test_US19_AC6_reading_the_calendar_saves_a_lapsed_hold_as_expired(self, db, staff, venue, held):
        booking = held("Workshop")
        expire(db, booking)
        calendar(staff)
        db.expire_all()
        assert db.get(models.VenueBooking, booking["id"]).status == "expired"

    def test_US19_AC6_a_confirmed_booking_has_no_hold_expiry(self, staff, venue, confirmed):
        confirmed("Gala")
        assert periods(staff, venue)[0]["hold_expires_at"] is None

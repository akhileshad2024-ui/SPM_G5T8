"""
US19 — the calendar's rules on their own (backend/venue_calendar.py), without the app or a database.
The criterion each test covers is in its name. Through the API: test_us19_calendar_api.py.
"""

from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

import venue_calendar

NOW = datetime(2027, 1, 1, tzinfo=timezone.utc)
MON = date(2027, 1, 4)
VENUE = SimpleNamespace(setupMinutes=30, turnaroundMinutes=45, unavailability=[])
WEEK = venue_calendar.day_range(MON, MON + timedelta(days=6))


def booking(status="approved", day=MON, start="10:00", end="12:00", expires=None):
    return SimpleNamespace(status=status, date=day, start_time=start, end_time=end, hold_expires_at=expires,
                           event_id=7, event_name="Gala")


@pytest.mark.parametrize("first, last, message", [
    (MON, MON, None),
    (MON, MON + timedelta(days=61), None),
    (MON, MON + timedelta(days=62), "The calendar shows at most 62 days at a time."),
    (MON, MON - timedelta(days=1), "The end date can't be before the start date."),
])
def test_US19_AC2_range_error(first, last, message):
    assert venue_calendar.range_error(first, last) == message


def test_US19_AC2_day_range_covers_whole_days():
    first, last = venue_calendar.day_range(MON, MON)
    assert last - first == 24 * 60


def test_US19_AC3_stamp_is_local_wall_clock_time():
    first, _ = venue_calendar.day_range(MON, MON)
    assert venue_calendar.stamp(first + 570) == "2027-01-04T09:30"


def test_US19_AC3_a_booking_keeps_the_venue_busy_for_setup_and_turnaround():
    period = venue_calendar.booking_period(booking(), VENUE, WEEK, True, NOW)
    assert (period["start"], period["end"]) == ("2027-01-04T09:30", "2027-01-04T12:45")


def test_US19_AC3_a_venue_without_settings_counts_as_zero_minutes():
    venue = SimpleNamespace(setupMinutes=None, turnaroundMinutes=None, unavailability=None)
    period = venue_calendar.booking_period(booking(), venue, WEEK, True, NOW)
    assert (period["start"], period["setup_minutes"], period["turnaround_minutes"]) == ("2027-01-04T10:00", 0, 0)


def test_US19_AC2_a_booking_outside_the_range_gives_no_period():
    assert venue_calendar.booking_period(booking(day=MON - timedelta(days=2)), VENUE, WEEK, True, NOW) is None


def test_US19_AC2_turnaround_past_midnight_reaches_into_the_next_day():
    sunday = booking(day=MON - timedelta(days=1), start="23:00", end="23:45")  # turnaround ends 00:30 on Monday
    period = venue_calendar.booking_period(sunday, VENUE, WEEK, True, NOW)
    assert period["end"] == "2027-01-04T00:30"


def test_US19_AC5_details_are_left_out_for_a_viewer_who_may_not_see_the_event():
    period = venue_calendar.booking_period(booking(), VENUE, WEEK, False, NOW)
    assert (period["event_id"], period["event_name"]) == (None, None)


def test_US19_AC5_details_are_included_for_a_viewer_who_may_see_the_event():
    period = venue_calendar.booking_period(booking(), VENUE, WEEK, True, NOW)
    assert (period["event_id"], period["event_name"]) == (7, "Gala")


def test_US19_AC6_a_hold_past_its_expiry_counts_as_expired_even_before_that_is_saved():
    lapsed = booking(status="pending", expires=NOW - timedelta(minutes=1))
    assert venue_calendar.booking_period(lapsed, VENUE, WEEK, True, NOW)["kind"] == "expired"


def test_US19_AC6_a_hold_before_its_expiry_is_pending_with_the_expiry():
    expires = NOW + timedelta(hours=1)
    period = venue_calendar.booking_period(booking(status="pending", expires=expires), VENUE, WEEK, True, NOW)
    assert (period["kind"], period["hold_expires_at"]) == ("pending", expires)


def test_US19_AC6_a_confirmed_booking_does_not_show_its_old_hold_expiry():
    period = venue_calendar.booking_period(booking(expires=NOW), VENUE, WEEK, True, NOW)
    assert (period["kind"], period["hold_expires_at"]) == ("confirmed", None)


def test_US19_AC1_unavailable_periods_within_the_range_are_shown():
    venue = SimpleNamespace(unavailability=[
        {"start": "2027-01-05T08:00", "end": "2027-01-05T20:00", "reason": "maintenance", "note": "Floor repairs"},
        {"start": "2027-02-01T08:00", "end": "2027-02-01T20:00", "reason": "renovation"},
    ])
    assert venue_calendar.unavailable_periods(venue, WEEK) == [{
        "kind": "unavailable", "start": "2027-01-05T08:00", "end": "2027-01-05T20:00",
        "reason": "maintenance", "note": "Floor repairs",
    }]


def test_US19_AC1_a_period_with_an_unreadable_time_is_skipped():
    venue = SimpleNamespace(unavailability=[{"start": "soon", "end": "2027-01-05T20:00", "reason": "other"}])
    assert venue_calendar.unavailable_periods(venue, WEEK) == []


def test_US19_AC1_a_venue_with_no_recorded_periods_has_none():
    assert venue_calendar.unavailable_periods(SimpleNamespace(unavailability=None), WEEK) == []

"""
US42 — Expire Tentative Venue Holds: the rules in backend/hold_expiry.py, one function at a time.
No API, no database: bookings are plain objects with the fields the rules read.

Criterion IDs follow the US42 card (AC1..AC4), as in the test names.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

import hold_expiry
from booking_request import BookingRefused

NOW = datetime(2027, 1, 1, 9, 0, tzinfo=timezone.utc)  # 17:00 in Singapore
# Setup starts 09:30 Singapore time on 4 Jan 2027 = 01:30 UTC.
SETUP_STARTS = datetime(2027, 1, 4, 1, 30, tzinfo=timezone.utc)


def booking(status="pending", expires=None, hold_start=datetime(2027, 1, 4, 9, 30)):
    return SimpleNamespace(status=status, hold_expires_at=expires, hold_start=hold_start, hold_expiry_set_by=None)


# ---------------------------------------------------------------- AC1: every hold has an expiry

def test_US42_AC1_a_new_hold_expires_three_days_after_the_request():
    requested = datetime(2026, 12, 20, 8, 0, tzinfo=timezone.utc)
    assert hold_expiry.default_expiry(booking(), requested) == requested + timedelta(days=3)


def test_US42_AC1_the_default_never_outlasts_the_start_of_setup():
    requested = SETUP_STARTS - timedelta(days=1)
    assert hold_expiry.default_expiry(booking(), requested) == SETUP_STARTS


def test_US42_AC1_setup_start_is_read_as_campus_time():
    assert hold_expiry.setup_starts_at(booking()) == SETUP_STARTS


def test_US42_AC1_venue_staff_set_an_expiry_in_utc_and_who_set_it_is_recorded():
    b = booking(expires=NOW + timedelta(days=3))
    wanted = datetime(2027, 1, 2, 18, 0, tzinfo=timezone(timedelta(hours=8)))  # 18:00 Singapore

    hold_expiry.set_expiry(b, wanted, "daniel.ortiz@connectsphere.edu", NOW)

    assert b.hold_expires_at == datetime(2027, 1, 2, 10, 0, tzinfo=timezone.utc)
    assert b.hold_expiry_set_by == "daniel.ortiz@connectsphere.edu"


@pytest.mark.parametrize("when, error", [
    (NOW, "The expiry must be in the future."),
    (NOW - timedelta(minutes=1), "The expiry must be in the future."),
    (SETUP_STARTS + timedelta(minutes=1), "The hold can't last beyond the start of setup for the event."),
])
def test_US42_AC1_the_expiry_must_be_in_the_future_and_before_setup(when, error):
    with pytest.raises(BookingRefused) as refused:
        hold_expiry.check_expiry(booking(), when, NOW)
    assert refused.value.message == error


def test_US42_AC1_an_expiry_exactly_at_the_start_of_setup_is_allowed():
    assert hold_expiry.check_expiry(booking(), SETUP_STARTS, NOW) == SETUP_STARTS


def test_US42_AC1_the_expiry_needs_a_time_zone():
    with pytest.raises(BookingRefused, match="time zone"):
        hold_expiry.check_expiry(booking(), datetime(2027, 1, 2, 18, 0), NOW)


@pytest.mark.parametrize("status", ["approved", "rejected", "cancelled", "expired"])
def test_US42_AC1_only_a_pending_request_has_a_hold_to_set(status):
    with pytest.raises(BookingRefused, match=f"this one is {status}"):
        hold_expiry.check_expiry(booking(status=status), NOW + timedelta(hours=1), NOW)


def test_US42_AC1_a_hold_that_has_already_lapsed_cannot_be_extended():
    with pytest.raises(BookingRefused, match="this one is expired"):
        hold_expiry.check_expiry(booking(expires=NOW - timedelta(seconds=1)), NOW + timedelta(hours=1), NOW)


# ---------------------------------------------------------------- AC2: holds lapse at their expiry

def test_US42_AC2_a_pending_hold_lapses_at_its_expiry_time():
    assert hold_expiry.is_lapsed(booking(expires=NOW), NOW) is True


def test_US42_AC2_a_pending_hold_is_kept_until_then():
    assert hold_expiry.is_lapsed(booking(expires=NOW + timedelta(seconds=1)), NOW) is False


@pytest.mark.parametrize("status", ["approved", "rejected", "cancelled"])
def test_US42_AC2_only_unapproved_holds_lapse(status):
    # Approving before the expiry is the required action: an approved booking keeps its venue.
    assert hold_expiry.is_lapsed(booking(status=status, expires=NOW - timedelta(days=1)), NOW) is False


def test_US42_AC2_a_booking_saved_before_holds_had_an_expiry_never_lapses():
    assert hold_expiry.is_lapsed(SimpleNamespace(status="pending"), NOW) is False


def test_US42_AC2_times_saved_without_a_zone_are_read_as_utc():
    assert hold_expiry.is_lapsed(booking(expires=datetime(2027, 1, 1, 9, 0)), NOW) is True


# ---------------------------------------------------------------- AC3: the coordinator is warned

def test_US42_AC3_no_notice_while_the_expiry_is_more_than_24_hours_away():
    assert hold_expiry.hold_notice(booking(expires=NOW + timedelta(hours=24, seconds=1)), NOW) is None


@pytest.mark.parametrize("left", [timedelta(hours=24), timedelta(hours=1), timedelta(seconds=1)])
def test_US42_AC3_warned_within_24_hours_of_expiry(left):
    assert hold_expiry.hold_notice(booking(expires=NOW + left), NOW) == "expiring_soon"


def test_US42_AC3_told_again_when_it_expires():
    assert hold_expiry.hold_notice(booking(expires=NOW), NOW) == "expired"
    assert hold_expiry.hold_notice(booking(status="expired", expires=NOW - timedelta(days=1)), NOW) == "expired"


@pytest.mark.parametrize("status", ["approved", "rejected", "cancelled"])
def test_US42_AC3_no_notice_once_the_request_has_been_decided(status):
    assert hold_expiry.hold_notice(booking(status=status, expires=NOW + timedelta(hours=1)), NOW) is None

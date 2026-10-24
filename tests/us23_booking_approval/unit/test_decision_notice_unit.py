"""
US23 — Approve or Reject Venue Booking: the rules behind telling the coordinator (AC5) and refusing
an expired hold (AC7), one function at a time. No API, no database.
"""

from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

import venue_bookings
from booking_request import BookingRefused

NOW = datetime(2027, 1, 1, 9, 0, tzinfo=timezone.utc)


def decided(status, ago):
    return SimpleNamespace(status=status, decided_at=NOW - ago)


# ---------------------------------------------------------------- AC5: the coordinator is told

@pytest.mark.parametrize("status", ["approved", "rejected"])
def test_US23_AC5_a_recent_decision_is_passed_on_to_the_coordinator(status):
    assert venue_bookings.decision_notice(decided(status, timedelta(hours=1)), NOW) == status


def test_US23_AC5_still_shown_exactly_seven_days_later():
    assert venue_bookings.decision_notice(decided("approved", timedelta(days=7)), NOW) == "approved"


def test_US23_AC5_no_longer_shown_after_seven_days():
    assert venue_bookings.decision_notice(decided("approved", timedelta(days=7, seconds=1)), NOW) is None


@pytest.mark.parametrize("status", ["pending", "cancelled", "expired"])
def test_US23_AC5_only_decisions_are_passed_on(status):
    assert venue_bookings.decision_notice(decided(status, timedelta(hours=1)), NOW) is None


def test_US23_AC5_a_booking_never_decided_has_no_notice():
    assert venue_bookings.decision_notice(SimpleNamespace(status="approved", decided_at=None), NOW) is None


def test_US23_AC5_times_saved_without_a_zone_are_read_as_utc():
    row = SimpleNamespace(status="rejected", decided_at=datetime(2027, 1, 1, 8, 0))  # SQLite drops the zone
    assert venue_bookings.decision_notice(row, NOW) == "rejected"


# ---------------------------------------------------------------- AC7: an expired hold can't be approved

def expired_booking(expires=datetime(2026, 12, 31, 10, 0, tzinfo=timezone.utc)):
    return SimpleNamespace(status="pending", hold_expires_at=expires, event_id=1, venue_id=1,
                           hold_start=datetime(2027, 1, 4, 9, 30), date=date(2027, 1, 4))


def test_US23_AC7_an_expired_hold_cannot_be_approved():
    with pytest.raises(BookingRefused) as refused:
        venue_bookings.decide(MagicMock(), expired_booking(), "approved", "", "daniel@connectsphere.edu", NOW)
    # 10:00 UTC is 18:00 on campus.
    assert refused.value.message == "This tentative hold expired on 31 Dec 2026, 18:00 and can't be approved."


def test_US23_AC7_rejecting_an_expired_hold_explains_the_venue_is_already_free():
    with pytest.raises(BookingRefused) as refused:
        venue_bookings.decide(MagicMock(), expired_booking(), "rejected", "No longer needed.", "daniel@connectsphere.edu", NOW)
    assert refused.value.message == "This tentative hold expired on 31 Dec 2026, 18:00, so the venue has already been released."


def test_US23_AC7_a_booking_already_saved_as_expired_is_refused_too():
    booking = expired_booking()
    booking.status = "expired"
    with pytest.raises(BookingRefused, match="can't be approved"):
        venue_bookings.decide(MagicMock(), booking, "approved", "", "daniel@connectsphere.edu", NOW)


def test_US23_AC7_the_expired_hold_is_never_marked_approved():
    booking = expired_booking()
    with pytest.raises(BookingRefused):
        venue_bookings.decide(MagicMock(), booking, "approved", "", "daniel@connectsphere.edu", NOW)
    assert booking.status == "expired"


def test_US23_AC7_an_expired_booking_without_a_recorded_expiry_is_still_refused():
    booking = expired_booking(expires=None)
    booking.status = "expired"
    with pytest.raises(BookingRefused) as refused:
        venue_bookings.decide(MagicMock(), booking, "approved", "", "daniel@connectsphere.edu", NOW)
    assert refused.value.message == "This tentative hold expired and can't be approved."

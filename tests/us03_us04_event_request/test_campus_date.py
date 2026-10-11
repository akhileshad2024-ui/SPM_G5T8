"""
US03 — "cannot enter an event date in the past", judged by the campus (Singapore) date.

The server clock runs in UTC, which is still the previous day until 08:00 in
Singapore; using it would let yesterday's date through every morning.
"""

from datetime import date, datetime, timezone

import schemas


def test_campus_date_is_ahead_of_utc_after_4pm_utc():
    # 2026-10-07 17:30 UTC is 2026-10-08 01:30 in Singapore.
    assert schemas.campus_today(datetime(2026, 10, 7, 17, 30, tzinfo=timezone.utc)) == date(2026, 10, 8)


def test_campus_date_matches_utc_during_the_singapore_day():
    assert schemas.campus_today(datetime(2026, 10, 8, 4, 0, tzinfo=timezone.utc)) == date(2026, 10, 8)


def test_campus_midnight_boundary():
    assert schemas.campus_today(datetime(2026, 10, 7, 15, 59, tzinfo=timezone.utc)) == date(2026, 10, 7)
    assert schemas.campus_today(datetime(2026, 10, 7, 16, 0, tzinfo=timezone.utc)) == date(2026, 10, 8)


def test_yesterday_is_refused_just_after_midnight_in_singapore():
    just_after_midnight = datetime(2026, 10, 7, 16, 30, tzinfo=timezone.utc)  # 00:30 on 8 Oct in Singapore
    request = schemas.EventRequestIn(preferredDate=date(2026, 10, 7))

    errors = schemas.submission_errors(request, schemas.campus_today(just_after_midnight))

    assert errors["preferredDate"] == "Preferred date cannot be in the past."


def test_today_is_accepted():
    now = datetime(2026, 10, 7, 16, 30, tzinfo=timezone.utc)
    request = schemas.EventRequestIn(preferredDate=date(2026, 10, 8))

    assert "preferredDate" not in schemas.submission_errors(request, schemas.campus_today(now))

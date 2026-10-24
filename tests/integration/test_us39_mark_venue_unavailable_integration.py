"""
Integration tests for US39 — Mark Venue Temporarily Unavailable.

"As a Venue Staff member, I want to mark a venue temporarily unavailable for a period so that it
is not used or booked while it cannot operate."

These drive the real FastAPI app through TestClient against an in-memory SQLite database, reusing
the US22 setup (events made the way users make them, then a real booking request).

AC1: record a period with a start, an end and a reason ................ TestRecordPeriod
AC2: the venue is left out of search for that period ................... TestSearch
AC3: overlapping bookings are flagged as needing alternatives ......... TestFlagging
AC4: nothing is cancelled; the event's information is kept ............ TestFlagging
AC5: the coordinator sees the flag on their bookings .................. TestFlagging
AC6: a period can be edited or ended early ............................ TestEditOrEndEarly

Run by hand from the repo root:
    python -m unittest discover -s tests/integration -p "test_us39_*.py" -v
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_us22_submit_booking_request_integration import MON, BookingApiTestCase

ALL_DAY = {"start": f"{MON}T08:00", "end": f"{MON}T20:00", "reason": "maintenance"}


class US39TestCase(BookingApiTestCase):
    def set_periods(self, periods, client=None):
        return (client or self.staff).put(f"/venues/{self.venue['id']}", json={"unavailability": periods})

    def booked_event(self, name="Design Keynote", approve_booking=True) -> tuple:
        event_id = self.make_event(name=name)
        booking = self.submit(event_id).json()["booking"]
        if approve_booking:
            self.assertTrue(self.decide(booking["id"], "approved").is_success)
        return event_id, booking["id"]

    def booking(self, booking_id, client=None) -> dict:
        rows = (client or self.coordinator).get("/bookings").json()
        return next(b for b in rows if b["id"] == booking_id)


class TestRecordPeriod(US39TestCase):
    def test_venue_staff_record_a_period_with_a_reason(self):
        res = self.set_periods([ALL_DAY])
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["unavailability"][0]["reason"], "maintenance")

    def test_other_needs_a_description_and_the_end_must_follow_the_start(self):
        self.assertEqual(self.set_periods([{**ALL_DAY, "reason": "other"}]).status_code, 422)
        self.assertEqual(self.set_periods([{**ALL_DAY, "end": f"{MON}T07:00"}]).status_code, 422)
        self.assertEqual(self.set_periods([{**ALL_DAY, "reason": "other", "note": "Flooding"}]).status_code, 200)

    def test_only_venue_staff_can_mark_a_venue_unavailable(self):
        self.assertEqual(self.set_periods([ALL_DAY], client=self.coordinator).status_code, 403)


class TestSearch(US39TestCase):
    def test_the_venue_is_left_out_of_search_for_that_period(self):
        criteria = {"date": MON, "start": "10:00", "end": "12:00"}
        self.assertEqual(self.coordinator.post("/venues/search", json=criteria).json()["total"], 1)
        self.set_periods([ALL_DAY])
        self.assertEqual(self.coordinator.post("/venues/search", json=criteria).json()["total"], 0)


class TestFlagging(US39TestCase):
    def test_a_confirmed_booking_is_flagged_kept_and_returned(self):
        event_id, booking_id = self.booked_event()
        before = self.event_as(self.coordinator, event_id)

        res = self.set_periods([ALL_DAY])
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual([b["id"] for b in res.json()["flagged_bookings"]], [booking_id])

        saved = self.booking(booking_id)
        self.assertEqual(saved["status"], "approved")
        self.assertEqual(saved["flag"]["kind"], "venue_unavailable")
        self.assertIn("replacement venue is required", saved["flag"]["message"])

        after = self.event_as(self.coordinator, event_id)
        self.assertEqual(after["status"], before["status"])
        self.assertEqual(after["bookingState"], "approved")
        self.assertEqual(after["venue"], self.venue["id"])
        self.assertEqual((after["date"], after["start"], after["end"]), (before["date"], before["start"], before["end"]))

    def test_a_pending_request_is_flagged_too(self):
        _, booking_id = self.booked_event(approve_booking=False)
        self.set_periods([ALL_DAY])
        self.assertEqual(self.booking(booking_id)["flag"]["reason"], "maintenance")

    def test_a_booking_on_another_day_is_not_flagged(self):
        _, booking_id = self.booked_event()
        res = self.set_periods([{**ALL_DAY, "start": "2027-01-05T08:00", "end": "2027-01-05T20:00"}])
        self.assertEqual(res.json()["flagged_bookings"], [])
        self.assertIsNone(self.booking(booking_id)["flag"])

    def test_saving_the_same_period_again_does_not_flag_twice(self):
        self.booked_event()
        self.set_periods([ALL_DAY])
        self.assertEqual(self.set_periods([ALL_DAY, {**ALL_DAY, "start": "2027-02-01T08:00", "end": "2027-02-01T09:00"}])
                         .json()["flagged_bookings"], [])


class TestEditOrEndEarly(US39TestCase):
    def test_ending_the_period_early_clears_the_flag(self):
        _, booking_id = self.booked_event()
        self.set_periods([ALL_DAY])
        res = self.set_periods([{**ALL_DAY, "end": f"{MON}T09:00"}])  # booking holds the venue from 09:30
        self.assertEqual(res.status_code, 200, res.text)
        self.assertIsNone(self.booking(booking_id)["flag"])

    def test_removing_the_period_clears_the_flag_and_the_change_is_recorded(self):
        _, booking_id = self.booked_event()
        self.set_periods([ALL_DAY])
        self.set_periods([])
        self.assertIsNone(self.booking(booking_id)["flag"])
        history = self.staff.get(f"/venues/{self.venue['id']}/history").json()
        self.assertEqual(sum("unavailability" in row["changes"] for row in history), 3)  # created, set, removed


if __name__ == "__main__":
    unittest.main()

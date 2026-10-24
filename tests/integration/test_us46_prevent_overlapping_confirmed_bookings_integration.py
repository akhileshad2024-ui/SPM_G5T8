"""
Integration tests for US46 — Prevent Overlapping Confirmed Bookings.

"As a Venue Staff member, I want the system to prevent a booking from being confirmed when it overlaps a
confirmed booking for the same venue so that a venue is not double-booked."

These drive the real FastAPI app through TestClient against an in-memory SQLite database, reusing the US22
setup (events made the way users make them, then real booking requests and decisions). The overlap and
confirmation rules are unit tested in tests/unit/venue/test_us46_*.py; here the point is that they work
through the web layer and a real database.

AC1: a booking that overlaps a confirmed booking at the same venue can't be confirmed ..... TestConfirmationIsPrevented
AC2: the venue's configured setup and turnaround time count around both bookings ......... TestConfirmationIsPrevented
AC3: the conflicting booking's details are shown ..................................... TestConfirmationIsPrevented
AC4: the check is made again when the booking is confirmed .............................. TestCheckedAgainAtConfirmation
The backlog's test case: 10:00 to 12:00 at a venue with 30 minutes setup and 45 minutes turnaround occupies
the venue from 09:30 to 12:45.

Run by hand from the repo root:
    python -m unittest discover -s tests/integration -p "test_us46_*.py" -v
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_us22_submit_booking_request_integration import DAY, BookingApiTestCase
from venue_availability import format_date

WHEN = format_date(DAY)
GALA_CLASH = f"Clashes with Gala, already booked on {WHEN} (venue occupied 09:30–12:45 incl. 30 min setup and 45 min turnaround)."


class US46TestCase(BookingApiTestCase):
    def confirmed_gala(self, venue_id=None, start="10:00", end="12:00") -> dict:
        """Gala's booking, requested and confirmed by Venue Staff."""
        gala = self.requested("Gala", start, end, venue_id=venue_id)
        self.assertEqual(self.decide(gala["id"], "approved").status_code, 200)
        return gala


class TestConfirmationIsPrevented(US46TestCase):
    def test_a_booking_that_overlaps_a_confirmed_one_is_refused_and_stays_pending(self):
        self.confirmed_gala()
        fair = self.requested("Fair", "11:00", "13:00", acknowledged=True)  # unsuitable while Gala holds the venue

        res = self.decide(fair["id"], "approved")

        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()["detail"], f"Can't approve: {GALA_CLASH}")
        self.assertEqual(self.staff_view()["Fair"]["status"], "pending")

    def test_windows_that_only_touch_are_confirmed_and_one_minute_more_is_refused(self):
        self.confirmed_gala()  # occupies the venue until 12:45
        touching = self.requested("Touching Fair", "13:15", "15:00")  # its setup starts at 12:45
        self.assertEqual(self.decide(touching["id"], "approved").status_code, 200)
        overlapping = self.requested("Overlapping Fair", "13:14", "15:00", acknowledged=True)

        self.assertEqual(self.decide(overlapping["id"], "approved").status_code, 409)

    def test_the_other_bookings_turnaround_counts_too(self):
        hall = self.flat_venue("Long Turnaround Hall", turnaroundMinutes=120)
        self.confirmed_gala(venue_id=hall)  # Gala holds the hall until 14:00
        at_two = self.requested("At Two", "14:00", "15:00", venue_id=hall)
        self.assertEqual(self.decide(at_two["id"], "approved").status_code, 200)
        one_minute_early = self.requested("One Minute Early", "13:59", "15:00", venue_id=hall, acknowledged=True)

        self.assertEqual(self.decide(one_minute_early["id"], "approved").status_code, 409)

    def test_venue_staff_are_shown_the_conflicting_booking_before_they_decide(self):
        gala = self.confirmed_gala()
        self.requested("Fair", "11:00", "13:00", acknowledged=True)

        [conflict] = self.staff_view()["Fair"]["conflicts"]

        self.assertEqual(conflict, {
            "kind": "confirmed_booking", "blocks_approval": True, "message": GALA_CLASH,
            "booking_id": gala["id"], "event_id": gala["event_id"], "event_name": "Gala", "status": "approved",
            "date": DAY.isoformat(), "start": "10:00", "end": "12:00",
            "occupied_start": f"{DAY}T09:30:00", "occupied_end": f"{DAY}T12:45:00",
            "period_start": None, "period_end": None, "reason": None, "note": None,
        })

    def test_a_confirmed_booking_at_another_venue_does_not_stop_it(self):
        other_hall = self.flat_venue("Other Hall")
        self.confirmed_gala(venue_id=other_hall)
        fair = self.requested("Fair", "10:00", "12:00")  # the theatre

        self.assertEqual(self.decide(fair["id"], "approved").status_code, 200)


class TestCheckedAgainAtConfirmation(US46TestCase):
    def test_a_booking_that_was_clear_when_requested_is_refused_after_the_venues_times_grew(self):
        hall = self.flat_venue("Growing Hall")
        self.confirmed_gala(venue_id=hall)
        fair = self.requested("Fair", "12:30", "14:00", venue_id=hall)  # clear while the hall has no setup or turnaround time
        self.assertEqual(self.staff.put(f"/venues/{hall}", json={"setupMinutes": 45}).status_code, 200)

        res = self.decide(fair["id"], "approved")

        self.assertEqual(res.status_code, 409)
        self.assertIn("venue occupied 09:15–12:00 incl. 45 min setup", res.json()["detail"])

    def test_a_booking_that_was_clear_when_requested_is_refused_after_another_was_confirmed(self):
        # Two coordinators asked for overlapping times at the same moment, so both were saved as pending.
        gala = self.requested("Gala", "10:00", "12:00")
        fair_event = self.make_event("Fair", preferredDate=DAY.isoformat(), startTime="11:00", endTime="13:00")
        fair = self.put_booking(fair_event, self.venue["id"])
        self.assertEqual(self.decide(gala["id"], "approved").status_code, 200)

        res = self.decide(fair.id, "approved")

        self.assertEqual(res.status_code, 409)
        self.assertIn("Clashes with Gala, already booked", res.json()["detail"])


if __name__ == "__main__":
    unittest.main()

"""
Integration tests for US48 — Include Unavailable Periods and Expired Holds in Conflict Checks.

"As a Venue Staff member, I want the conflict check to account for venue unavailable periods and expired
holds so that availability reflects the venue's real situation."

These drive the real FastAPI app through TestClient against an in-memory SQLite database, reusing the US22
setup. The rules are unit tested in tests/unit/venue/test_us48_*.py.

AC1: a recorded venue unavailable period is treated as a conflict, the same as a confirmed booking
     TestUnavailablePeriodsAreConflicts
AC2: expired tentative holds are excluded from the conflict check ..... TestExpiredHoldsAreLeftOut
     AC2 depends on US42, which is not built: nothing in the app sets a hold's expiry time yet, so these
     tests save holds that have expired straight into the database.

Run by hand from the repo root:
    python -m unittest discover -s tests/integration -p "test_us48_*.py" -v
"""

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_us22_submit_booking_request_integration import DAY, BookingApiTestCase
from venue_availability import format_date

WHEN = format_date(DAY)


def minutes_from_now(minutes) -> datetime:
    return datetime.now(timezone.utc) + timedelta(minutes=minutes)


class US48TestCase(BookingApiTestCase):
    def period(self, start, end, reason="maintenance", note=None) -> dict:
        return {"start": f"{DAY}T{start}", "end": f"{DAY}T{end}", "reason": reason, **({"note": note} if note else {})}

    def set_periods(self, venue_id, *periods):
        return self.staff.put(f"/venues/{venue_id}", json={"unavailability": list(periods)})


class TestUnavailablePeriodsAreConflicts(US48TestCase):
    def test_a_period_over_a_pending_booking_stops_it_being_approved_until_the_period_is_ended(self):
        booking = self.requested("Career Fair", "10:00", "12:00")
        self.assertEqual(self.set_periods(self.venue["id"], self.period("08:00", "20:00", note="Floor repairs")).status_code, 200)

        [conflict] = self.staff_view()["Career Fair"]["conflicts"]
        refused = self.decide(booking["id"], "approved")

        self.assertEqual((conflict["kind"], conflict["blocks_approval"], conflict["reason"], conflict["note"]),
                         ("unavailable_period", True, "maintenance", "Floor repairs"))
        self.assertEqual(refused.status_code, 409)
        self.assertEqual(refused.json()["detail"], f"Can't approve: Lecture Theatre 1 is unavailable (Maintenance: Floor repairs) "
                                                   f"from {WHEN}, 08:00 to {WHEN}, 20:00.")
        # Ended at 09:00, before the booking's setup begins at 09:30, it is no longer in the way.
        self.assertEqual(self.set_periods(self.venue["id"], self.period("08:00", "09:00", note="Floor repairs")).status_code, 200)
        self.assertEqual(self.staff_view()["Career Fair"]["conflicts"], [])
        self.assertEqual(self.decide(booking["id"], "approved").status_code, 200)

    def test_a_period_next_to_the_booking_only_clashes_once_its_setup_reaches_it(self):
        for ends, approved in (("09:30", True), ("09:31", False)):  # the booking's setup starts at 09:30
            with self.subTest(period_ends=ends):
                hall = self.flat_venue(f"Hall {ends}", setupMinutes=30, turnaroundMinutes=45)
                booking = self.requested(f"Fair {ends}", "10:00", "12:00", venue_id=hall)
                self.assertEqual(self.set_periods(hall, self.period("06:00", ends)).status_code, 200)

                self.assertEqual(self.decide(booking["id"], "approved").status_code, 200 if approved else 409)

    def test_a_confirmed_booking_inside_a_period_is_shown_it_but_stays_confirmed(self):
        booking = self.requested("Career Fair", "10:00", "12:00")
        self.assertEqual(self.decide(booking["id"], "approved").status_code, 200)

        self.set_periods(self.venue["id"], self.period("08:00", "20:00"))

        view = self.staff_view()["Career Fair"]
        self.assertEqual(view["status"], "approved")
        self.assertEqual([c["kind"] for c in view["conflicts"]], ["unavailable_period"])


class TestExpiredHoldsAreLeftOut(US48TestCase):
    def saved_hold(self, name="Expired Fair", status="pending", minutes=-1) -> object:
        event_id = self.make_event(name, preferredDate=DAY.isoformat(), startTime="10:00", endTime="12:00")
        return self.put_booking(event_id, self.venue["id"], status=status, hold_expires_at=minutes_from_now(minutes))

    def test_a_second_request_is_not_a_duplicate_of_a_hold_that_has_expired_and_neither_shows_a_conflict(self):
        self.saved_hold(minutes=-1)

        booking = self.requested("Career Fair", "10:00", "12:00")  # not refused as a duplicate, and suitable

        self.assertEqual((booking["status"], booking["verdict"], booking["override"]), ("pending", "suitable", None))
        view = self.staff_view()
        self.assertEqual((view["Expired Fair"]["conflicts"], view["Career Fair"]["conflicts"]), ([], []))

    def test_while_the_hold_has_not_expired_a_second_request_is_still_a_duplicate(self):
        self.saved_hold(minutes=60)

        res = self.submit(self.make_event("Career Fair", preferredDate=DAY.isoformat(), startTime="10:00", endTime="12:00"))

        self.assertEqual(res.status_code, 409)
        self.assertIn("already has a pending request", res.json()["detail"])

    def test_venue_search_sees_the_venue_as_free_once_the_only_hold_has_expired(self):
        hold = self.saved_hold(minutes=60)
        criteria = {"date": DAY.isoformat(), "start": "10:00", "end": "12:00"}
        self.assertEqual(self.coordinator.post("/venues/search", json=criteria).json()["total"], 0)

        hold.hold_expires_at = minutes_from_now(-1)
        self.db.commit()

        self.assertEqual(self.coordinator.post("/venues/search", json=criteria).json()["total"], 1)

    def test_a_confirmed_booking_never_expires(self):
        self.saved_hold(status="approved", minutes=-1)
        criteria = {"date": DAY.isoformat(), "start": "10:00", "end": "12:00"}

        self.assertEqual(self.coordinator.post("/venues/search", json=criteria).json()["total"], 0)


if __name__ == "__main__":
    unittest.main()

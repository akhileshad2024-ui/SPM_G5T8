"""
Integration tests for US47 — Flag Conflicting Pending Requests.

"As a Venue Staff member, I want pending booking requests that conflict with one another to be flagged so
that I can decide which one to approve."

These drive the real FastAPI app through TestClient against an in-memory SQLite database, reusing the US22
setup. A second pending request for the same venue and time is refused when it is made (US22 AC5), so
pending requests only end up in conflict after a venue's setup or turnaround time changes (US38), or when
two coordinators ask at the same moment, which a test shows by saving the second request straight into the
database. The flag rule is unit tested in tests/unit/venue/test_us47_*.py.

AC1: pending requests that conflict with one another are flagged for manual resolution
     TestConflictingRequestsAreFlagged, TestManualResolution, TestWhoIsSentTheFlags

Run by hand from the repo root:
    python -m unittest discover -s tests/integration -p "test_us47_*.py" -v
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_us22_submit_booking_request_integration import DAY, BookingApiTestCase
import models
from login.models import Role, User


class US47TestCase(BookingApiTestCase):
    def two_requests_that_overlap_after_a_venue_time_change(self):
        """Career Fair 10:00-12:00 and Open House 12:30-14:00 clear each other until the hall gets a 60 minute setup."""
        hall = self.flat_venue("Hall")
        fair = self.requested("Career Fair", "10:00", "12:00", venue_id=hall)
        house = self.requested("Open House", "12:30", "14:00", venue_id=hall)
        before = self.staff_view()
        self.assertEqual((before["Career Fair"]["conflicts"], before["Open House"]["conflicts"]), ([], []))
        self.assertEqual(self.staff.put(f"/venues/{hall}", json={"setupMinutes": 60}).status_code, 200)
        return hall, fair, house


class TestConflictingRequestsAreFlagged(US47TestCase):
    def test_pending_requests_that_overlap_after_a_venue_time_change_are_flagged_for_venue_staff(self):
        self.two_requests_that_overlap_after_a_venue_time_change()

        view = self.staff_view()

        [for_fair], [for_house] = view["Career Fair"]["conflicts"], view["Open House"]["conflicts"]
        self.assertEqual((for_fair["kind"], for_fair["event_name"], for_fair["blocks_approval"]), ("pending_request", "Open House", False))
        self.assertEqual((for_house["kind"], for_house["event_name"], for_house["blocks_approval"]), ("pending_request", "Career Fair", False))
        self.assertIn("already requested on", for_fair["message"])

    def test_two_requests_made_at_the_same_moment_are_flagged_too(self):
        self.requested("Career Fair", "10:00", "12:00")
        event = self.make_event("Open House", preferredDate=DAY.isoformat(), startTime="11:00", endTime="13:00")
        self.put_booking(event, self.venue["id"])

        view = self.staff_view()

        self.assertEqual([c["event_name"] for c in view["Career Fair"]["conflicts"]], ["Open House"])
        self.assertEqual([c["event_name"] for c in view["Open House"]["conflicts"]], ["Career Fair"])

    def test_requests_that_only_touch_are_not_flagged(self):
        self.requested("Career Fair", "10:00", "12:00")
        self.requested("Open House", "13:15", "15:00")  # its setup starts at 12:45, when Career Fair's turnaround ends

        view = self.staff_view()

        self.assertEqual((view["Career Fair"]["conflicts"], view["Open House"]["conflicts"]), ([], []))


class TestManualResolution(US47TestCase):
    def test_nothing_is_decided_for_venue_staff(self):
        self.two_requests_that_overlap_after_a_venue_time_change()

        self.staff_view()
        view = self.staff_view()  # asking again changes nothing either

        self.assertEqual((view["Career Fair"]["status"], view["Open House"]["status"]), ("pending", "pending"))

    def test_one_can_be_approved_and_then_the_other_is_refused_and_can_be_rejected(self):
        _, fair, house = self.two_requests_that_overlap_after_a_venue_time_change()

        self.assertEqual(self.decide(fair["id"], "approved").status_code, 200)  # a pending conflict does not stop an approval
        [conflict] = self.staff_view()["Open House"]["conflicts"]
        self.assertEqual((conflict["kind"], conflict["blocks_approval"]), ("confirmed_booking", True))
        self.assertEqual(self.decide(house["id"], "approved").status_code, 409)
        self.assertEqual(self.decide(house["id"], "rejected", "The Career Fair has the hall.").status_code, 200)

        self.assertEqual(self.staff_view()["Career Fair"]["conflicts"], [])  # nothing left to resolve


class TestWhoIsSentTheFlags(US47TestCase):
    def test_coordinators_are_not_sent_conflicts_and_never_another_coordinators_event(self):
        _, _, house = self.two_requests_that_overlap_after_a_venue_time_change()
        marcus = self.client(Role.coordinator, "marcus.lee@connectsphere.edu")
        marcus_id = self.db.query(User).filter(User.email == "marcus.lee@connectsphere.edu").first().id
        self.db.get(models.Event, house["event_id"]).coordinator_id = marcus_id  # Open House is Marcus's event
        self.db.commit()

        priyas = self.coordinator.get("/bookings")
        marcuss = marcus.get("/bookings")

        self.assertEqual([(b["event_name"], b["conflicts"]) for b in priyas.json()], [("Career Fair", [])])
        self.assertNotIn("Open House", priyas.text)
        self.assertEqual([(b["event_name"], b["conflicts"]) for b in marcuss.json()], [("Open House", [])])
        self.assertNotIn("Career Fair", marcuss.text)


if __name__ == "__main__":
    unittest.main()

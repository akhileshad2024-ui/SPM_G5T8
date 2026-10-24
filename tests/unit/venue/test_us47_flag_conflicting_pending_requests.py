"""
Unit tests for US47 — Flag Conflicting Pending Requests.

"As a Venue Staff member, I want pending booking requests that conflict with one another to be flagged so
that I can decide which one to approve."

AC1: sees pending requests that conflict with one another flagged for manual resolution ..
     TestConflictingPendingRequests (which requests are flagged, and with what),
     TestManualResolution (nothing is decided for Venue Staff; what happens as they resolve it),
     TestWhoSeesTheFlags (Venue Staff are sent the flags; coordinators are not)

A second pending request for the same venue and time is refused when it is made (US22 AC5), so two
pending requests only end up in conflict when a venue's setup or turnaround time changes (US38) or two
coordinators ask at the same moment. These tests save such bookings straight into the database.

The flag rule (backend/venue_conflicts.py) is called directly on plain values; the Venue Staff list
(backend/venue_bookings.py, main.list_bookings) runs on a real in-memory SQLite database, never Supabase,
reusing the US22 test setup. The integration tests check the same through the API.

Run from the repo root:
    python -m unittest discover -s tests/unit/venue -p "test_us47_*.py" -v
"""

import sys
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import HTTPException

from test_us22_submit_booking_request import COORDINATOR, MON, OTHER_COORDINATOR, REPO, STAFF, DatabaseTestCase
import main
import models
import venue_bookings
from venue_conflicts import CONFIRMED_BOOKING, PENDING_REQUEST, Slot, conflicts_for

NOW = datetime(2027, 1, 1, 9, 0, tzinfo=timezone.utc)
VENUE = SimpleNamespace(id=1, name="Lecture Theatre 1", setupMinutes=30, turnaroundMinutes=45, unavailability=[])


def slot(start="10:00", end="12:00", status="pending", id=1, event_id=1, name="Career Fair", day=MON) -> Slot:
    """A pending request of Career Fair on Monday 10:00-12:00 unless said otherwise."""
    return Slot(id, event_id, name, status, day, start, end)


def open_house(start="11:00", end="13:00", status="pending") -> Slot:
    return slot(start=start, end=end, status=status, id=2, event_id=2, name="Open House")


class TestConflictingPendingRequests(unittest.TestCase):
    def conflicts(self, mine, *others):
        return conflicts_for(mine, VENUE, others, NOW)

    def test_a_pending_request_is_flagged_with_the_pending_request_it_overlaps(self):
        [found] = self.conflicts(slot(), open_house())

        self.assertEqual((found["kind"], found["booking_id"], found["event_name"], found["status"]), (PENDING_REQUEST, 2, "Open House", "pending"))
        self.assertEqual(found["message"], "Clashes with Open House, already requested on 04 Jan 2027 "
                                           "(venue occupied 10:30–13:45 incl. 30 min setup and 45 min turnaround).")

    def test_the_flag_does_not_stop_either_request_being_approved_it_is_left_for_venue_staff_to_resolve(self):
        [found] = self.conflicts(slot(), open_house())

        self.assertFalse(found["blocks_approval"])

    def test_two_conflicting_requests_are_each_flagged_for_the_other(self):
        first, second = slot(), open_house()

        self.assertEqual([c["booking_id"] for c in self.conflicts(first, first, second)], [2])
        self.assertEqual([c["booking_id"] for c in self.conflicts(second, first, second)], [1])

    def test_requests_that_only_touch_are_not_flagged_but_one_minute_more_is(self):
        # Career Fair occupies 09:30-12:45, so a request whose setup starts at 12:45 is clear of it.
        for start, flagged in (("13:15", False), ("13:14", True)):
            with self.subTest(start=start):
                self.assertEqual(len(self.conflicts(slot(), open_house(start=start, end="15:00"))), 1 if flagged else 0)

    def test_a_request_that_overlaps_nothing_is_not_flagged(self):
        elsewhere_in_time = (
            open_house(start="16:00", end="17:00"),
            Slot(2, 2, "Open House", "pending", date(2027, 1, 5), "10:00", "12:00"),
        )
        for other in elsewhere_in_time:
            with self.subTest(other=(other.date, other.start)):
                self.assertEqual(self.conflicts(slot(), other), [])

    def test_a_request_can_conflict_with_several_and_each_lists_only_its_own(self):
        wide = slot(start="09:00", end="17:00", id=1, event_id=1, name="Wide")
        morning = slot(start="09:00", end="10:00", id=2, event_id=2, name="Morning")
        evening = slot(start="16:00", end="17:00", id=3, event_id=3, name="Evening")
        everyone = (wide, morning, evening)

        self.assertEqual([c["event_name"] for c in self.conflicts(wide, *everyone)], ["Morning", "Evening"])
        self.assertEqual([c["event_name"] for c in self.conflicts(morning, *everyone)], ["Wide"])
        self.assertEqual([c["event_name"] for c in self.conflicts(evening, *everyone)], ["Wide"])

    def test_a_confirmed_booking_is_not_shown_the_pending_requests_that_overlap_it(self):
        # The pending request shows the clash on its own card; the confirmed booking has nothing to resolve.
        confirmed = slot(status="approved")

        self.assertEqual(self.conflicts(confirmed, open_house()), [])
        self.assertEqual([c["kind"] for c in self.conflicts(open_house(), confirmed)], [CONFIRMED_BOOKING])


class ConflictingRequestsTestCase(DatabaseTestCase):
    def two_conflicting_requests(self):
        venue = self.venue()
        first = self.put_booking(venue, name="Career Fair", start="10:00", end="12:00")
        second = self.put_booking(venue, name="Open House", start="11:00", end="13:00")
        return venue, first, second

    def staff_view(self, *rows) -> dict:
        return {record["event_name"]: record for record in venue_bookings.staff_records(self.db, list(rows), NOW)}


class TestManualResolution(ConflictingRequestsTestCase):
    def test_both_conflicting_requests_are_flagged_for_venue_staff(self):
        _, first, second = self.two_conflicting_requests()

        view = self.staff_view(first, second)

        self.assertEqual([(c["kind"], c["event_name"]) for c in view["Career Fair"]["conflicts"]], [("pending_request", "Open House")])
        self.assertEqual([(c["kind"], c["event_name"]) for c in view["Open House"]["conflicts"]], [("pending_request", "Career Fair")])

    def test_nothing_is_decided_for_venue_staff(self):
        _, first, second = self.two_conflicting_requests()

        self.staff_view(first, second)

        self.db.expire_all()
        self.assertEqual([b.status for b in self.bookings()], ["pending", "pending"])
        self.assertEqual({e.booking_state for e in self.db.query(models.Event).all()}, {"pending"})

    def test_a_request_that_conflicts_with_another_pending_one_can_still_be_approved(self):
        _, first, _ = self.two_conflicting_requests()

        self.assertEqual(self.decide(first.id, "approved")["status"], "approved")

    def test_once_one_is_approved_the_other_is_in_the_way_of_a_confirmed_booking_and_cannot_be_approved(self):
        _, first, second = self.two_conflicting_requests()
        self.decide(first.id, "approved")

        [conflict] = self.staff_view(second)["Open House"]["conflicts"]
        with self.assertRaises(HTTPException) as refused:
            self.decide(second.id, "approved")

        self.assertEqual((conflict["kind"], conflict["blocks_approval"]), ("confirmed_booking", True))
        self.assertEqual(refused.exception.status_code, 409)

    def test_rejecting_one_clears_the_flag_on_the_other(self):
        _, first, second = self.two_conflicting_requests()

        self.decide(second.id, "rejected", "The hall is needed for the Career Fair.")

        self.assertEqual(self.staff_view(first)["Career Fair"]["conflicts"], [])

    def test_requests_for_different_venues_are_not_flagged(self):
        _, first, second = self.two_conflicting_requests()
        elsewhere = self.put_booking(self.venue(name="Other Hall"), name="Careers Talk", start="10:00", end="12:00")

        view = self.staff_view(first, second, elsewhere)

        self.assertEqual(view["Careers Talk"]["conflicts"], [])
        self.assertEqual(len(view["Career Fair"]["conflicts"]), 1)  # still only Open House

    def test_a_booking_that_holds_no_venue_has_nothing_in_its_way(self):
        venue = self.venue()
        rejected = self.put_booking(venue, name="Rejected Talk", status="rejected")
        self.put_booking(venue, name="Career Fair")

        self.assertEqual(self.staff_view(rejected)["Rejected Talk"]["conflicts"], [])


class TestWhoSeesTheFlags(ConflictingRequestsTestCase):
    def test_venue_staff_are_sent_the_conflicts_with_their_bookings(self):
        self.two_conflicting_requests()

        listed = {b["event_name"]: b for b in main.list_bookings(db=self.db, user=STAFF)}

        self.assertEqual([c["event_name"] for c in listed["Career Fair"]["conflicts"]], ["Open House"])
        self.assertEqual([c["event_name"] for c in listed["Open House"]["conflicts"]], ["Career Fair"])

    def test_a_coordinator_is_not_sent_them_because_they_name_other_coordinators_events(self):
        venue = self.venue()
        self.put_booking(venue, name="Career Fair", coordinator_id=COORDINATOR.id)
        self.put_booking(venue, name="Open House", start="11:00", end="13:00", coordinator_id=OTHER_COORDINATOR.id)

        listed = main.list_bookings(db=self.db, user=COORDINATOR)

        self.assertEqual([b["event_name"] for b in listed], ["Career Fair"])
        self.assertNotIn("conflicts", listed[0])
        self.assertNotIn("Open House", str(listed))


class TestPageMatchesBackend(unittest.TestCase):
    """Reads the frontend source, since a Python test cannot click through a browser. These guard against the
    page and the backend drifting apart; they are not a full UI test."""

    def source(self, relative) -> str:
        return (REPO / relative).read_text(encoding="utf-8")

    def test_a_conflicting_pending_request_is_flagged_for_manual_resolution_on_its_card_and_counted_on_the_page(self):
        card = self.source("components/bookings/BookingRequestCard.tsx")
        page = self.source("app/(dashboard)/bookings/page.tsx")
        self.assertIn("Needs manual resolution", card)
        self.assertIn("needsManualResolution", card)
        self.assertIn("with another pending request", page)
        self.assertIn("Nothing is decided for you", page)  # the flag leaves the decision to Venue Staff


if __name__ == "__main__":
    unittest.main()

"""
Unit tests for US46 — Prevent Overlapping Confirmed Bookings.

"As a Venue Staff member, I want the system to prevent a booking from being confirmed when it overlaps a
confirmed booking for the same venue so that a venue is not double-booked."

AC1: prevented from confirming a booking that overlaps an existing confirmed booking at the same venue ..
     TestOverlapRule, TestConfirmationGuard
AC2: the overlap check includes each venue's configured setup and turnaround time around both bookings ..
     TestOccupiedWindow, TestOverlapRule
AC3: shown the details of the conflicting booking when a conflict is detected ..
     TestConflictDetails, TestClashWording, TestConfirmationGuard
AC4: the conflict check is performed again at the moment of confirmation, not only at request time ..
     TestCheckedAtConfirmation
The backlog's test case: an event from 10:00 to 12:00 at a venue with 30 minutes setup and 45 minutes
turnaround occupies the venue from 09:30 to 12:45.

The overlap rule (backend/venue_conflicts.py) is called directly on plain values. The confirmation guard
(backend/venue_bookings.py, through main.decide_booking) runs on a real in-memory SQLite database, never
Supabase, reusing the US22 test setup. The integration tests check the same through the API.

Run from the repo root:
    python -m unittest discover -s tests/unit/venue -p "test_us46_*.py" -v
"""

import sys
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import HTTPException

from test_us22_submit_booking_request import MON, REPO, STAFF, DatabaseTestCase
import models
import schemas
import venue_bookings
from venue_availability import clash_text, format_clock
from venue_conflicts import CONFIRMED_BOOKING, PENDING_REQUEST, Slot, blocking, booking_conflicts, window_of

NOW = datetime(2027, 1, 1, 9, 0, tzinfo=timezone.utc)
# The backlog's venue: 30 minutes setup, 45 minutes turnaround.
VENUE = SimpleNamespace(id=1, name="Lecture Theatre 1", setupMinutes=30, turnaroundMinutes=45, unavailability=[])
GALA_CLASH = ("Clashes with Gala, already booked on 04 Jan 2027 "
              "(venue occupied 09:30–12:45 incl. 30 min setup and 45 min turnaround).")


def slot(start="10:00", end="12:00", day=MON, status="approved", id=1, event_id=1, name="Gala") -> Slot:
    """A confirmed booking of Gala on Monday 10:00-12:00 unless said otherwise."""
    return Slot(id, event_id, name, status, day, start, end)


def hours(window) -> tuple:
    return format_clock(window[0]), format_clock(window[1])


class TestOccupiedWindow(unittest.TestCase):
    def test_the_backlogs_example_occupies_the_venue_from_0930_to_1245(self):
        self.assertEqual(hours(window_of(slot(), VENUE)), ("09:30", "12:45"))

    def test_a_venue_with_no_setup_or_turnaround_is_busy_only_for_the_event_itself(self):
        bare = SimpleNamespace(setupMinutes=0, turnaroundMinutes=None)  # None: nothing recorded
        self.assertEqual(hours(window_of(slot(), bare)), ("10:00", "12:00"))

    def test_the_venues_times_as_they_are_now_decide_the_window(self):
        venue = SimpleNamespace(setupMinutes=30, turnaroundMinutes=45)
        before = window_of(slot(), venue)
        venue.setupMinutes = 60
        after = window_of(slot(), venue)

        self.assertEqual(before[0] - after[0], 30)  # the setup starts 30 minutes earlier
        self.assertEqual(before[1], after[1])  # the turnaround is unchanged


class TestOverlapRule(unittest.TestCase):
    def conflicts(self, mine, *others, venue=VENUE, with_pending=True):
        return booking_conflicts(mine, venue, others, NOW, with_pending)

    def fair(self, start="11:00", end="13:00", status="pending") -> Slot:
        return slot(start=start, end=end, status=status, id=2, event_id=2, name="Fair")

    def test_a_confirmed_booking_whose_occupied_window_overlaps_is_in_the_way(self):
        [found] = self.conflicts(self.fair(), slot())

        self.assertEqual((found["kind"], found["blocks_approval"], found["booking_id"]), (CONFIRMED_BOOKING, True, 1))

    def test_windows_that_only_touch_do_not_overlap_but_one_minute_more_does(self):
        # Gala occupies 09:30-12:45, so a booking is free to start its setup at 12:45 and must be done by 09:30.
        cases = (("13:15", "15:00", False), ("13:14", "15:00", True), ("08:00", "08:45", False), ("08:00", "08:46", True))
        for start, end, overlapping in cases:
            with self.subTest(start=start, end=end):
                self.assertEqual(len(self.conflicts(self.fair(start, end), slot())), 1 if overlapping else 0)

    def test_the_setup_and_turnaround_count_around_both_bookings(self):
        # Gala is 10:00-12:00; the other booking is Fair. Each case: (setup, turnaround, Fair starts, Fair ends, overlap).
        cases = (
            (0, 60, "13:00", "14:00", False), (0, 60, "12:59", "14:00", True),  # Gala's turnaround ends 13:00
            (60, 0, "07:00", "09:00", False), (60, 0, "07:00", "09:01", True),  # Gala's setup starts 09:00
            (60, 0, "13:00", "14:00", False), (60, 0, "12:59", "14:00", True),  # Fair's own setup reaches back from its start
        )
        for setup, turnaround, start, end, overlapping in cases:
            with self.subTest(setup=setup, turnaround=turnaround, start=start, end=end):
                venue = SimpleNamespace(id=1, name="Hall", setupMinutes=setup, turnaroundMinutes=turnaround)
                self.assertEqual(len(self.conflicts(self.fair(start, end), slot(), venue=venue)), 1 if overlapping else 0)

    def test_a_booking_on_another_day_is_not_in_the_way(self):
        self.assertEqual(self.conflicts(self.fair(), slot(day=date(2027, 1, 5))), [])

    def test_a_booking_is_not_in_its_own_way_and_neither_is_the_rest_of_its_event(self):
        mine = self.fair()
        itself = slot(id=2, event_id=99)
        its_event = slot(id=3, event_id=2)  # another booking of the same event

        self.assertEqual(self.conflicts(mine, itself, its_event), [])
        # Bookings with no event number are not taken for bookings of one event.
        nameless = slot(status="pending", id=4, event_id=None)
        self.assertEqual(len(self.conflicts(nameless, slot(id=5, event_id=None))), 1)

    def test_a_pending_request_in_the_way_does_not_stop_a_booking_being_confirmed(self):
        found = self.conflicts(self.fair(), slot(status="pending", id=3, event_id=3))

        self.assertEqual([c["kind"] for c in found], [PENDING_REQUEST])
        self.assertEqual(blocking(found), [])
        self.assertEqual(self.conflicts(self.fair(), slot(status="pending", id=3, event_id=3), with_pending=False), [])

    def test_bookings_that_hold_nothing_are_not_in_the_way(self):
        for status in ("rejected", "cancelled"):
            with self.subTest(status=status):
                self.assertEqual(self.conflicts(self.fair(), slot(status=status)), [])

    def test_conflicts_are_listed_earliest_first_then_by_booking_number(self):
        mine = slot(start="08:00", end="16:00", status="pending", id=9, event_id=9, name="Mine")
        later = slot(start="13:00", end="14:00", id=5, event_id=5, name="Later")
        same_time_b = slot(start="10:00", end="11:00", id=7, event_id=7, name="B")
        same_time_a = slot(start="10:00", end="11:00", id=6, event_id=6, name="A")

        found = self.conflicts(mine, later, same_time_b, same_time_a)

        self.assertEqual([c["event_name"] for c in found], ["A", "B", "Later"])


class TestConflictDetails(unittest.TestCase):
    def test_a_conflict_describes_the_other_booking_and_when_it_occupies_the_venue(self):
        mine = slot(start="11:00", end="13:00", status="pending", id=2, event_id=2, name="Fair")

        [found] = booking_conflicts(mine, VENUE, [slot()], NOW)

        self.assertEqual(found, {
            "kind": "confirmed_booking", "blocks_approval": True, "message": GALA_CLASH,
            "booking_id": 1, "event_id": 1, "event_name": "Gala", "status": "approved",
            "date": MON, "start": "10:00", "end": "12:00",
            "occupied_start": datetime(2027, 1, 4, 9, 30), "occupied_end": datetime(2027, 1, 4, 12, 45),
        })


class TestClashWording(unittest.TestCase):
    def test_a_confirmed_booking_is_booked_and_a_pending_one_is_requested(self):
        window = window_of(slot(), VENUE)

        self.assertEqual(clash_text(VENUE, "Gala", "approved", MON, window), GALA_CLASH)
        self.assertEqual(clash_text(VENUE, "Gala", "pending", MON, window), GALA_CLASH.replace("already booked", "already requested"))

    def test_a_booking_without_a_name_is_called_another_booking(self):
        window = window_of(slot(), VENUE)
        for name in (None, ""):
            with self.subTest(name=name):
                self.assertTrue(clash_text(VENUE, name, "approved", MON, window).startswith("Clashes with another booking, already booked on"))

    def test_only_the_setup_and_turnaround_the_venue_has_are_mentioned(self):
        cases = (
            (0, 0, "(venue occupied 10:00–12:00)."),
            (30, 0, "(venue occupied 09:30–12:00 incl. 30 min setup)."),
            (0, 45, "(venue occupied 10:00–12:45 incl. 45 min turnaround)."),
        )
        for setup, turnaround, ending in cases:
            with self.subTest(setup=setup, turnaround=turnaround):
                venue = SimpleNamespace(setupMinutes=setup, turnaroundMinutes=turnaround)
                self.assertTrue(clash_text(venue, "Gala", "approved", MON, window_of(slot(), venue)).endswith(ending))


class GuardTestCase(DatabaseTestCase):
    def refusal(self, booking) -> HTTPException:
        with self.assertRaises(HTTPException) as ctx:
            self.decide(booking.id, "approved")
        return ctx.exception

    def stored(self, booking) -> models.VenueBooking:
        self.db.expire_all()
        return self.db.get(models.VenueBooking, booking.id)


class TestConfirmationGuard(GuardTestCase):
    def test_a_booking_with_nothing_in_the_way_is_confirmed(self):
        booking = self.put_booking(self.venue())

        record = self.decide(booking.id, "approved")

        self.assertEqual((record["status"], record["decided_by"]), ("approved", STAFF.email))
        self.assertEqual(record["conflicts"], [])  # sent back as Venue Staff see it, with nothing in the way

    def test_overlapping_a_confirmed_booking_refuses_the_confirmation_and_leaves_the_booking_pending(self):
        venue = self.venue()
        self.put_booking(venue, name="Gala", status="approved")
        fair = self.put_booking(venue, name="Fair", start="11:00", end="13:00")

        refused = self.refusal(fair)

        self.assertEqual(refused.status_code, 409)
        self.assertEqual(refused.detail, f"Can't approve: {GALA_CLASH}")
        self.assertEqual(self.stored(fair).status, "pending")

    def test_every_confirmed_booking_in_the_way_is_named(self):
        venue = self.venue()
        self.put_booking(venue, name="Gala", status="approved", start="10:00", end="12:00")
        self.put_booking(venue, name="Open House", status="approved", start="14:00", end="15:00")
        fair = self.put_booking(venue, name="Fair", start="11:00", end="16:00")

        detail = self.refusal(fair).detail

        self.assertEqual(detail.count("Clashes with"), 2)
        self.assertLess(detail.index("Clashes with Gala"), detail.index("Clashes with Open House"))

    def test_windows_that_only_touch_are_confirmed_and_one_minute_more_is_refused(self):
        cases = (("13:15", "15:00", True), ("13:14", "15:00", False), ("08:00", "08:45", True), ("08:00", "08:46", False))
        for start, end, confirmed in cases:
            with self.subTest(start=start, end=end):
                venue = self.venue()
                self.put_booking(venue, name="Gala", status="approved")
                fair = self.put_booking(venue, name="Fair", start=start, end=end)

                if confirmed:
                    self.assertEqual(self.decide(fair.id, "approved")["status"], "approved")
                else:
                    self.assertEqual(self.refusal(fair).status_code, 409)

    def test_only_confirmed_bookings_at_the_same_venue_stop_a_confirmation(self):
        for status in ("pending", "rejected", "cancelled"):
            with self.subTest(other_status=status):
                venue = self.venue()
                self.put_booking(venue, name="Other", status=status)
                fair = self.put_booking(venue, name="Fair")
                self.assertEqual(self.decide(fair.id, "approved")["status"], "approved")
        with self.subTest(other="a confirmed booking at another venue"):
            elsewhere = self.venue(name="Other Hall")
            self.put_booking(elsewhere, name="Gala", status="approved")
            fair = self.put_booking(self.venue(), name="Fair")
            self.assertEqual(self.decide(fair.id, "approved")["status"], "approved")

    def test_the_venue_is_locked_while_a_booking_is_confirmed(self):
        # Two Venue Staff confirming overlapping bookings at once are checked one after the other (the lock is a
        # Postgres row lock: SQLite ignores it, so what is checked here is that it is asked for).
        asked = []
        real_get = self.db.get

        def spy(entity, ident, **options):
            asked.append((entity, options))
            return real_get(entity, ident, **options)

        booking = self.put_booking(self.venue())
        self.db.get = spy

        self.decide(booking.id, "approved")

        self.assertIn((models.Venue, {"with_for_update": True}), asked)

    def test_rejecting_is_not_held_up_by_a_confirmed_booking(self):
        venue = self.venue()
        self.put_booking(venue, name="Gala", status="approved")
        fair = self.put_booking(venue, name="Fair", start="11:00", end="13:00")

        self.assertEqual(self.decide(fair.id, "rejected", "Clashes with Gala.")["status"], "rejected")


class TestCheckedAtConfirmation(GuardTestCase):
    def test_what_is_saved_at_that_moment_decides_not_what_was_true_when_it_was_requested(self):
        # Both were requested while nothing was confirmed. Once the first is confirmed, the second is in its way.
        venue = self.venue()
        first = self.put_booking(venue, name="First", start="10:00", end="12:00")
        second = self.put_booking(venue, name="Second", start="11:00", end="13:00")
        self.decide(first.id, "approved")

        refused = self.refusal(second)

        self.assertIn("Clashes with First, already booked", refused.detail)

    def test_the_venues_setup_and_turnaround_as_they_are_now_are_used_not_the_ones_the_booking_was_saved_with(self):
        # Gala and Fair were saved with no setup or turnaround (their saved holds don't touch)...
        venue = self.venue(setupMinutes=0, turnaroundMinutes=0)
        self.put_booking(venue, name="Gala", status="approved", start="10:00", end="12:00")
        fair = self.put_booking(venue, name="Fair", start="12:30", end="14:00")
        venue.setupMinutes = 45  # ...and then the venue's setup time grew
        self.db.commit()

        refused = self.refusal(fair)

        self.assertIn("venue occupied 09:15–12:00 incl. 45 min setup", refused.detail)

    def test_the_saved_hold_of_either_booking_does_not_matter(self):
        # Both bookings carry a stale hold that doesn't overlap; the venue is configured with 30 + 45 minutes now.
        venue = self.venue()
        stale = dict(setup_minutes=0, teardown_minutes=0)
        self.put_booking(venue, name="Gala", status="approved", hold_start=datetime(2027, 1, 4, 10, 0), hold_end=datetime(2027, 1, 4, 12, 0), **stale)
        fair = self.put_booking(venue, name="Fair", start="12:30", end="14:00",
                                hold_start=datetime(2027, 1, 4, 12, 30), hold_end=datetime(2027, 1, 4, 14, 0), **stale)

        refused = self.refusal(fair)

        self.assertIn("venue occupied 09:30–12:45", refused.detail)


class TestVenueStaffSeeTheConflictingBooking(GuardTestCase):
    def test_the_confirmed_booking_in_the_way_is_shown_before_they_decide(self):
        venue = self.venue()
        self.put_booking(venue, name="Gala", status="approved")
        fair = self.put_booking(venue, name="Fair", start="11:00", end="13:00")

        [record] = venue_bookings.staff_records(self.db, [fair], NOW)

        [conflict] = record["conflicts"]
        self.assertEqual((conflict["kind"], conflict["event_name"], conflict["status"], conflict["blocks_approval"]),
                         ("confirmed_booking", "Gala", "approved", True))
        self.assertEqual((conflict["date"], conflict["start"], conflict["end"]), (MON, "10:00", "12:00"))
        self.assertEqual((conflict["occupied_start"], conflict["occupied_end"]), (datetime(2027, 1, 4, 9, 30), datetime(2027, 1, 4, 12, 45)))
        self.assertEqual(conflict["message"], GALA_CLASH)


class TestPageMatchesBackend(unittest.TestCase):
    """Reads the frontend source, since a Python test cannot click through a browser. These guard against the
    page and the backend drifting apart; they are not a full UI test."""

    def source(self, relative) -> str:
        return (REPO / relative).read_text(encoding="utf-8")

    def test_the_page_knows_every_field_of_a_conflict_and_both_kinds_that_stop_a_confirmation(self):
        types = self.source("lib/types.ts")
        start = types.index("export interface BookingConflict")
        block = types[start:types.index("\n}", start)]
        for field in schemas.BookingConflict.model_fields:
            with self.subTest(field=field):
                self.assertRegex(block, rf"\b{field}\b")
        self.assertIn('"confirmed_booking"', block)

    def test_venue_staff_are_told_what_stops_a_booking_being_approved_and_which_booking_it_is(self):
        card = self.source("components/bookings/BookingRequestCard.tsx")
        self.assertIn("be approved while this stands", card)
        self.assertIn("blockingConflicts", card)
        self.assertIn("event_name", self.source("components/bookings/ConflictList.tsx"))


if __name__ == "__main__":
    unittest.main()

"""
Unit tests for US38 — Flag Bookings Affected by Venue Time Changes.

"As a Venue Staff member, I want existing bookings re-checked when a venue's setup or turnaround time
changes so that bookings that now clash are identified rather than silently removed."

AC1: every pending and confirmed future booking at the venue is re-checked when its setup or turnaround
     time changes ..... TestEveryFutureBookingIsRechecked
AC2: bookings that now overlap are flagged "Requires Reassessment" and listed with the booking they clash
     with ..... TestRequiresReassessment
AC3: a flagged booking is never removed or cancelled automatically ..... TestNothingIsRemoved
AC4: the Event Coordinator of each flagged booking is notified ..... TestCoordinatorsAreTold
     (the server returns the newly flagged bookings and keeps the flag on each, which the coordinator's page turns
     into the notification when it loads; there is no stored notification until US36)
And how a flag is kept up to date ..... TestFlagsClear, TestAfterVenueChange, TestUpdateVenueEndpoint
And the page agreeing with the backend ..... TestPageMatchesBackend

Dates are worked out from today (a Monday at least 60 days ahead), and the re-check is given its own clock, so
which bookings count as "future" does not depend on when the tests are run.

The bookings are saved straight into a real in-memory SQLite database, never Supabase (reusing the US22 test
setup). The integration tests check the same through the API.

Run from the repo root:
    python -m unittest discover -s tests/unit/venue -p "test_us38_*.py" -v
"""

import sys
import unittest
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_us22_submit_booking_request import COORDINATOR, OTHER_COORDINATOR, REPO, STAFF, DatabaseTestCase
import main
import models
import schemas
import venue_bookings
from venue_availability import format_date
from venue_conflicts import as_json
from venue_reassessment import REASON, after_venue_change, bring_hold_into_line, build_flag, campus_now, has_happened, is_flagged, reconcile, refresh


def a_monday_ahead(days=60) -> date:
    day = date.today() + timedelta(days=days)
    return day + timedelta(days=(7 - day.weekday()) % 7)


def utc_at_campus(day: date, hour: int, minute: int = 0) -> datetime:
    """The UTC moment at which the campus (Singapore, UTC+8) clock shows this time."""
    return datetime.combine(day, time(hour, minute)).replace(tzinfo=timezone.utc) - timedelta(hours=8)


DAY = a_monday_ahead()
NOW = utc_at_campus(DAY - timedelta(days=3), 9)  # nine in the morning, the Friday before: everything on DAY is still to come
WHEN = format_date(DAY)


class RecheckTestCase(DatabaseTestCase):
    def flat_venue(self, **fields):
        """A venue with no setup or turnaround time yet, unless a test says otherwise."""
        return self.venue(**{"setupMinutes": 0, "turnaroundMinutes": 0, **fields})

    def adjacent_pair(self, venue, first="pending", second="pending", day=DAY):
        """Two bookings that clear each other while the venue has no setup or turnaround: 10:00-12:00 and 12:30-14:00."""
        return (self.put_booking(venue, name="Career Fair", day=day, start="10:00", end="12:00", status=first),
                self.put_booking(venue, name="Open House", day=day, start="12:30", end="14:00", status=second))

    def change_times(self, venue, setup=None, turnaround=None, now=NOW):
        """Edit the venue's times as Venue Staff would, then re-check its bookings. Returns the bookings newly flagged."""
        was = (venue.setupMinutes, venue.turnaroundMinutes)
        if setup is not None:
            venue.setupMinutes = setup
        if turnaround is not None:
            venue.turnaroundMinutes = turnaround
        flagged = refresh(self.db, venue, now, was=was)
        self.db.commit()
        return flagged

    def stored(self, row) -> models.VenueBooking:
        self.db.flush()  # a check that was not committed has still changed the booking
        self.db.expire_all()
        return self.db.get(models.VenueBooking, row.id)


class TestHelpers(unittest.TestCase):
    def test_the_campus_clock_is_singapore_time_without_a_time_zone(self):
        self.assertEqual(campus_now(NOW), datetime.combine(DAY - timedelta(days=3), time(9, 0)))

    def test_a_booking_is_over_once_its_event_has_ended(self):
        row = SimpleNamespace(date=DAY, start_time="10:00", end_time="12:00")
        cases = ((datetime.combine(DAY, time(11, 59)), False), (datetime.combine(DAY, time(12, 0)), True), (datetime.combine(DAY + timedelta(days=1), time(9, 0)), True))
        for now, over in cases:
            with self.subTest(now=now):
                self.assertIs(has_happened(row, now), over)

    def test_only_a_flag_for_a_venue_time_change_counts(self):
        cases = ((None, False), ({}, False), ({"reason": "change_accepted"}, False), ({"reason": REASON}, True))
        for reassessment, flagged in cases:
            with self.subTest(reassessment=reassessment):
                self.assertIs(is_flagged(SimpleNamespace(reassessment=reassessment)), flagged)

    def test_the_flag_says_what_changed_and_that_the_booking_is_kept(self):
        venue = SimpleNamespace(name="Lecture Theatre 1", setupMinutes=60, turnaroundMinutes=45)
        clash = {"kind": "pending_request", "booking_id": 2, "date": DAY, "occupied_start": datetime(2027, 1, 4, 11, 30)}

        flag = build_flag(venue, [clash], "2027-01-01T09:00:00+00:00")

        self.assertEqual(flag, {
            "reason": "venue_time_changed",
            "message": "Lecture Theatre 1's setup and turnaround time changed (now 60 min setup and 45 min turnaround) and this "
                       "booking now overlaps another booking at the venue. The booking is kept; it needs to be reassessed.",
            "setup_minutes": 60, "turnaround_minutes": 45,
            "clashes_with": [{"kind": "pending_request", "booking_id": 2, "date": DAY.isoformat(), "occupied_start": "2027-01-04T11:30:00"}],
            "flagged_at": "2027-01-01T09:00:00+00:00",
        })

    def test_a_venue_with_no_times_recorded_counts_as_having_none(self):
        flag = build_flag(SimpleNamespace(name="Hall", setupMinutes=None, turnaroundMinutes=None), [], "now")

        self.assertEqual((flag["setup_minutes"], flag["turnaround_minutes"]), (0, 0))
        self.assertIn("now 0 min setup and 0 min turnaround", flag["message"])

    def test_dates_and_times_become_text_so_a_conflict_can_be_saved_and_the_rest_is_left_as_it_is(self):
        conflict = {"date": DAY, "occupied_start": datetime(2027, 1, 4, 9, 30), "event_name": "Gala", "booking_id": 3, "note": None, "blocks_approval": False}

        self.assertEqual(as_json(conflict), {"date": DAY.isoformat(), "occupied_start": "2027-01-04T09:30:00", "event_name": "Gala",
                                            "booking_id": 3, "note": None, "blocks_approval": False})

    def test_a_hold_follows_the_venues_current_setup_and_turnaround(self):
        row = SimpleNamespace(date=DAY, start_time="10:00", end_time="12:00", setup_minutes=0, teardown_minutes=0, hold_start=None, hold_end=None)

        bring_hold_into_line(row, SimpleNamespace(setupMinutes=60, turnaroundMinutes=45))
        self.assertEqual((row.setup_minutes, row.teardown_minutes), (60, 45))
        self.assertEqual((row.hold_start, row.hold_end), (datetime.combine(DAY, time(9, 0)), datetime.combine(DAY, time(12, 45))))

        bring_hold_into_line(row, SimpleNamespace(setupMinutes=None, turnaroundMinutes=None))  # nothing recorded: none needed
        self.assertEqual((row.hold_start, row.hold_end), (datetime.combine(DAY, time(10, 0)), datetime.combine(DAY, time(12, 0))))


# ---------------------------------------------------------------- AC1: every future booking is re-checked

class TestEveryFutureBookingIsRechecked(RecheckTestCase):
    def test_pending_and_confirmed_bookings_are_both_rechecked(self):
        for first, second in (("pending", "pending"), ("pending", "approved"), ("approved", "approved")):
            with self.subTest(first=first, second=second):
                venue = self.flat_venue()
                a, b = self.adjacent_pair(venue, first, second)

                flagged = self.change_times(venue, setup=60)

                self.assertEqual({row.id for row in flagged}, {a.id, b.id})
                self.assertTrue(is_flagged(self.stored(a)) and is_flagged(self.stored(b)))

    def test_a_booking_that_is_over_is_left_alone(self):
        venue = self.flat_venue()
        a, _ = self.adjacent_pair(venue, day=DAY - timedelta(days=14))

        flagged = self.change_times(venue, setup=60)

        self.assertEqual(flagged, [])
        self.assertIsNone(self.stored(a).reassessment)
        self.assertEqual((self.stored(a).setup_minutes, self.stored(a).hold_start),
                         (0, datetime.combine(DAY - timedelta(days=14), time(10, 0))))  # its hold is as it was

    def test_a_booking_still_running_is_rechecked_but_one_that_has_just_ended_is_not(self):
        cases = ((utc_at_campus(DAY, 11, 59), 2), (utc_at_campus(DAY, 12, 0), 0))  # Career Fair ends at 12:00
        for now, flagged_count in cases:
            with self.subTest(campus_time=campus_now(now).time()):
                venue = self.flat_venue()
                self.adjacent_pair(venue)

                self.assertEqual(len(self.change_times(venue, setup=60, now=now)), flagged_count)

    def test_only_the_bookings_at_this_venue_are_rechecked(self):
        venue, other = self.flat_venue(), self.flat_venue(name="Other Hall")
        self.adjacent_pair(venue)
        c, d = self.adjacent_pair(other)

        self.change_times(venue, setup=60)

        for row in (c, d):
            self.assertIsNone(self.stored(row).reassessment)
            self.assertEqual(self.stored(row).setup_minutes, 0)

    def test_bookings_that_hold_nothing_are_not_rechecked_and_clash_with_nobody(self):
        cases = (("rejected", {}), ("cancelled", {}), ("pending", {"hold_expires_at": NOW - timedelta(minutes=1)}))  # the last: an expired hold
        for status, fields in cases:
            with self.subTest(second=status, expired=bool(fields)):
                venue = self.flat_venue()
                a = self.put_booking(venue, name="Career Fair", day=DAY, start="10:00", end="12:00")
                b = self.put_booking(venue, name="Open House", day=DAY, start="12:30", end="14:00", status=status, **fields)

                self.assertEqual(self.change_times(venue, setup=60), [])

                self.assertIsNone(self.stored(a).reassessment)
                self.assertEqual(self.stored(b).setup_minutes, 0)  # its hold was not touched either

    def test_every_future_bookings_hold_follows_the_new_setup_and_turnaround(self):
        venue = self.flat_venue()
        a, b = self.adjacent_pair(venue)
        next_week = self.put_booking(venue, name="Next Week", day=DAY + timedelta(days=7), start="10:00", end="12:00")  # clashes with nothing

        self.change_times(venue, setup=60, turnaround=30)

        for row, day, hold in ((a, DAY, ((9, 0), (12, 30))), (b, DAY, ((11, 30), (14, 30))), (next_week, DAY + timedelta(days=7), ((9, 0), (12, 30)))):
            stored = self.stored(row)
            self.assertEqual((stored.setup_minutes, stored.teardown_minutes), (60, 30))
            self.assertEqual((stored.hold_start, stored.hold_end), (datetime.combine(day, time(*hold[0])), datetime.combine(day, time(*hold[1]))))

    def test_a_change_to_only_the_turnaround_time_is_rechecked_too(self):
        venue = self.flat_venue()
        a, b = self.adjacent_pair(venue)

        flagged = self.change_times(venue, turnaround=90)  # Career Fair is now held until 13:30, Open House from 12:30

        self.assertEqual({row.id for row in flagged}, {a.id, b.id})
        self.assertEqual((self.stored(a).reassessment["setup_minutes"], self.stored(a).reassessment["turnaround_minutes"]), (0, 90))


# ---------------------------------------------------------------- AC2: flagged and listed with the booking they clash with

class TestRequiresReassessment(RecheckTestCase):
    def test_bookings_that_now_overlap_are_marked_with_the_booking_they_clash_with(self):
        venue = self.flat_venue()
        a, b = self.adjacent_pair(venue)

        self.change_times(venue, setup=60)

        flag = self.stored(a).reassessment
        self.assertEqual((flag["reason"], flag["flagged_at"]), ("venue_time_changed", NOW.isoformat()))
        self.assertEqual((flag["setup_minutes"], flag["turnaround_minutes"]), (60, 0))
        self.assertEqual(flag["message"], "Lecture Theatre 1's setup and turnaround time changed (now 60 min setup and 0 min turnaround) and this "
                                          "booking now overlaps another booking at the venue. The booking is kept; it needs to be reassessed.")
        self.assertEqual(flag["clashes_with"], [{
            "kind": "pending_request", "blocks_approval": False,
            "message": f"Clashes with Open House, already requested on {WHEN} (venue occupied 11:30–14:00 incl. 60 min setup).",
            "booking_id": b.id, "event_id": self.stored(b).event_id, "event_name": "Open House", "status": "pending",
            "date": DAY.isoformat(), "start": "12:30", "end": "14:00",
            "occupied_start": f"{DAY}T11:30:00", "occupied_end": f"{DAY}T14:00:00",
        }])
        [back] = self.stored(b).reassessment["clashes_with"]
        self.assertEqual((back["booking_id"], back["event_name"]), (a.id, "Career Fair"))

    def test_venue_staff_are_sent_each_flagged_booking_with_the_booking_it_clashes_with(self):
        venue = self.flat_venue()
        self.adjacent_pair(venue)
        self.change_times(venue, setup=60)

        listed = {b["event_name"]: b for b in main.list_bookings(db=self.db, user=STAFF)}

        self.assertEqual([c["event_name"] for c in listed["Career Fair"]["reassessment"]["clashes_with"]], ["Open House"])
        self.assertEqual([c["event_name"] for c in listed["Open House"]["reassessment"]["clashes_with"]], ["Career Fair"])

    def test_a_confirmed_booking_is_described_as_booked_and_a_pending_one_as_requested(self):
        venue = self.flat_venue()
        a, b = self.adjacent_pair(venue, "approved", "pending")

        self.change_times(venue, setup=60)

        [clash_for_a] = self.stored(a).reassessment["clashes_with"]
        [clash_for_b] = self.stored(b).reassessment["clashes_with"]
        self.assertEqual((clash_for_a["kind"], clash_for_a["status"]), ("pending_request", "pending"))
        self.assertIn("already requested on", clash_for_a["message"])
        self.assertEqual((clash_for_b["kind"], clash_for_b["status"], clash_for_b["blocks_approval"]), ("confirmed_booking", "approved", True))
        self.assertIn("already booked on", clash_for_b["message"])

    def test_only_the_bookings_that_now_overlap_are_flagged(self):
        venue = self.flat_venue()
        a, b = self.adjacent_pair(venue)
        evening = self.put_booking(venue, name="Evening Talk", day=DAY, start="18:00", end="19:00")

        flagged = self.change_times(venue, setup=60)

        self.assertEqual({row.id for row in flagged}, {a.id, b.id})
        self.assertIsNone(self.stored(evening).reassessment)

    def test_a_booking_that_clashes_with_two_others_lists_both_earliest_first(self):
        venue = self.flat_venue()
        a, b = self.adjacent_pair(venue)
        c = self.put_booking(venue, name="Closing Talk", day=DAY, start="14:15", end="16:00")

        self.change_times(venue, setup=60)  # Career Fair 09:00-12:00, Open House 11:30-14:00, Closing Talk 13:15-16:00

        self.assertEqual([x["event_name"] for x in self.stored(b).reassessment["clashes_with"]], ["Career Fair", "Closing Talk"])
        self.assertEqual([x["event_name"] for x in self.stored(a).reassessment["clashes_with"]], ["Open House"])
        self.assertEqual([x["event_name"] for x in self.stored(c).reassessment["clashes_with"]], ["Open House"])

    def test_a_pair_that_already_overlapped_before_the_change_is_not_flagged_by_it(self):
        venue = self.flat_venue()
        a = self.put_booking(venue, name="Career Fair", day=DAY, start="10:00", end="12:00")
        b = self.put_booking(venue, name="Open House", day=DAY, start="11:00", end="13:00")  # overlapped at 0 + 0 minutes already

        flagged = self.change_times(venue, setup=15)

        self.assertEqual(flagged, [])
        self.assertIsNone(self.stored(a).reassessment)
        self.assertIsNone(self.stored(b).reassessment)

    def test_the_bookings_newly_flagged_are_returned_and_a_check_that_changes_nothing_returns_none(self):
        venue = self.flat_venue()
        a, b = self.adjacent_pair(venue)
        self.assertEqual({row.id for row in self.change_times(venue, setup=60)}, {a.id, b.id})

        again = refresh(self.db, venue, NOW + timedelta(hours=1), was=(60, 0))  # the venue's times are what they were

        self.assertEqual(again, [])
        self.assertEqual(self.stored(a).reassessment["flagged_at"], NOW.isoformat())  # still when it was first flagged

    def test_a_flag_stays_while_the_clash_lasts_and_follows_the_venues_times(self):
        venue = self.flat_venue()
        a, b = self.adjacent_pair(venue)
        self.change_times(venue, setup=60)

        flagged = self.change_times(venue, setup=90)  # they overlapped under 60 minutes too: not newly flagged

        self.assertEqual(flagged, [])
        flag = self.stored(a).reassessment
        self.assertEqual((flag["setup_minutes"], flag["flagged_at"]), (90, NOW.isoformat()))
        self.assertIn("now 90 min setup", flag["message"])
        self.assertEqual(flag["clashes_with"][0]["occupied_start"], f"{DAY}T11:00:00")  # Open House is held from 11:00 now

    def test_a_new_clash_is_added_to_a_flag_that_is_already_there(self):
        venue = self.flat_venue()
        a, b = self.adjacent_pair(venue)
        c = self.put_booking(venue, name="Next Talk", day=DAY, start="15:00", end="16:00")
        self.change_times(venue, setup=35)  # only Career Fair and Open House overlap
        later = NOW + timedelta(hours=2)

        flagged = self.change_times(venue, setup=70, now=later)  # now Next Talk reaches back into Open House too

        self.assertEqual({row.id for row in flagged}, {b.id, c.id})
        self.assertEqual([x["event_name"] for x in self.stored(b).reassessment["clashes_with"]], ["Career Fair", "Next Talk"])
        self.assertEqual(self.stored(b).reassessment["flagged_at"], later.isoformat())  # it has a new clash
        self.assertEqual(self.stored(a).reassessment["flagged_at"], NOW.isoformat())  # it has not

    def test_a_flag_for_another_reason_is_left_alone(self):
        venue = self.flat_venue()
        other_reason = {"reason": "change_accepted", "message": "An accepted change affects this booking."}
        row = self.put_booking(venue, day=DAY, reassessment=other_reason)

        refresh(self.db, venue, NOW)

        self.assertEqual(self.stored(row).reassessment, other_reason)


# ---------------------------------------------------------------- AC3: nothing is removed or cancelled

class TestNothingIsRemoved(RecheckTestCase):
    def snapshot(self) -> tuple:
        self.db.flush()
        self.db.expire_all()
        bookings = [(b.id, b.status, b.date, b.start_time, b.end_time, b.event_id, b.venue_id, b.attendance, b.layout, b.decided_by)
                    for b in self.bookings()]
        events = [(e.id, e.status, e.name, e.date, e.venue_id, e.booking_state) for e in self.db.query(models.Event).order_by(models.Event.id).all()]
        return bookings, events

    def test_flagged_bookings_and_their_events_are_kept_as_they_were(self):
        venue = self.flat_venue()
        self.adjacent_pair(venue, "approved", "pending")
        before = self.snapshot()

        flagged = self.change_times(venue, setup=60)

        self.assertEqual(len(flagged), 2)
        self.assertEqual(self.snapshot(), before)  # same bookings, same statuses and times, same events


# ---------------------------------------------------------------- AC4: the coordinators are told

class TestCoordinatorsAreTold(RecheckTestCase):
    def two_coordinators_bookings(self):
        venue = self.flat_venue()
        own = self.put_booking(venue, name="Career Fair", day=DAY, start="10:00", end="12:00", coordinator_id=COORDINATOR.id)
        theirs = self.put_booking(venue, name="Open House", day=DAY, start="12:30", end="14:00", coordinator_id=OTHER_COORDINATOR.id)
        elsewhere = self.put_booking(self.flat_venue(name="Other Hall"), name="Careers Talk", day=DAY, start="10:00", end="12:00", coordinator_id=COORDINATOR.id)
        self.change_times(venue, setup=60)
        return own, theirs, elsewhere

    def test_the_coordinators_booking_carries_the_message_but_not_the_other_event(self):
        own, _, _ = self.two_coordinators_bookings()
        saved = self.stored(own)

        as_coordinator = venue_bookings.to_record(saved)
        as_staff = venue_bookings.to_record(saved, staff=True)

        self.assertEqual(as_coordinator["reassessment"]["message"], saved.reassessment["message"])
        self.assertNotIn("clashes_with", as_coordinator["reassessment"])
        self.assertNotIn("Open House", str(as_coordinator))
        self.assertEqual([c["event_name"] for c in as_staff["reassessment"]["clashes_with"]], ["Open House"])

    def test_a_booking_that_is_not_flagged_has_no_flag(self):
        _, _, elsewhere = self.two_coordinators_bookings()

        self.assertIsNone(venue_bookings.to_record(self.stored(elsewhere))["reassessment"])
        self.assertIsNone(venue_bookings.to_record(self.stored(elsewhere), staff=True)["reassessment"])

    def test_each_coordinator_is_sent_the_flags_of_their_own_events_only(self):
        self.two_coordinators_bookings()

        mine = {b["event_name"]: b for b in main.list_bookings(db=self.db, user=COORDINATOR)}
        theirs = {b["event_name"]: b for b in main.list_bookings(db=self.db, user=OTHER_COORDINATOR)}

        self.assertEqual(sorted(mine), ["Career Fair", "Careers Talk"])
        self.assertIsNotNone(mine["Career Fair"]["reassessment"])
        self.assertIsNone(mine["Careers Talk"]["reassessment"])
        self.assertEqual(list(theirs), ["Open House"])
        self.assertIsNotNone(theirs["Open House"]["reassessment"])


# ---------------------------------------------------------------- keeping a flag up to date

class TestFlagsClear(RecheckTestCase):
    def flagged_pair(self):
        venue = self.flat_venue()
        a, b = self.adjacent_pair(venue)
        self.change_times(venue, setup=60)
        return venue, a, b

    def test_putting_the_times_back_clears_the_flags(self):
        venue, a, b = self.flagged_pair()

        flagged = self.change_times(venue, setup=0)

        self.assertEqual(flagged, [])
        self.assertIsNone(self.stored(a).reassessment)
        self.assertIsNone(self.stored(b).reassessment)

    def test_rejecting_one_booking_clears_the_flag_on_the_other_and_on_itself(self):
        _, a, b = self.flagged_pair()

        self.decide(b.id, "rejected", "The hall is needed for the Career Fair.")

        self.assertIsNone(self.stored(a).reassessment)
        self.assertIsNone(self.stored(b).reassessment)

    def test_cancelling_one_booking_clears_the_flag_on_the_other(self):
        _, a, b = self.flagged_pair()

        main.cancel_booking(b.id, db=self.db, user=COORDINATOR)

        self.assertIsNone(self.stored(a).reassessment)

    def test_approving_one_booking_updates_what_the_other_says_it_clashes_with(self):
        _, a, b = self.flagged_pair()

        self.decide(b.id, "approved")  # another pending request in the way does not stop it (US47)

        [clash] = self.stored(a).reassessment["clashes_with"]
        self.assertEqual((clash["kind"], clash["status"]), ("confirmed_booking", "approved"))

    def test_a_flag_goes_when_the_booking_it_clashed_with_has_expired(self):
        venue, a, b = self.flagged_pair()
        self.stored(b).hold_expires_at = NOW - timedelta(minutes=1)
        self.db.commit()

        reconcile(self.db, [venue.id], NOW)

        self.assertIsNone(self.stored(a).reassessment)

    def test_a_flag_goes_once_the_events_are_over(self):
        venue, a, b = self.flagged_pair()

        reconcile(self.db, [venue.id], utc_at_campus(DAY + timedelta(days=1), 9))

        self.assertIsNone(self.stored(a).reassessment)
        self.assertIsNone(self.stored(b).reassessment)

    def test_reconciling_never_flags_anything_new_nor_moves_a_hold(self):
        venue = self.flat_venue()
        a, _ = self.adjacent_pair(venue)
        venue.setupMinutes = 60  # edited, but not re-checked
        self.db.commit()

        reconcile(self.db, [venue.id], NOW)

        self.assertIsNone(self.stored(a).reassessment)
        self.assertEqual(self.stored(a).setup_minutes, 0)

    def test_reconciling_a_venue_that_does_not_exist_does_nothing(self):
        reconcile(self.db, [9999], NOW)


class TestAfterVenueChange(RecheckTestCase):
    MAINTENANCE = {"start": f"{DAY}T07:00:00", "end": f"{DAY}T09:15:00", "reason": "maintenance", "note": None}

    def test_an_edit_that_changes_neither_the_times_nor_the_periods_touches_nothing(self):
        venue = self.flat_venue()
        a, _ = self.adjacent_pair(venue)

        result = after_venue_change(self.db, venue, {"name": {"old": "Hall", "new": "Lecture Theatre 1"}}, NOW)

        self.assertEqual(result, ([], []))
        self.assertEqual(self.stored(a).setup_minutes, 0)

    def test_a_change_to_the_unavailable_periods_flags_the_bookings_inside_them_and_nothing_else(self):
        venue = self.flat_venue(unavailability=[{**self.MAINTENANCE, "end": f"{DAY}T20:00:00"}])
        a = self.put_booking(venue, day=DAY, status="approved")

        flagged, reassessed = after_venue_change(self.db, venue, {"unavailability": {"old": [], "new": venue.unavailability}}, NOW)

        self.assertEqual(([row.id for row in flagged], reassessed), ([a.id], []))
        self.assertEqual(self.stored(a).flag["kind"], "venue_unavailable")

    def test_a_change_to_the_times_rechecks_the_bookings_and_moves_their_holds(self):
        venue = self.flat_venue()
        a, b = self.adjacent_pair(venue)
        venue.setupMinutes = 60

        flagged, reassessed = after_venue_change(self.db, venue, {"setupMinutes": {"old": 0, "new": 60}}, NOW)

        self.assertEqual(({row.id for row in reassessed}, flagged), ({a.id, b.id}, []))
        self.assertEqual(self.stored(a).setup_minutes, 60)

    def test_a_time_that_was_not_edited_is_the_venues_current_one_when_working_out_what_changed(self):
        venue = self.flat_venue(setupMinutes=60)  # Career Fair and Open House already overlap at 60 + 0 minutes
        self.adjacent_pair(venue)
        venue.turnaroundMinutes = 90

        flagged, reassessed = after_venue_change(self.db, venue, {"turnaroundMinutes": {"old": 0, "new": 90}}, NOW)

        self.assertEqual((flagged, reassessed), ([], []))

    def test_a_time_that_was_not_recorded_before_counts_as_none(self):
        venue = self.flat_venue()
        a, b = self.adjacent_pair(venue)
        venue.setupMinutes = 60

        _, reassessed = after_venue_change(self.db, venue, {"setupMinutes": {"old": None, "new": 60}}, NOW)

        self.assertEqual({row.id for row in reassessed}, {a.id, b.id})

    def test_the_holds_are_brought_into_line_before_the_unavailable_periods_are_checked(self):
        # A 10:00 booking with no setup clears a period that ends at 09:15; a 60 minute setup reaches back to 09:00.
        venue = self.flat_venue(unavailability=[self.MAINTENANCE])
        a = self.put_booking(venue, day=DAY, status="approved")
        self.assertIsNone(self.stored(a).flag)
        venue.setupMinutes = 60

        flagged, reassessed = after_venue_change(self.db, venue, {"setupMinutes": {"old": 0, "new": 60}}, NOW)

        self.assertEqual(([row.id for row in flagged], reassessed), ([a.id], []))
        self.assertEqual(self.stored(a).flag["kind"], "venue_unavailable")


class TestUpdateVenueEndpoint(RecheckTestCase):
    def test_editing_the_venues_times_returns_the_bookings_it_flagged_as_venue_staff_see_them(self):
        venue = self.flat_venue()
        self.adjacent_pair(venue)

        edited = main.update_venue(venue.id, schemas.VenueUpdate(setupMinutes=60), db=self.db, user=STAFF)

        self.assertEqual(sorted(r["event_name"] for r in edited.reassessed_bookings), ["Career Fair", "Open House"])
        self.assertTrue(all(r["reassessment"]["clashes_with"] for r in edited.reassessed_bookings))
        self.assertEqual(edited.flagged_bookings, [])

    def test_an_edit_that_leaves_the_times_alone_flags_nothing(self):
        venue = self.flat_venue()
        self.adjacent_pair(venue)

        edited = main.update_venue(venue.id, schemas.VenueUpdate(name="Renamed Hall"), db=self.db, user=STAFF)

        self.assertEqual((edited.reassessed_bookings, edited.flagged_bookings), ([], []))


class TestPageMatchesBackend(unittest.TestCase):
    """Reads the frontend source, since a Python test cannot click through a browser. These guard against the
    page and the backend drifting apart; they are not a full UI test."""

    def source(self, relative) -> str:
        return (REPO / relative).read_text(encoding="utf-8")

    def interface(self, name) -> str:
        types = self.source("lib/types.ts")
        start = types.index(f"export interface {name}")
        return types[start:types.index("\n}", start)]

    def test_the_page_knows_every_field_of_the_flag_and_of_the_bookings_it_clashes_with(self):
        for field in schemas.BookingReassessment.model_fields:
            with self.subTest(field=field):
                self.assertRegex(self.interface("BookingReassessment"), rf"\b{field}\b")
        self.assertRegex(self.interface("VenueBookingRecord"), r"\breassessment\b")

    def test_the_label_the_story_names_is_shown_to_venue_staff_and_to_the_coordinator(self):
        for relative in ("components/bookings/BookingRequestCard.tsx", "app/(dashboard)/bookings/page.tsx", "components/queue/tabs/VenueTab.tsx"):
            with self.subTest(file=relative):
                self.assertIn("Requires Reassessment", self.source(relative))

    def test_a_venue_edit_hands_the_flagged_bookings_to_the_page_which_tells_the_coordinator_when_it_loads(self):
        self.assertIn("reassessed_bookings", schemas.VenueUpdateResponse.model_fields)
        self.assertIn("reassessed_bookings", self.interface("ApiVenue"))
        context = self.source("lib/state/app-context.tsx")
        self.assertIn("reassessed_bookings", context)
        self.assertIn("Booking requires reassessment", context)


if __name__ == "__main__":
    unittest.main()

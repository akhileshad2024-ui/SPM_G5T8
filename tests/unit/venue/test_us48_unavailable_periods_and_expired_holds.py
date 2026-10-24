"""
Unit tests for US48 — Include Unavailable Periods and Expired Holds in Conflict Checks.

"As a Venue Staff member, I want the conflict check to account for venue unavailable periods and expired
holds so that availability reflects the venue's real situation."

AC1: a recorded venue unavailable period is treated as a conflict, the same as a confirmed booking ..
     TestUnavailablePeriodConflict (the rule), TestTreatedLikeAConfirmedBooking (what Venue Staff meet)
AC2: expired tentative holds are excluded from the conflict check ..
     TestWhichBookingsHoldTheVenue, TestExpiredHoldsInTheRule, TestExpiredHoldsAreLeftOut

AC2 depends on US42 (Expire Tentative Venue Holds), which is not built: nothing in the app sets a hold's
expiry time yet (the column venue_bookings.hold_expires_at is what US42 will fill). These tests save holds
that have expired straight into the database.

The rules (backend/venue_conflicts.py, backend/venue_availability.py) are called directly on plain values.
The Venue Staff checks run on a real in-memory SQLite database, never Supabase, reusing the US22 test
setup. The integration tests check the same through the API.

Run from the repo root:
    python -m unittest discover -s tests/unit/venue -p "test_us48_*.py" -v
"""

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import HTTPException

from test_us22_submit_booking_request import COORDINATOR, MON, DatabaseTestCase
import main
import models
import schemas
import venue_bookings
from venue_conflicts import UNAVAILABLE_PERIOD, Slot, aware, booking_conflicts, holds_venue, period_conflicts, slot_of

NOW = datetime(2027, 1, 1, 9, 0, tzinfo=timezone.utc)
MAINTENANCE = {"start": "2027-01-04T08:00:00", "end": "2027-01-04T20:00:00", "reason": "maintenance", "note": "Floor repairs"}
MAINTENANCE_TEXT = "Lecture Theatre 1 is unavailable (Maintenance: Floor repairs) from 04 Jan 2027, 08:00 to 04 Jan 2027, 20:00."


def venue_with(*periods) -> SimpleNamespace:
    """The backlog's venue (30 min setup, 45 min turnaround) with these unavailable periods."""
    return SimpleNamespace(id=1, name="Lecture Theatre 1", setupMinutes=30, turnaroundMinutes=45, unavailability=list(periods))


def slot(start="10:00", end="12:00", status="pending", id=1, event_id=1, name="Career Fair", day=MON, expires_at=None) -> Slot:
    return Slot(id, event_id, name, status, day, start, end, expires_at)


def period(start, end, reason="maintenance", note=None) -> dict:
    return {"start": start, "end": end, "reason": reason, "note": note}


# ---------------------------------------------------------------- AC1: unavailable periods

class TestUnavailablePeriodConflict(unittest.TestCase):
    def test_a_period_over_the_booking_is_a_conflict_that_stops_it_being_confirmed(self):
        [found] = period_conflicts(slot(), venue_with(MAINTENANCE))

        self.assertEqual(found, {
            "kind": UNAVAILABLE_PERIOD, "blocks_approval": True, "message": MAINTENANCE_TEXT,
            "period_start": "2027-01-04T08:00:00", "period_end": "2027-01-04T20:00:00",
            "reason": "maintenance", "note": "Floor repairs",
        })

    def test_the_setup_and_turnaround_count_so_a_period_next_to_the_event_can_still_clash(self):
        # The booking occupies the venue from 09:30 (setup) to 12:45 (turnaround).
        cases = (
            ("2027-01-04T06:00:00", "2027-01-04T09:30:00", False), ("2027-01-04T06:00:00", "2027-01-04T09:31:00", True),
            ("2027-01-04T12:45:00", "2027-01-04T18:00:00", False), ("2027-01-04T12:44:00", "2027-01-04T18:00:00", True),
        )
        for start, end, clash in cases:
            with self.subTest(start=start, end=end):
                self.assertEqual(len(period_conflicts(slot(), venue_with(period(start, end)))), 1 if clash else 0)

    def test_a_period_on_another_day_and_a_venue_with_no_periods_are_no_conflict(self):
        self.assertEqual(period_conflicts(slot(), venue_with(period("2027-01-05T08:00:00", "2027-01-05T20:00:00"))), [])
        self.assertEqual(period_conflicts(slot(), venue_with()), [])

    def test_every_period_over_the_booking_is_a_conflict_in_the_order_given(self):
        morning = period("2027-01-04T08:00:00", "2027-01-04T10:30:00", "renovation")
        afternoon = period("2027-01-04T11:00:00", "2027-01-04T18:00:00", "safety")
        elsewhere = period("2027-02-01T08:00:00", "2027-02-01T18:00:00", "other", "Not this day")

        found = period_conflicts(slot(), venue_with(morning, elsewhere, afternoon))

        self.assertEqual([c["reason"] for c in found], ["renovation", "safety"])

    def test_a_period_that_is_not_a_real_date_is_ignored(self):
        broken = (period("soon", "2027-01-04T20:00:00"), period("2027-01-04T08:00:00", None), period("2027-13-45T08:00:00", "2027-01-04T20:00:00"))
        for one in broken:
            with self.subTest(period=one):
                self.assertEqual(period_conflicts(slot(), venue_with(one)), [])

    def test_the_message_names_the_reason_as_a_label_or_as_given_and_the_note_when_there_is_one(self):
        cases = (
            ("equipment_failure", None, "(Equipment failure)"),
            ("safety", "Ceiling repair", "(Safety concern: Ceiling repair)"),
            ("fire drill", "", "(fire drill)"),  # not one of the known reasons: shown as it was saved; an empty note is no note
        )
        for reason, note, wording in cases:
            with self.subTest(reason=reason, note=note):
                [found] = period_conflicts(slot(), venue_with(period("2027-01-04T08:00:00", "2027-01-04T20:00:00", reason, note)))
                self.assertIn(f"is unavailable {wording} from 04 Jan 2027, 08:00", found["message"])


class TreatedLikeATestCase(DatabaseTestCase):
    def refusal(self, booking) -> HTTPException:
        with self.assertRaises(HTTPException) as ctx:
            self.decide(booking.id, "approved")
        return ctx.exception


class TestTreatedLikeAConfirmedBooking(TreatedLikeATestCase):
    def test_a_booking_inside_a_period_cannot_be_confirmed(self):
        booking = self.put_booking(self.venue(unavailability=[MAINTENANCE]))

        refused = self.refusal(booking)

        self.assertEqual(refused.status_code, 409)
        self.assertEqual(refused.detail, f"Can't approve: {MAINTENANCE_TEXT}")

    def test_it_is_refused_in_the_same_way_as_a_clash_with_a_confirmed_booking_and_both_are_named(self):
        venue = self.venue(unavailability=[MAINTENANCE])
        self.put_booking(venue, name="Gala", status="approved", start="10:00", end="12:00")
        fair = self.put_booking(venue, name="Fair", start="11:00", end="13:00")

        refused = self.refusal(fair)

        self.assertEqual(refused.status_code, 409)
        self.assertTrue(refused.detail.startswith("Can't approve: Clashes with Gala"))
        self.assertTrue(refused.detail.endswith(MAINTENANCE_TEXT))  # the booking first, then the period

    def test_it_is_confirmed_once_the_period_has_been_ended_early_or_removed(self):
        for label, periods in (("ended before the setup", [{**MAINTENANCE, "end": "2027-01-04T09:30:00"}]), ("removed", [])):
            with self.subTest(period=label):
                venue = self.venue(unavailability=[MAINTENANCE])
                booking = self.put_booking(venue)
                venue.unavailability = periods
                self.db.commit()

                self.assertEqual(self.decide(booking.id, "approved")["status"], "approved")

    def test_venue_staff_are_shown_the_period_in_the_way_of_a_pending_booking(self):
        booking = self.put_booking(self.venue(unavailability=[MAINTENANCE]))

        [record] = venue_bookings.staff_records(self.db, [booking], NOW)

        self.assertEqual([(c["kind"], c["blocks_approval"], c["message"]) for c in record["conflicts"]],
                         [("unavailable_period", True, MAINTENANCE_TEXT)])

    def test_a_confirmed_booking_inside_a_period_is_shown_it_too(self):
        booking = self.put_booking(self.venue(unavailability=[MAINTENANCE]), status="approved")

        [record] = venue_bookings.staff_records(self.db, [booking], NOW)

        self.assertEqual([c["kind"] for c in record["conflicts"]], ["unavailable_period"])


# ---------------------------------------------------------------- AC2: expired holds

class TestWhichBookingsHoldTheVenue(unittest.TestCase):
    def test_a_confirmed_booking_always_holds_and_a_pending_one_until_its_hold_expires(self):
        cases = (
            ("approved", None, True), ("approved", NOW - timedelta(days=1), True),  # a confirmed booking never expires
            ("pending", None, True), ("pending", NOW + timedelta(hours=1), True),
            ("pending", NOW + timedelta(seconds=1), True), ("pending", NOW, False),  # it expires at its expiry time
            ("pending", NOW - timedelta(minutes=5), False),
            ("rejected", None, False), ("cancelled", NOW + timedelta(hours=1), False),
        )
        for status, expires_at, holds in cases:
            with self.subTest(status=status, expires_at=expires_at):
                self.assertIs(holds_venue(status, expires_at, NOW), holds)

    def test_a_saved_time_without_its_time_zone_is_read_as_utc(self):
        naive = datetime(2027, 1, 1, 9, 0)  # SQLite does not keep the time zone

        self.assertEqual(aware(naive), NOW)
        self.assertEqual(aware(NOW), NOW)
        self.assertIsNone(aware(None))

    def test_a_saved_booking_becomes_a_slot_with_its_expiry_in_utc(self):
        row = SimpleNamespace(id=3, event_id=4, event_name="Career Fair", status="pending", date=MON, start_time="10:00",
                              end_time="12:00", hold_expires_at=datetime(2027, 1, 1, 9, 0))

        self.assertEqual(slot_of(row), Slot(3, 4, "Career Fair", "pending", MON, "10:00", "12:00", NOW))


class TestExpiredHoldsInTheRule(unittest.TestCase):
    def test_an_expired_pending_hold_is_not_in_the_way_but_a_live_one_and_a_confirmed_booking_are(self):
        mine = slot()
        expired = slot(id=2, event_id=2, name="Expired", expires_at=NOW - timedelta(seconds=1))
        live = slot(id=3, event_id=3, name="Live", expires_at=NOW + timedelta(seconds=1))
        confirmed = slot(id=4, event_id=4, name="Confirmed", status="approved", expires_at=NOW - timedelta(days=1))

        found = booking_conflicts(mine, venue_with(), [expired, live, confirmed], NOW)

        self.assertEqual([c["event_name"] for c in found], ["Live", "Confirmed"])


class ExpiredHoldsTestCase(DatabaseTestCase):
    @staticmethod
    def minutes_from_now(minutes) -> datetime:
        return datetime.now(timezone.utc) + timedelta(minutes=minutes)


class TestExpiredHoldsAreLeftOut(ExpiredHoldsTestCase):
    def test_the_bookings_that_hold_the_venue_leave_out_expired_pending_holds_only(self):
        venue, expired_before = self.venue(), NOW - timedelta(minutes=1)
        self.put_booking(venue, name="Expired", hold_expires_at=expired_before)
        self.put_booking(venue, name="Live", start="13:00", end="14:00", hold_expires_at=NOW + timedelta(hours=1))
        self.put_booking(venue, name="Confirmed", start="15:00", end="16:00", status="approved", hold_expires_at=expired_before)
        self.put_booking(venue, name="No expiry", start="17:00", end="18:00")

        held = venue_bookings.held_periods(self.db, now=NOW)

        self.assertEqual(sorted(h.event_name for h in held), ["Confirmed", "Live", "No expiry"])
        # The venue and event filters still apply on top of that.
        live_event = self.db.query(models.VenueBooking).filter_by(event_name="Live").one().event_id
        other_venue = self.put_booking(self.venue(name="Other Hall"), name="Elsewhere")
        narrowed = venue_bookings.held_periods(self.db, venue_ids=[venue.id], exclude_event_id=live_event, now=NOW)
        self.assertEqual(sorted(h.event_name for h in narrowed), ["Confirmed", "No expiry"])
        self.assertEqual([h.event_name for h in venue_bookings.held_periods(self.db, venue_ids=[other_venue.venue_id], now=NOW)], ["Elsewhere"])

    def test_the_real_clock_is_used_when_no_time_is_given(self):
        venue = self.venue()
        self.put_booking(venue, name="Long gone", hold_expires_at=datetime(2000, 1, 1, tzinfo=timezone.utc))
        self.put_booking(venue, name="Far off", start="13:00", end="14:00", hold_expires_at=datetime(2999, 1, 1, tzinfo=timezone.utc))

        self.assertEqual([h.event_name for h in venue_bookings.held_periods(self.db)], ["Far off"])

    def test_a_second_request_is_not_refused_as_a_duplicate_of_a_hold_that_has_expired(self):
        venue = self.venue()
        self.put_booking(venue, name="Expired Fair", hold_expires_at=self.minutes_from_now(-1))

        booking = self.request(self.event(name="Career Fair"), venue).booking

        self.assertEqual((booking.status, booking.verdict, booking.override), ("pending", "suitable", None))

    def test_while_the_hold_has_not_expired_it_still_makes_a_second_request_a_duplicate(self):
        venue = self.venue()
        self.put_booking(venue, name="Live Fair", hold_expires_at=self.minutes_from_now(60))

        refused = self.refused(self.event(name="Career Fair"), venue)

        self.assertEqual(refused.status_code, 409)
        self.assertIn("already has a pending request", refused.detail)

    def test_venue_search_counts_a_venue_with_only_an_expired_hold_as_free(self):
        venue = self.venue()
        hold = self.put_booking(venue, name="Fair", hold_expires_at=self.minutes_from_now(60))
        criteria = schemas.VenueSearchRequest(date=MON, start="10:00", end="12:00")

        self.assertEqual(main.search_venues(criteria, db=self.db, _user=COORDINATOR).total, 0)  # held
        hold.hold_expires_at = self.minutes_from_now(-1)
        self.db.commit()
        self.assertEqual(main.search_venues(criteria, db=self.db, _user=COORDINATOR).total, 1)  # expired

    def test_an_expired_hold_has_nothing_in_its_way_and_is_in_nobody_elses(self):
        venue = self.venue()
        expired = self.put_booking(venue, name="Expired Fair", hold_expires_at=NOW - timedelta(minutes=1))
        live = self.put_booking(venue, name="Career Fair", start="11:00", end="13:00")

        view = {r["event_name"]: r for r in venue_bookings.staff_records(self.db, [expired, live], NOW)}

        self.assertEqual(view["Expired Fair"]["conflicts"], [])
        self.assertEqual(view["Career Fair"]["conflicts"], [])


if __name__ == "__main__":
    unittest.main()

"""
Integration tests for US38 — Flag Bookings Affected by Venue Time Changes.

"As a Venue Staff member, I want existing bookings re-checked when a venue's setup or turnaround time
changes so that bookings that now clash are identified rather than silently removed."

These drive the real FastAPI app through TestClient against an in-memory SQLite database, reusing the US22
setup (events made the way users make them, then real booking requests). The re-check is unit tested in
tests/unit/venue/test_us38_*.py; here the point is that it works through the web layer and a real database.
Dates are a Monday at least 60 days ahead, so the bookings count as "future" whenever the tests are run.

AC1: every pending and confirmed future booking at the venue is re-checked ..... TestVenueTimeChanges
AC2: bookings that now overlap are flagged "Requires Reassessment" with the booking they clash with
     TestVenueTimeChanges
AC3: a flagged booking is never removed or cancelled automatically ........... TestNothingIsRemoved
AC4: the Event Coordinator of each flagged booking is notified ............... TestCoordinatorsAreTold
     (the flag is saved on the booking and sent to its coordinator, whose page turns it into the
     notification when it loads; there is no stored notification until US36)
And how a flag is kept up to date ........................................... TestFlagsClear, TestUnavailablePeriods

Run by hand from the repo root:
    python -m unittest discover -s tests/integration -p "test_us38_*.py" -v
"""

import json
import sys
import unittest
from datetime import datetime, time, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_us22_submit_booking_request_integration import DAY, BookingApiTestCase
import models
from login.models import Role, User
from venue_availability import format_date

WHEN = format_date(DAY)


class US38TestCase(BookingApiTestCase):
    def two_adjacent_requests(self):
        """Career Fair 10:00-12:00 and Open House 12:30-14:00 at a hall with no setup or turnaround time yet."""
        hall = self.flat_venue("Hall")
        fair = self.requested("Career Fair", "10:00", "12:00", venue_id=hall)
        house = self.requested("Open House", "12:30", "14:00", venue_id=hall)
        return hall, fair, house

    def edit(self, hall, **fields):
        res = self.staff.put(f"/venues/{hall}", json=fields)
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()


class TestVenueTimeChanges(US38TestCase):
    def test_changing_the_setup_time_flags_the_bookings_that_now_overlap_with_the_booking_they_clash_with(self):
        hall, _, _ = self.two_adjacent_requests()

        edited = self.edit(hall, setupMinutes=60)

        self.assertEqual(sorted(b["event_name"] for b in edited["reassessed_bookings"]), ["Career Fair", "Open House"])
        view = self.staff_view()
        flag = view["Career Fair"]["reassessment"]
        self.assertEqual((flag["reason"], flag["setup_minutes"], flag["turnaround_minutes"]), ("venue_time_changed", 60, 0))
        self.assertEqual([(c["event_name"], c["kind"]) for c in flag["clashes_with"]], [("Open House", "pending_request")])
        self.assertEqual(flag["clashes_with"][0]["message"],
                         f"Clashes with Open House, already requested on {WHEN} (venue occupied 11:30–14:00 incl. 60 min setup).")
        self.assertEqual([c["event_name"] for c in view["Open House"]["reassessment"]["clashes_with"]], ["Career Fair"])

    def test_the_bookings_holds_follow_the_venues_new_times(self):
        hall, _, _ = self.two_adjacent_requests()

        self.edit(hall, setupMinutes=60, turnaroundMinutes=30)

        view = self.staff_view()
        self.assertEqual((view["Career Fair"]["setup_minutes"], view["Career Fair"]["teardown_minutes"]), (60, 30))
        self.assertEqual((view["Career Fair"]["hold_start"], view["Career Fair"]["hold_end"]), (f"{DAY}T09:00:00", f"{DAY}T12:30:00"))

    def test_changing_only_the_turnaround_time_flags_them_too(self):
        hall, _, _ = self.two_adjacent_requests()

        edited = self.edit(hall, turnaroundMinutes=90)  # Career Fair is held until 13:30, Open House from 12:30

        self.assertEqual(sorted(b["event_name"] for b in edited["reassessed_bookings"]), ["Career Fair", "Open House"])
        self.assertEqual(self.staff_view()["Career Fair"]["reassessment"]["turnaround_minutes"], 90)

    def test_confirmed_bookings_are_rechecked_too_and_stay_confirmed(self):
        hall, fair, house = self.two_adjacent_requests()
        self.assertEqual(self.decide(fair["id"], "approved").status_code, 200)
        self.assertEqual(self.decide(house["id"], "approved").status_code, 200)

        edited = self.edit(hall, setupMinutes=60)

        self.assertEqual(len(edited["reassessed_bookings"]), 2)
        view = self.staff_view()
        self.assertEqual((view["Career Fair"]["status"], view["Open House"]["status"]), ("approved", "approved"))
        self.assertEqual(view["Career Fair"]["reassessment"]["clashes_with"][0]["kind"], "confirmed_booking")

    def test_only_the_bookings_that_now_overlap_are_flagged_and_a_booking_that_is_over_is_left_alone(self):
        hall, _, _ = self.two_adjacent_requests()
        later = self.requested("Evening Talk", "18:00", "19:00", venue_id=hall)  # clears both, even with a 60 minute setup
        over = datetime.now().date() - timedelta(days=14)  # saved straight into the database: an event can't be made in the past
        for name, start, end in (("Past A", (10, 0), (12, 0)), ("Past B", (12, 30), (14, 0))):
            event = self.make_event(name, preferredDate=DAY.isoformat(), startTime=f"{start[0]}:{start[1]:02d}", endTime=f"{end[0]}:{end[1]:02d}")
            self.put_booking(event, hall, date=over, hold_start=datetime.combine(over, time(*start)), hold_end=datetime.combine(over, time(*end)))

        edited = self.edit(hall, setupMinutes=60)

        flagged = sorted(b["event_name"] for b in edited["reassessed_bookings"])
        self.assertEqual(flagged, ["Career Fair", "Open House"])  # not Evening Talk, not the two that are over
        view = self.staff_view()
        self.assertIsNone(view["Evening Talk"]["reassessment"])
        self.assertEqual(view["Evening Talk"]["setup_minutes"], 60)  # re-checked: its hold follows the new setup time
        self.assertEqual((view["Past A"]["reassessment"], view["Past A"]["setup_minutes"]), (None, 0))  # not re-checked at all


class TestNothingIsRemoved(US38TestCase):
    def test_flagged_bookings_stay_and_their_events_are_unchanged(self):
        hall, fair, house = self.two_adjacent_requests()
        before = {b["event_name"]: (b["status"], self.event_as(self.coordinator, b["event_id"])) for b in (fair, house)}

        self.edit(hall, setupMinutes=60)

        after = {b["event_name"]: b for b in self.coordinator.get("/bookings").json()}
        self.assertEqual(sorted(after), ["Career Fair", "Open House"])
        for name, (status, event) in before.items():
            now = self.event_as(self.coordinator, after[name]["event_id"])
            self.assertEqual(after[name]["status"], status)
            for field in ("status", "name", "date", "start", "end", "venue", "bookingState", "pax", "layout"):
                self.assertEqual(now[field], event[field], f"{name}: {field}")


class TestCoordinatorsAreTold(US38TestCase):
    def test_the_coordinator_is_sent_the_flag_but_not_the_booking_it_clashes_with(self):
        hall, _, _ = self.two_adjacent_requests()
        self.edit(hall, setupMinutes=60)

        mine = {b["event_name"]: b for b in self.coordinator.get("/bookings").json()}

        flag = mine["Career Fair"]["reassessment"]
        self.assertEqual(flag["reason"], "venue_time_changed")
        self.assertIn("now 60 min setup and 0 min turnaround", flag["message"])
        self.assertIn("The booking is kept", flag["message"])
        self.assertEqual(flag["clashes_with"], [])
        self.assertNotIn("Open House", json.dumps(flag))

    def test_each_coordinator_is_sent_the_flags_of_their_own_events_only(self):
        hall, _, house = self.two_adjacent_requests()
        self.edit(hall, setupMinutes=60)
        marcus = self.client(Role.coordinator, "marcus.lee@connectsphere.edu")
        marcus_id = self.db.query(User).filter(User.email == "marcus.lee@connectsphere.edu").first().id
        self.db.get(models.Event, house["event_id"]).coordinator_id = marcus_id
        self.db.commit()

        priyas, marcuss = self.coordinator.get("/bookings"), marcus.get("/bookings")

        self.assertEqual([(b["event_name"], b["reassessment"] is not None) for b in priyas.json()], [("Career Fair", True)])
        self.assertEqual([(b["event_name"], b["reassessment"] is not None) for b in marcuss.json()], [("Open House", True)])
        self.assertNotIn("Open House", priyas.text)
        self.assertNotIn("Career Fair", marcuss.text)


class TestFlagsClear(US38TestCase):
    def flagged_pair(self):
        hall, fair, house = self.two_adjacent_requests()
        self.edit(hall, setupMinutes=60)
        self.assertIsNotNone(self.staff_view()["Career Fair"]["reassessment"])
        return hall, fair, house

    def test_putting_the_time_back_clears_both_flags(self):
        hall, _, _ = self.flagged_pair()

        edited = self.edit(hall, setupMinutes=0)

        view = self.staff_view()
        self.assertEqual((view["Career Fair"]["reassessment"], view["Open House"]["reassessment"]), (None, None))
        self.assertEqual(edited["reassessed_bookings"], [])

    def test_rejecting_one_booking_clears_the_flag_on_the_other(self):
        _, _, house = self.flagged_pair()

        self.assertEqual(self.decide(house["id"], "rejected", "The hall is needed for the Career Fair.").status_code, 200)

        self.assertIsNone(self.staff_view()["Career Fair"]["reassessment"])

    def test_the_reply_to_a_rejection_carries_the_rejected_booking_because_its_event_leaves_venue_staffs_list(self):
        # The page cannot read that event again (an event holding no venue is not Venue Staff's to see), so it takes the reply.
        _, _, house = self.flagged_pair()

        rejected = self.decide(house["id"], "rejected", "The hall is needed for the Career Fair.")

        self.assertEqual((rejected.json()["status"], rejected.json()["conflicts"]), ("rejected", []))
        self.assertNotIn("Open House", self.staff_view())
        self.assertEqual(self.staff.get(f"/events/{house['event_id']}").status_code, 403)

    def test_cancelling_one_booking_clears_the_flag_on_the_other(self):
        _, _, house = self.flagged_pair()

        self.assertEqual(self.coordinator.post(f"/bookings/{house['id']}/cancel").status_code, 200)

        self.assertIsNone(self.staff_view()["Career Fair"]["reassessment"])

    def test_an_edit_that_leaves_the_times_alone_keeps_the_flags_as_they_were(self):
        hall, _, _ = self.flagged_pair()
        flagged_at = self.staff_view()["Career Fair"]["reassessment"]["flagged_at"]

        edited = self.edit(hall, name="Renamed Hall", cap=300)

        self.assertEqual(edited["reassessed_bookings"], [])
        self.assertEqual(self.staff_view()["Career Fair"]["reassessment"]["flagged_at"], flagged_at)


class TestUnavailablePeriods(US38TestCase):
    def test_a_longer_setup_that_reaches_an_unavailable_period_flags_the_booking_for_a_replacement_venue_too(self):
        period = {"start": f"{DAY}T07:00", "end": f"{DAY}T09:15", "reason": "maintenance"}
        hall = self.flat_venue("Period Hall", unavailability=[period])
        booking = self.requested("Career Fair", "10:00", "12:00", venue_id=hall)  # held from 10:00: clear of the period
        self.assertIsNone(self.staff_view()["Career Fair"]["flag"])

        edited = self.edit(hall, setupMinutes=60)  # held from 09:00 now

        self.assertEqual([b["id"] for b in edited["flagged_bookings"]], [booking["id"]])
        self.assertEqual(edited["reassessed_bookings"], [])
        self.assertEqual(self.staff_view()["Career Fair"]["flag"]["kind"], "venue_unavailable")


if __name__ == "__main__":
    unittest.main()

"""
Integration tests for US40 — Request Replacement Venue.

"As an Event Coordinator, I want to search for and request a replacement venue for a booking affected by venue
unavailability so that my event can still go ahead."

These drive the real FastAPI app through TestClient against an in-memory SQLite database, reusing the US22 setup
(events made the way users make them, then real booking requests approved by Venue Staff). A booking is flagged
the way it is in use: Venue Staff record an unavailable period over it (US39). The rules are unit tested in
tests/unit/venue/test_us40_*.py; here the point is that they work through the web layer: login sessions, role
checks, the SQL queries, notifications and the venue search together.
Dates are a Monday at least 60 days ahead, so nothing here depends on when the tests are run.

AC1: can view all of their bookings flagged as needing alternative arrangements ... TestSeeingFlaggedBookings
AC2: can search for a replacement venue using the original booking's timing and requirements ... TestSearching
AC3: can submit a booking request for it, linked to the original ... TestRequesting, TestWhoCanReplaceWhat
AC4: keeps the original event information and the original booking ... TestOriginalIsKept
AC5: has the flag cleared once the replacement is approved ... TestFlagClears

Run by hand from the repo root:
    python -m unittest discover -s tests/integration -p "test_us40_*.py" -v
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_us22_submit_booking_request_integration import DAY, BookingApiTestCase
import models
from auth.models import Role

PERIOD = {"start": f"{DAY}T08:00", "end": f"{DAY}T20:00", "reason": "maintenance"}


class US40TestCase(BookingApiTestCase):
    def flagged(self, name="Career Fair", hall="Hall A", **body) -> dict:
        """An approved event with an approved booking at `hall`, which Venue Staff then make unavailable that day,
        so the booking is flagged as needing alternative arrangements. Returns the booking."""
        venue_id = self.flat_venue(hall)
        event_id = self.make_event(name, preferredDate=DAY.isoformat(), startTime="10:00", endTime="12:00")
        res = self.submit(event_id, venue_id=venue_id, **body)
        self.assertEqual(res.status_code, 200, res.text)
        booking = res.json()["booking"]
        self.assertEqual(self.decide(booking["id"], "approved").status_code, 200)
        self.make_unavailable(venue_id)
        return booking

    def make_unavailable(self, venue_id, period=PERIOD):
        res = self.staff.put(f"/venues/{venue_id}", json={"unavailability": [period]})
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    def replace(self, venue_id, booking, client=None, **body):
        return (client or self.coordinator).post(
            f"/venues/{venue_id}/booking-requests", json={"event_id": booking["event_id"], "replaces_booking_id": booking["id"], **body})

    def bookings(self, client=None) -> dict:
        res = (client or self.coordinator).get("/bookings")
        self.assertEqual(res.status_code, 200, res.text)
        return {b["venue_name"]: b for b in res.json()}

    def notices(self, client) -> list:
        res = client.get("/notifications")
        self.assertEqual(res.status_code, 200, res.text)
        return [(n["title"], n["body"]) for n in reversed(res.json())]


class TestSeeingFlaggedBookings(US40TestCase):
    def test_the_venue_edit_flags_the_booking_and_the_coordinator_is_sent_the_flag(self):
        venue_id = self.flat_venue("Hall A")
        booking = self.requested("Career Fair", "10:00", "12:00", venue_id=venue_id)
        self.decide(booking["id"], "approved")

        edited = self.make_unavailable(venue_id)

        self.assertEqual([b["event_name"] for b in edited["flagged_bookings"]], ["Career Fair"])
        flag = self.bookings()["Hall A"]["flag"]
        self.assertEqual(flag["kind"], "venue_unavailable")
        self.assertIn("A replacement venue is required.", flag["message"])

    def test_all_of_the_coordinators_flagged_bookings_are_listed_and_unflagged_ones_have_no_flag(self):
        self.flagged("First Fair", "Hall A")
        self.flagged("Second Fair", "Hall B")
        steady = self.flat_venue("Hall C")
        self.requested("Steady Fair", "10:00", "12:00", venue_id=steady)  # a different venue, never made unavailable

        listed = self.bookings()

        self.assertEqual(sorted(name for name, b in listed.items() if b["flag"]), ["Hall A", "Hall B"])
        self.assertIsNone(listed["Hall C"]["flag"])

    def test_another_coordinator_is_not_sent_them(self):
        self.flagged()
        other = self.client(Role.coordinator, "marcus.lee@connectsphere.edu")

        self.assertEqual(other.get("/bookings").json(), [])

    def test_venue_staff_see_the_flag_too(self):
        self.flagged()

        self.assertEqual(self.bookings(self.staff)["Hall A"]["flag"]["kind"], "venue_unavailable")

    def test_ending_the_period_clears_the_flag_without_a_replacement(self):
        venue_id = self.flat_venue("Hall A")
        booking = self.requested("Career Fair", "10:00", "12:00", venue_id=venue_id)
        self.decide(booking["id"], "approved")
        self.make_unavailable(venue_id)
        self.staff.put(f"/venues/{venue_id}", json={"unavailability": []})

        self.assertIsNone(self.bookings()["Hall A"]["flag"])


class TestSearching(US40TestCase):
    def test_a_search_for_the_originals_timing_and_needs_offers_other_venues_and_not_the_unavailable_one(self):
        booking = self.flagged(attendance=40, layout="classroom")
        self.flat_venue("Hall B")
        self.flat_venue("Tiny Hall", cap=20)  # too small for 40 people

        found = self.coordinator.post("/venues/search", json={
            "date": DAY.isoformat(), "start": "10:00", "end": "12:00", "attendance": booking["attendance"], "layout": booking["layout"]})

        self.assertEqual(found.status_code, 200, found.text)
        names = [v["name"] for v in found.json()["venues"]]
        self.assertIn("Hall B", names)
        self.assertNotIn("Hall A", names)  # unavailable that day
        self.assertNotIn("Tiny Hall", names)

    def test_the_replacement_is_requested_with_the_originals_timing_attendance_layout_and_purpose(self):
        booking = self.flagged(attendance=40, layout="classroom", purpose="Breakout session")
        hall_b = self.flat_venue("Hall B")

        res = self.replace(hall_b, booking)

        self.assertEqual(res.status_code, 200, res.text)
        saved = res.json()["booking"]
        self.assertEqual((saved["date"], saved["start"], saved["end"]), (str(DAY), "10:00", "12:00"))
        self.assertEqual((saved["attendance"], saved["layout"], saved["purpose"]), (40, "classroom", "Breakout session"))

    def test_the_coordinator_can_change_the_attendance_and_layout_for_the_replacement(self):
        booking = self.flagged(attendance=40, layout="classroom")
        hall_b = self.flat_venue("Hall B")

        saved = self.replace(hall_b, booking, attendance=30, layout="theatre").json()["booking"]

        self.assertEqual((saved["attendance"], saved["layout"]), (30, "theatre"))

    def test_a_venue_that_is_not_suitable_needs_the_warning_acknowledged(self):
        booking = self.flagged(attendance=40, layout="classroom")
        small = self.flat_venue("Tiny Hall", cap=20)

        refused = self.replace(small, booking)
        accepted = self.replace(small, booking, acknowledged=True)

        self.assertEqual(refused.status_code, 409)
        self.assertEqual((accepted.status_code, accepted.json()["booking"]["override"]["verdict"]), (200, "unsuitable"))


class TestRequesting(US40TestCase):
    def test_the_replacement_is_a_pending_request_linked_to_the_original(self):
        booking = self.flagged()
        hall_b = self.flat_venue("Hall B")

        res = self.replace(hall_b, booking)

        saved = res.json()["booking"]
        self.assertEqual((res.status_code, saved["status"], saved["replaces_booking_id"], saved["venue_name"]), (200, "pending", booking["id"], "Hall B"))
        self.assertEqual(self.bookings()["Hall B"]["replaces_booking_id"], booking["id"])
        self.assertEqual(self.bookings(self.staff)["Hall B"]["replaces_booking_id"], booking["id"])
        self.assertIsNone(self.bookings()["Hall A"]["replaces_booking_id"])

    def test_venue_staff_are_told_it_is_a_replacement(self):
        booking = self.flagged()
        hall_b = self.flat_venue("Hall B")

        res = self.replace(hall_b, booking)

        self.assertIn("It replaces the booking at Hall A, which needs alternative arrangements.", res.json()["notification"]["body"])
        self.assertTrue(any("It replaces the booking at Hall A" in body for title, body in self.notices(self.staff) if title == "Booking request pending"))

    def test_an_ordinary_request_has_no_link(self):
        hall_b = self.flat_venue("Hall B")

        saved = self.requested("Plain Fair", "10:00", "12:00", venue_id=hall_b)

        self.assertIsNone(saved["replaces_booking_id"])

    def test_the_original_venue_cannot_be_chosen_again(self):
        booking = self.flagged()

        hall_a = self.db.query(models.Venue).filter_by(name="Hall A").one().id

        refused = self.replace(hall_a, booking)

        self.assertEqual(refused.status_code, 409)
        self.assertIn("already has a booking for Hall A", refused.json()["detail"])

    def test_only_one_replacement_can_be_open_but_another_can_be_tried_after_a_rejection(self):
        booking = self.flagged()
        hall_b, hall_c = self.flat_venue("Hall B"), self.flat_venue("Hall C")
        first = self.replace(hall_b, booking).json()["booking"]

        second = self.replace(hall_c, booking)
        self.decide(first["id"], "rejected", "Hall B is needed for exams.")
        third = self.replace(hall_c, booking)

        self.assertEqual((second.status_code, second.json()["detail"]),
                         (409, "A replacement for this booking is already pending: Hall B. Cancel it to try another venue."))
        self.assertEqual((third.status_code, third.json()["booking"]["replaces_booking_id"]), (200, booking["id"]))

    def test_cancelling_the_replacement_lets_the_coordinator_try_another_venue(self):
        booking = self.flagged()
        hall_b, hall_c = self.flat_venue("Hall B"), self.flat_venue("Hall C")
        first = self.replace(hall_b, booking).json()["booking"]
        self.assertEqual(self.coordinator.post(f"/bookings/{first['id']}/cancel").status_code, 200)

        self.assertEqual(self.replace(hall_c, booking).status_code, 200)

    def test_an_event_in_its_safety_check_can_still_ask_for_a_replacement_but_not_for_another_venue(self):
        booking = self.flagged()
        hall_b, hall_c = self.flat_venue("Hall B"), self.flat_venue("Hall C")
        event = self.db.get(models.Event, booking["event_id"])
        event.status = models.EventStatus.pending_safety_review
        self.db.commit()

        replacement = self.replace(hall_b, booking)
        ordinary = self.submit(booking["event_id"], venue_id=hall_c)

        self.assertEqual(replacement.status_code, 200, replacement.text)
        self.assertEqual(ordinary.status_code, 409)
        self.assertIn("A venue can only be requested for an approved event", ordinary.json()["detail"])


class TestWhoCanReplaceWhat(US40TestCase):
    def test_a_booking_that_is_not_flagged_cannot_be_replaced(self):
        hall_b, hall_c = self.flat_venue("Hall B"), self.flat_venue("Hall C")
        steady = self.requested("Steady Fair", "10:00", "12:00", venue_id=hall_b)

        refused = self.replace(hall_c, steady)

        self.assertEqual((refused.status_code, refused.json()["detail"]), (409, "That booking isn't flagged as needing alternative arrangements."))

    def test_a_booking_of_another_event_cannot_be_used(self):
        flagged = self.flagged()
        hall_b, hall_c = self.flat_venue("Hall B"), self.flat_venue("Hall C")
        other = self.requested("Other Fair", "10:00", "12:00", venue_id=hall_b)

        refused = self.replace(hall_c, {"id": flagged["id"], "event_id": other["event_id"]})

        self.assertEqual((refused.status_code, refused.json()["detail"]), (409, "That booking belongs to another event."))

    def test_a_booking_that_was_cancelled_cannot_be_replaced(self):
        booking = self.flagged()
        self.coordinator.post(f"/bookings/{booking['id']}/cancel")
        hall_b = self.flat_venue("Hall B")

        refused = self.replace(hall_b, booking)

        self.assertEqual((refused.status_code, refused.json()["detail"]), (409, "That booking is cancelled, so it can't be replaced."))

    def test_an_unknown_booking_is_refused_and_a_non_positive_id_is_not_valid(self):
        booking = self.flagged()
        hall_b = self.flat_venue("Hall B")

        unknown = self.replace(hall_b, {"id": 99999, "event_id": booking["event_id"]})
        invalid = self.replace(hall_b, {"id": 0, "event_id": booking["event_id"]})

        self.assertEqual((unknown.status_code, unknown.json()["detail"]), (409, "The booking to replace was not found."))
        self.assertEqual(invalid.status_code, 422)

    def test_only_the_events_own_coordinator_can_ask_and_nobody_signed_out(self):
        booking = self.flagged()
        hall_b = self.flat_venue("Hall B")
        other = self.client(Role.coordinator, "marcus.lee@connectsphere.edu")

        self.assertEqual(self.replace(hall_b, booking, client=other).status_code, 403)
        self.assertEqual(self.replace(hall_b, booking, client=self.client(None)).status_code, 401)
        for name, client in (("organiser", self.organiser), ("venue", self.staff), ("lead", self.lead)):
            with self.subTest(role=name):
                self.assertEqual(self.replace(hall_b, booking, client=client).status_code, 403)
        self.assertEqual(len(self.bookings()), 1)


class TestOriginalIsKept(US40TestCase):
    def test_asking_changes_neither_the_original_booking_nor_the_event(self):
        booking = self.flagged()
        before = {**self.bookings()["Hall A"]}
        event_before = self.coordinator.get(f"/events/{booking['event_id']}").json()

        self.replace(self.flat_venue("Hall B"), booking)

        self.assertEqual(self.bookings()["Hall A"], before)
        event_after = self.coordinator.get(f"/events/{booking['event_id']}").json()
        for field in ("name", "date", "start", "end", "status", "pax", "layout", "venue", "venueName"):
            self.assertEqual(event_after[field], event_before[field], field)

    def test_after_approval_the_original_stays_as_a_cancelled_record_and_the_event_moves_to_the_replacement(self):
        booking = self.flagged()
        hall_b = self.flat_venue("Hall B")
        replacement = self.replace(hall_b, booking).json()["booking"]
        before = self.bookings()["Hall A"]

        self.assertEqual(self.decide(replacement["id"], "approved").status_code, 200)

        after = self.bookings()
        self.assertEqual(after["Hall A"]["status"], "cancelled")
        for field in ("id", "event_name", "venue_id", "date", "start", "end", "attendance", "layout", "requested_by", "hold_start", "hold_end"):
            self.assertEqual(after["Hall A"][field], before[field], field)
        self.assertEqual((after["Hall B"]["status"], after["Hall B"]["replaces_booking_id"]), ("approved", booking["id"]))
        event = self.coordinator.get(f"/events/{booking['event_id']}").json()
        self.assertEqual((event["venueName"], event["bookingState"], event["name"], event["date"]), ("Hall B", "approved", "Career Fair", str(DAY)))

    def test_the_released_venue_is_free_for_other_events(self):
        booking = self.flagged()
        replacement = self.replace(self.flat_venue("Hall B"), booking).json()["booking"]
        self.decide(replacement["id"], "approved")
        self.staff.put(f"/venues/{booking['venue_id']}", json={"unavailability": []})

        other = self.make_event("Other Fair", preferredDate=DAY.isoformat(), startTime="10:00", endTime="12:00")
        res = self.submit(other, venue_id=booking["venue_id"])

        self.assertEqual(res.status_code, 200, res.text)


class TestFlagClears(US40TestCase):
    def test_the_flag_is_cleared_when_the_replacement_is_approved_and_not_before(self):
        booking = self.flagged()
        replacement = self.replace(self.flat_venue("Hall B"), booking).json()["booking"]
        self.assertIsNotNone(self.bookings()["Hall A"]["flag"])

        self.decide(replacement["id"], "approved")

        self.assertEqual([name for name, b in self.bookings().items() if b["flag"]], [])
        self.assertEqual([name for name, b in self.bookings(self.staff).items() if b["flag"]], [])

    def test_a_rejected_replacement_leaves_the_original_flagged(self):
        booking = self.flagged()
        replacement = self.replace(self.flat_venue("Hall B"), booking).json()["booking"]

        self.decide(replacement["id"], "rejected", "Hall B is needed for exams.")

        original = self.bookings()["Hall A"]
        self.assertEqual((original["status"], original["flag"]["kind"]), ("approved", "venue_unavailable"))

    def test_the_coordinator_is_told_the_original_was_released(self):
        booking = self.flagged()
        replacement = self.replace(self.flat_venue("Hall B"), booking).json()["booking"]

        self.decide(replacement["id"], "approved")

        [(title, body)] = [n for n in self.notices(self.coordinator) if n[0] == "Venue booking approved" and "Hall B" in n[1]]
        self.assertIn("It replaces the booking at Hall A, which has been released and no longer needs alternative arrangements.", body)

    def test_a_decided_replacement_cannot_be_decided_again(self):
        booking = self.flagged()
        replacement = self.replace(self.flat_venue("Hall B"), booking).json()["booking"]
        self.decide(replacement["id"], "approved")

        self.assertEqual(self.decide(replacement["id"], "approved").status_code, 409)
        self.assertEqual(self.bookings()["Hall A"]["status"], "cancelled")

    def test_the_whole_story_the_event_goes_ahead_at_the_replacement_venue(self):
        booking = self.flagged(attendance=40, layout="classroom")
        replacement = self.replace(self.flat_venue("Hall B"), booking).json()["booking"]
        self.decide(replacement["id"], "approved")

        listed = self.bookings()

        self.assertEqual((listed["Hall B"]["status"], listed["Hall B"]["attendance"], listed["Hall B"]["layout"]), ("approved", 40, "classroom"))
        self.assertEqual([b["venue_name"] for b in listed.values() if b["status"] == "approved"], ["Hall B"])


if __name__ == "__main__":
    unittest.main()

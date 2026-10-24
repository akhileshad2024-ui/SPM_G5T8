"""
Integration tests for US41 — Manage Multiple Venue Bookings for an Event.

Drives the real FastAPI app through TestClient against an in-memory SQLite database (never Supabase),
reusing the US22 setup: events made the way users make them, then real booking requests.

AC1 several venues, each once ................ TestThroughTheApi.test_several_venues_each_once
AC2 each booking's own attendance, layout and purpose ... test_each_booking_has_its_own_needs
AC3 checked on its own ........................ test_each_booking_has_its_own_needs (verdicts)
AC4 all bookings and statuses together ....... test_all_bookings_listed_together
AC5 change or cancel one, or cancel all ...... test_change_one / test_cancel_one_then_all

Run from the repo root:
    python -m unittest discover -s tests/integration -p "test_us41_*.py" -v
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_us22_submit_booking_request_integration import THEATRE, BookingApiTestCase

ROOM = {**THEATRE, "name": "Seminar Room", "cap": 40, "layouts": ["classroom"]}


class TestThroughTheApi(BookingApiTestCase):
    def setUp(self):
        super().setUp()
        self.room = self.staff.post("/venues", json=ROOM).json()

    def book(self, event_id, venue, **details):
        return self.submit(event_id, venue_id=venue["id"], **details)

    def mine(self, event_id):
        return [b for b in self.coordinator.get("/bookings").json() if b["event_id"] == event_id]

    def test_several_venues_each_once(self):
        event_id = self.make_event()
        self.assertEqual(self.book(event_id, self.venue).status_code, 200)
        self.assertEqual(self.book(event_id, self.room, attendance=30, layout="classroom").status_code, 200)

        again = self.book(event_id, self.room, attendance=30, layout="classroom")
        self.assertEqual(again.status_code, 409)
        self.assertIn("already has a booking for Seminar Room", again.json()["detail"])

    def test_each_booking_has_its_own_needs(self):
        event_id = self.make_event()  # 100 people, theatre
        main_room = self.book(event_id, self.venue, purpose="Main programme").json()["booking"]
        breakout = self.book(event_id, self.room, attendance=30, layout="classroom", purpose="Breakout session").json()["booking"]

        self.assertEqual((main_room["attendance"], main_room["layout"], main_room["purpose"]), (100, "theatre", "Main programme"))
        self.assertEqual((breakout["attendance"], breakout["layout"], breakout["purpose"]), (30, "classroom", "Breakout session"))
        self.assertEqual((main_room["verdict"], breakout["verdict"]), ("suitable", "suitable"))

    def test_all_bookings_listed_together(self):
        event_id = self.make_event()
        a = self.book(event_id, self.venue).json()["booking"]
        self.book(event_id, self.room, attendance=30, layout="classroom")
        self.assertTrue(self.decide(a["id"], "approved").is_success)

        self.assertEqual([(b["venue_name"], b["status"]) for b in self.mine(event_id)],
                         [("Lecture Theatre 1", "approved"), ("Seminar Room", "pending")])
        event = self.event_as(self.coordinator, event_id)
        self.assertEqual((event["venue"], event["bookingState"]), (self.venue["id"], "pending"))

    def test_change_one(self):
        event_id = self.make_event()
        a = self.book(event_id, self.venue).json()["booking"]
        b = self.book(event_id, self.room, attendance=30, layout="classroom").json()["booking"]
        self.assertTrue(self.decide(b["id"], "approved").is_success)

        res = self.coordinator.patch(f"/bookings/{b['id']}", json={"attendance": 35, "purpose": "Workshop"})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual((res.json()["attendance"], res.json()["purpose"], res.json()["status"]), (35, "Workshop", "pending"))
        self.assertEqual(self.mine(event_id)[0]["id"], a["id"])
        self.assertEqual(self.mine(event_id)[0]["status"], "pending")

        too_many = self.coordinator.patch(f"/bookings/{b['id']}", json={"attendance": 60})
        self.assertEqual(too_many.status_code, 409)
        self.assertEqual(self.coordinator.patch(f"/bookings/{b['id']}", json={"attendance": 0}).status_code, 422)

    def test_cancel_one_then_all(self):
        event_id = self.make_event()
        a = self.book(event_id, self.venue).json()["booking"]
        b = self.book(event_id, self.room, attendance=30, layout="classroom").json()["booking"]

        self.assertEqual(self.coordinator.post(f"/bookings/{a['id']}/cancel").status_code, 200)
        self.assertEqual([(x["id"], x["status"]) for x in self.mine(event_id)], [(a["id"], "cancelled"), (b["id"], "pending")])

        self.book(event_id, self.venue)
        res = self.coordinator.post(f"/events/{event_id}/bookings/cancel")
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(len(res.json()), 2)
        self.assertTrue(all(x["status"] == "cancelled" for x in self.mine(event_id)))
        event = self.event_as(self.coordinator, event_id)
        self.assertEqual((event["venue"], event["bookingState"]), (None, None))

    def test_only_the_events_coordinator_signed_in_may_change_or_cancel(self):
        event_id = self.make_event()
        booking = self.book(event_id, self.venue).json()["booking"]
        signed_out = self.client(None)
        for client, code in ((signed_out, 401), (self.staff, 403), (self.organiser, 403)):
            with self.subTest(code=code):
                self.assertEqual(client.patch(f"/bookings/{booking['id']}", json={"attendance": 10}).status_code, code)
                self.assertEqual(client.post(f"/bookings/{booking['id']}/cancel").status_code, code)
                self.assertEqual(client.post(f"/events/{event_id}/bookings/cancel").status_code, code)


if __name__ == "__main__":
    unittest.main()

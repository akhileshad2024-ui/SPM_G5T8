"""
Integration tests for US44 — Conduct Operational Safety Check.

"As a Safety Officer, I want to review the operational safety of a planned event so that it proceeds to
preparation only when its arrangements are safe."

These drive the real FastAPI app through TestClient against an in-memory SQLite database, reusing the US22 setup
(events made the way users make them, then real booking requests approved by Venue Staff). The rules are unit
tested in tests/unit/safety/test_us44_*.py; here the point is that they work through the web layer: login
sessions, role checks, the SQL queries, notifications and the event history together.
Dates are a Monday at least 60 days ahead, so nothing here depends on when the tests are run.

AC1: the Safety Officer is a role in the access control matrix ................ TestAccess
AC2: sees the events whose arrangements are confirmed and that await a check ... TestAwaitingEvents
AC3: can review attendance, capacity and layout, emergency access, accessibility, equipment placement,
     crowd movement and venue restrictions ..................................... TestWhatIsReviewed
AC4: approve, request changes or reject, with a mandatory comment when rejecting or requesting changes
     TestDeciding
AC5: outcome, reviewer and time recorded; the status updated .................... TestRecorded
AC6: the Event Coordinator is notified of the outcome ........................... TestNotifications
AC7: a rejection returns the event to rework (US45), it does not end it ........ TestRework

Run by hand from the repo root:
    python -m unittest discover -s tests/integration -p "test_us44_*.py" -v
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_us22_submit_booking_request_integration import DAY, BookingApiTestCase
import equipment.service as equipment
from auth.models import Role

SAFETY_STATUSES = ("pending_safety_review", "safety_changes_requested", "safety_approved", "safety_rejected")


class US44TestCase(BookingApiTestCase):
    def setUp(self):
        super().setUp()
        self.hannah = self.client(Role.safety, "hannah.lau@connectsphere.edu")
        self.ravi = self.client(Role.safety, "ravi.menon@connectsphere.edu")
        self.tech = self.client(Role.tech)

    def ready_event(self, name="Career Fair") -> dict:
        """An approved event whose one venue booking Venue Staff have approved. Returns the booking."""
        hall = self.flat_venue(f"Hall for {name}")
        booking = self.requested(name, "10:00", "12:00", venue_id=hall)
        self.assertEqual(self.decide(booking["id"], "approved").status_code, 200)
        return booking

    def send(self, event_id, client=None):
        return (client or self.coordinator).post(f"/events/{event_id}/safety-check/request")

    def waiting_event(self, name="Career Fair") -> int:
        event_id = self.ready_event(name)["event_id"]
        self.assertEqual(self.send(event_id).status_code, 200)
        return event_id

    def decide_check(self, event_id, outcome, comment="", client=None):
        return (client or self.hannah).post(f"/events/{event_id}/safety-check", json={"outcome": outcome, "comment": comment})

    def status_of(self, event_id) -> str:
        return self.coordinator.get(f"/events/{event_id}").json()["status"]

    def checks(self, client=None) -> dict:
        res = (client or self.hannah).get("/safety-checks")
        self.assertEqual(res.status_code, 200, res.text)
        return {c["name"]: c for c in res.json()}

    def notices(self, client) -> list:
        res = client.get("/notifications")
        self.assertEqual(res.status_code, 200, res.text)
        return [(n["title"], n["body"]) for n in reversed(res.json())]


class TestAccess(US44TestCase):
    def test_signed_out_users_get_nothing(self):
        signed_out = self.client(None)
        event_id = self.waiting_event()

        self.assertEqual(signed_out.get("/safety-checks").status_code, 401)
        self.assertEqual(signed_out.post(f"/events/{event_id}/safety-check", json={"outcome": "approved"}).status_code, 401)
        self.assertEqual(signed_out.post(f"/events/{event_id}/safety-check/request").status_code, 401)

    def test_only_a_safety_officer_can_list_or_decide_and_only_a_coordinator_can_send(self):
        event_id = self.waiting_event()
        others = {"coordinator": self.coordinator, "organiser": self.organiser, "lead": self.lead, "venue": self.staff, "tech": self.tech}

        for name, client in others.items():
            with self.subTest(role=name):
                self.assertEqual(client.get("/safety-checks").status_code, 403)
                self.assertEqual(self.decide_check(event_id, "approved", client=client).status_code, 403)
        for name, client in {**others, "safety": self.hannah}.items():
            if name != "coordinator":
                with self.subTest(sends=name):
                    self.assertEqual(self.send(event_id, client).status_code, 403)
        self.assertEqual(self.status_of(event_id), "pending_safety_review")

    def test_a_safety_officer_can_sign_in_and_gets_the_safety_role(self):
        res = self.hannah.get("/auth/me")

        self.assertEqual((res.status_code, res.json()["role"]), (200, "safety"))

    def test_a_safety_officer_sees_only_events_in_the_safety_check_in_the_event_list_and_by_id(self):
        waiting = self.waiting_event("Waiting")
        only_approved = self.ready_event("Only approved")["event_id"]

        listed = {e["id"] for e in self.hannah.get("/events").json()}

        self.assertEqual(listed, {waiting})
        self.assertEqual(self.hannah.get(f"/events/{waiting}").status_code, 200)
        self.assertEqual(self.hannah.get(f"/events/{only_approved}").status_code, 403)


class TestAwaitingEvents(US44TestCase):
    def test_a_confirmed_event_is_not_listed_until_the_coordinator_sends_it(self):
        event_id = self.ready_event()["event_id"]
        self.assertEqual(self.checks(), {})

        sent = self.send(event_id)

        self.assertEqual((sent.status_code, sent.json()["status"]), (200, "pending_safety_review"))
        self.assertEqual(list(self.checks()), ["Career Fair"])
        self.assertEqual(self.status_of(event_id), "pending_safety_review")

    def test_every_safety_officer_sees_the_waiting_event_and_the_lead_still_oversees_it(self):
        event_id = self.waiting_event()

        self.assertEqual(self.checks(self.hannah).keys(), self.checks(self.ravi).keys())
        self.assertIn(event_id, {e["id"] for e in self.lead.get("/events").json()})

    def test_waiting_events_come_first_longest_waiting_first(self):
        first = self.ready_event("First")["event_id"]
        second = self.ready_event("Second")["event_id"]
        self.send(second)
        self.send(first)
        self.decide_check(second, "approved")
        third = self.waiting_event("Third")

        order = [c["name"] for c in self.hannah.get("/safety-checks").json()]

        self.assertEqual(order, ["First", "Third", "Second"])

    def test_sending_is_refused_until_venue_staff_have_approved_the_booking(self):
        hall = self.flat_venue("Hall")
        booking = self.requested("Career Fair", "10:00", "12:00", venue_id=hall)  # still pending

        refused = self.send(booking["event_id"])

        self.assertEqual((refused.status_code, refused.json()["detail"]),
                         (409, "Venue Staff have not yet approved every venue booking. The safety check starts once the venue and equipment are confirmed."))
        self.assertEqual(self.checks(), {})

    def test_sending_is_refused_for_an_event_with_no_venue(self):
        event_id = self.make_event("No venue")

        refused = self.send(event_id)

        self.assertEqual((refused.status_code, refused.json()["detail"].split(".")[0]), (409, "No venue is confirmed for this event yet"))

    def test_only_the_events_own_coordinator_can_send_it(self):
        event_id = self.ready_event()["event_id"]
        other = self.client(Role.coordinator, "marcus.lee@connectsphere.edu")

        self.assertEqual(self.send(event_id, other).status_code, 403)
        self.assertEqual(self.status_of(event_id), "approved")

    def test_sending_twice_is_refused(self):
        event_id = self.waiting_event()

        self.assertEqual(self.send(event_id).status_code, 409)

    def test_requested_equipment_must_be_reserved_by_technical_support_first(self):
        equipment.seed_catalogue(self.db)
        technician = self.tech.get("/auth/me").json()["id"]
        booking = self.ready_event()
        event_id = booking["event_id"]
        line = {"id": "E2", "qty": 1, "technicalRequirements": "Front of the room"}
        self.assertEqual(self.coordinator.put(f"/events/{event_id}/equipment", json={"techId": technician, "lines": [line]}).status_code, 200)

        refused = self.send(event_id)
        reserved = self.tech.patch(f"/events/{event_id}/equipment/E2", json={"status": "reserved"})
        sent = self.send(event_id)

        self.assertEqual((refused.status_code, refused.json()["detail"].split(" The ")[0]), (409, "Technical Support have not yet confirmed all the equipment."))
        self.assertEqual(reserved.status_code, 200, reserved.text)
        self.assertEqual((sent.status_code, sent.json()["status"]), (200, "pending_safety_review"))


class TestWhatIsReviewed(US44TestCase):
    def test_the_seven_areas_are_there_for_the_officer(self):
        self.waiting_event()

        areas = self.checks()["Career Fair"]["areas"]

        self.assertEqual([a["label"] for a in areas], [
            "Expected attendance", "Venue capacity and layout", "Emergency access", "Accessibility requirements",
            "Equipment placement", "Crowd movement", "Known venue restrictions"])
        self.assertEqual({a["key"] for a in areas if not a["recorded"]}, {"emergency_access", "crowd_movement"})

    def test_attendance_capacity_layout_and_restrictions_come_from_the_event_and_its_confirmed_venue(self):
        self.waiting_event()

        package = self.checks()["Career Fair"]
        areas = {a["key"]: a for a in package["areas"]}

        self.assertEqual(areas["attendance"]["details"], ["100 people are expected."])
        self.assertEqual(areas["capacity_layout"]["details"], ["Hall for Career Fair: capacity 250; booked for 100 people (40% of capacity) in a theatre layout."])
        self.assertEqual(areas["capacity_layout"]["concerns"], [])
        self.assertIn("open Monday, Tuesday, Wednesday, Thursday, Friday, 08:00 - 22:00", areas["venue_restrictions"]["details"][0])
        self.assertEqual((package["organiser"], package["coordinator"], package["date"]), ("organiser", "coordinator", str(DAY)))

    def test_a_venue_smaller_than_the_attendance_is_flagged(self):
        hall = self.flat_venue("Small hall", cap=60)
        booking = self.requested("Crowded", "10:00", "12:00", venue_id=hall, acknowledged=True)  # unsuitable: needs acknowledging
        self.assertEqual(self.decide(booking["id"], "approved").status_code, 200)
        self.send(booking["event_id"])

        concerns = {a["key"]: a["concerns"] for a in self.checks()["Crowded"]["areas"]}

        self.assertEqual(concerns["capacity_layout"], ["Small hall: 100 people is more than its capacity of 60."])


class TestDeciding(US44TestCase):
    def test_each_outcome_sets_its_status(self):
        for outcome, status in (("approved", "safety_approved"), ("changes_requested", "safety_changes_requested"), ("rejected", "safety_rejected")):
            with self.subTest(outcome=outcome):
                event_id = self.waiting_event(f"Event {outcome}")

                res = self.decide_check(event_id, outcome, "Because." if outcome != "approved" else "")

                self.assertEqual(res.status_code, 200, res.text)
                self.assertEqual((res.json()["status"], self.status_of(event_id)), (status, status))

    def test_a_comment_is_mandatory_to_reject_or_request_changes(self):
        event_id = self.waiting_event()
        for outcome in ("rejected", "changes_requested"):
            for comment in ("", "   "):
                with self.subTest(outcome=outcome, comment=repr(comment)):
                    res = self.decide_check(event_id, outcome, comment)
                    self.assertEqual((res.status_code, res.json()["detail"]), (422, "Comment is required."))
        self.assertEqual(self.status_of(event_id), "pending_safety_review")
        self.assertEqual(self.checks()["Career Fair"]["reviews"], [])

    def test_approving_needs_no_comment(self):
        event_id = self.waiting_event()

        self.assertEqual(self.decide_check(event_id, "approved").status_code, 200)

    def test_an_unknown_outcome_or_a_missing_one_is_refused_by_the_api(self):
        event_id = self.waiting_event()

        self.assertEqual(self.hannah.post(f"/events/{event_id}/safety-check", json={"outcome": "maybe"}).status_code, 422)
        self.assertEqual(self.hannah.post(f"/events/{event_id}/safety-check", json={}).status_code, 422)

    def test_an_event_decided_once_cannot_be_decided_again_by_anyone(self):
        event_id = self.waiting_event()
        self.decide_check(event_id, "rejected", "Unsafe.")

        for client in (self.hannah, self.ravi):
            again = self.decide_check(event_id, "approved", client=client)
            self.assertEqual(again.status_code, 409)
            self.assertIn("already been made", again.json()["detail"])
        self.assertEqual(self.status_of(event_id), "safety_rejected")

    def test_an_event_that_is_not_in_the_check_is_not_found_or_not_visible(self):
        approved = self.ready_event()["event_id"]

        self.assertEqual(self.decide_check(approved, "approved").status_code, 403)
        self.assertEqual(self.decide_check(99999, "approved").status_code, 404)

    def test_approving_is_refused_if_the_booking_was_cancelled_after_the_request_but_rejecting_still_works(self):
        booking = self.ready_event()
        event_id = booking["event_id"]
        self.send(event_id)
        self.assertEqual(self.coordinator.post(f"/bookings/{booking['id']}/cancel").status_code, 200)

        self.assertIn("No venue is confirmed", self.checks()["Career Fair"]["arrangementsIssue"])
        refused = self.decide_check(event_id, "approved")
        rejected = self.decide_check(event_id, "rejected", "There is no venue any more.")

        self.assertEqual(refused.status_code, 409)
        self.assertIn("Can't approve: No venue is confirmed for this event yet.", refused.json()["detail"])
        self.assertEqual((rejected.status_code, rejected.json()["status"]), (200, "safety_rejected"))


class TestRecorded(US44TestCase):
    def test_the_outcome_reviewer_time_and_comment_are_kept_and_shown_to_the_coordinator(self):
        event_id = self.waiting_event()

        self.decide_check(event_id, "changes_requested", "Widen the aisle.")

        review = self.coordinator.get(f"/events/{event_id}").json()["safetyReview"]
        self.assertEqual((review["outcome"], review["comment"], review["by"]), ("changes_requested", "Widen the aisle.", "hannah.lau"))
        self.assertRegex(review["at"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
        [kept] = self.checks()["Career Fair"]["reviews"]
        self.assertEqual((kept["outcome"], kept["reviewer"], kept["comment"]), ("changes_requested", "hannah.lau", "Widen the aisle."))
        self.assertIn("reviewedAt", kept)

    def test_the_status_history_shows_who_changed_it_when_and_why(self):
        event_id = self.waiting_event()
        self.decide_check(event_id, "rejected", "Exits are blocked.")

        history = self.coordinator.get(f"/events/{event_id}/history").json()

        self.assertEqual([(h["fromStatus"], h["toStatus"], h["changedBy"], h["reason"]) for h in history[-2:]], [
            ("approved", "pending_safety_review", "coordinator", None),
            ("pending_safety_review", "safety_rejected", "hannah.lau", "Exits are blocked.")])
        self.assertTrue(all(h["changedAt"] for h in history))

    def test_who_sees_the_outcome_on_the_event(self):
        event_id = self.waiting_event()
        self.decide_check(event_id, "approved", "All good.")

        sees = {name: "safetyReview" in client.get(f"/events/{event_id}").json() if client.get(f"/events/{event_id}").status_code == 200 else None
                for name, client in (("organiser", self.organiser), ("coordinator", self.coordinator), ("lead", self.lead),
                                     ("safety", self.hannah), ("venue", self.staff), ("tech", self.tech))}

        self.assertEqual(sees["organiser"], True)
        self.assertEqual(sees["coordinator"], True)
        self.assertEqual(sees["lead"], True)
        self.assertEqual(sees["safety"], True)
        self.assertEqual(sees["venue"], False)  # Venue Staff see the event (it has a venue) but not the safety outcome
        self.assertIsNone(sees["tech"])  # Technical Support are not involved in an event with no equipment

    def test_every_round_is_kept_and_the_latest_is_on_the_event(self):
        event_id = self.waiting_event()
        self.decide_check(event_id, "changes_requested", "Widen the aisle.")
        self.send(event_id)
        self.decide_check(event_id, "approved", "Fixed.", client=self.ravi)

        reviews = self.checks()["Career Fair"]["reviews"]
        latest = self.coordinator.get(f"/events/{event_id}").json()["safetyReview"]

        self.assertEqual([(r["outcome"], r["reviewer"]) for r in reviews], [("changes_requested", "hannah.lau"), ("approved", "ravi.menon")])
        self.assertEqual((latest["outcome"], latest["by"]), ("approved", "ravi.menon"))


class TestNotifications(US44TestCase):
    def test_every_safety_officer_is_told_when_an_event_is_ready_and_nobody_else(self):
        self.waiting_event()

        for officer in (self.hannah, self.ravi):
            self.assertEqual(self.notices(officer), [("Safety check needed", f"Career Fair on {DAY} is ready for its Operational Safety Check. Review it under Safety checks.")])
        for name, client in (("coordinator", self.coordinator), ("organiser", self.organiser), ("lead", self.lead), ("venue", self.staff)):
            self.assertNotIn("Safety check needed", [title for title, _ in self.notices(client)], name)

    def test_the_coordinator_is_told_the_outcome_with_the_comment(self):
        event_id = self.waiting_event()

        self.decide_check(event_id, "rejected", "Exits are blocked.")

        self.assertEqual(self.notices(self.coordinator)[-1], (
            "Safety check rejected",
            "Career Fair did not pass its Operational Safety Check. Revise the arrangements and resubmit. Comment: Exits are blocked."))

    def test_each_outcome_has_its_own_title_and_only_the_coordinator_gets_it(self):
        titles = {"approved": "Safety check approved", "changes_requested": "Safety changes requested", "rejected": "Safety check rejected"}
        for outcome, title in titles.items():
            with self.subTest(outcome=outcome):
                event_id = self.waiting_event(f"Event {outcome}")
                before = len(self.notices(self.coordinator))

                self.decide_check(event_id, outcome, "Because.")

                self.assertEqual([t for t, _ in self.notices(self.coordinator)[before:]], [title])
        for client in (self.organiser, self.lead, self.staff):
            self.assertFalse([t for t, _ in self.notices(client) if t in titles.values()])

    def test_no_notice_is_sent_when_a_decision_is_refused(self):
        event_id = self.waiting_event()
        before = self.notices(self.coordinator)

        self.decide_check(event_id, "rejected", "")

        self.assertEqual(self.notices(self.coordinator), before)


class TestRework(US44TestCase):
    def test_a_rejection_is_not_the_end_the_event_goes_back_to_the_check_and_can_pass(self):
        for outcome in ("rejected", "changes_requested"):
            with self.subTest(outcome=outcome):
                event_id = self.waiting_event(f"Rework {outcome}")
                self.decide_check(event_id, outcome, "Fix the exits.")
                self.assertIn(self.status_of(event_id), ("safety_rejected", "safety_changes_requested"))
                self.assertIn(event_id, {e["id"] for e in self.lead.get("/events").json()})

                resent = self.send(event_id)
                approved = self.decide_check(event_id, "approved", client=self.ravi)

                self.assertEqual((resent.status_code, resent.json()["status"]), (200, "pending_safety_review"))
                self.assertEqual((approved.status_code, approved.json()["status"]), (200, "safety_approved"))

    def test_a_safety_rejection_never_makes_the_event_rejected(self):
        event_id = self.waiting_event()

        self.decide_check(event_id, "rejected", "Unsafe.")

        history = [h["toStatus"] for h in self.coordinator.get(f"/events/{event_id}/history").json()]
        self.assertNotIn("rejected", history)
        self.assertEqual(self.send(event_id).status_code, 200)

    def test_the_resubmission_says_it_follows_rework(self):
        event_id = self.waiting_event()
        self.decide_check(event_id, "changes_requested", "Widen the aisle.")
        self.send(event_id)

        last = self.coordinator.get(f"/events/{event_id}/history").json()[-1]

        self.assertEqual((last["toStatus"], last["reason"]), ("pending_safety_review", "Resubmitted for safety review after rework."))

    def test_an_approved_event_cannot_be_sent_again(self):
        event_id = self.waiting_event()
        self.decide_check(event_id, "approved")

        refused = self.send(event_id)

        self.assertEqual(refused.status_code, 409)
        self.assertIn("approved event", refused.json()["detail"])


if __name__ == "__main__":
    unittest.main()

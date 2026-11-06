"""
Unit tests for US44 — Conduct Operational Safety Check.

"As a Safety Officer, I want to review the operational safety of a planned event so that it proceeds to
preparation only when its arrangements are safe."

AC1: the Safety Officer exists as a role in the access control matrix (US02) ............ TestSafetyOfficerRole
AC2: can view the events whose venue and technical arrangements are confirmed and that await a check
     TestRequestingTheCheck (when an event is ready), TestAwaitingEvents (who sees what)
AC3: can review expected attendance, venue capacity and layout, emergency access, accessibility, equipment
     placement, crowd movement and known venue restrictions ............................ TestWhatIsReviewed
AC4: can approve, reject or request changes, with a mandatory comment when rejecting or requesting changes
     TestDeciding
AC5: the outcome, reviewer and timestamp are recorded and the event status updated ...... TestRecordedOutcome
AC6: the Event Coordinator is notified of the outcome ................................... TestNotifications
AC7: a rejected safety arrangement returns the event to rework (US45), it does not end it . TestRejectionIsNotTheEnd
And the page agreeing with the backend ................................................. TestPageMatchesBackend

The rules (backend/safety/checks.py) run on a real in-memory SQLite database, never Supabase, reusing the US22
test setup. Boundaries are tested on both sides of the line. The integration tests check the same through the API.

Run from the repo root:
    python -m unittest discover -s tests/unit/safety -p "test_us44_*.py" -v
"""

import sys
import unittest
from datetime import date, time
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import HTTPException

from safety_testcase import NOW, S, SafetyTestCase
from test_us22_submit_booking_request import MON, REPO
import main
import models
import safety.checks as safety_check
import schemas
from event_requests.access import LIVE, involved_events, is_involved
from event_requests.fields import VISIBLE_FIELDS, for_role
from event_review.service import ReviewError
from event_requests.status import SAFETY_STATUSES, TRANSITIONS, can_change, label
from auth.models import Role
from auth.security import require_roles

HANNAH_ONLY = {Role.safety}


# ---------------------------------------------------------------- AC1: the role

class TestSafetyOfficerRole(SafetyTestCase):
    def test_the_safety_officer_is_a_role(self):
        self.assertEqual(Role("safety"), Role.safety)

    def test_only_a_safety_officer_may_use_the_safety_check_endpoints(self):
        for roles, allowed in ((main.SAFETY_REVIEWERS, HANNAH_ONLY), (main.SAFETY_REQUESTERS, {Role.coordinator})):
            dependency = require_roles(*roles)
            for role in Role:
                with self.subTest(roles=[r.value for r in roles], role=role.value):
                    user = SimpleNamespace(role=role)
                    if role in allowed:
                        self.assertIs(dependency(user=user), user)
                    else:
                        self.assertEqual(self.refusal(dependency, user=user).status_code, 403)

    def test_every_safety_check_endpoint_is_protected_by_a_role_check(self):
        for path, method in (("/safety-checks", "GET"), ("/events/{event_id}/safety-check", "POST"),
                             ("/events/{event_id}/safety-check/request", "POST")):
            with self.subTest(path=path):
                route = next(r for r in main.app.routes if getattr(r, "path", None) == path and method in r.methods)
                self.assertIn("require_roles.<locals>.dependency", [d.call.__qualname__ for d in route.dependant.dependencies])

    def test_the_four_new_statuses_are_named_as_us13_names_them(self):
        names = {S.pending_safety_review: "Pending Safety Review", S.safety_changes_requested: "Safety Changes Requested",
                 S.safety_approved: "Safety Approved", S.safety_rejected: "Safety Rejected"}
        self.assertEqual({status: label(status) for status in names}, names)
        self.assertEqual(set(SAFETY_STATUSES), set(names))


# ---------------------------------------------------------------- AC2: an event is ready, and who sees it

class TestRequestingTheCheck(SafetyTestCase):
    def test_arrangements_are_confirmed_when_every_booking_is_approved_and_any_equipment_is_reserved(self):
        cases = (
            ("approved", [], None, None),
            ("approved", [{"id": "E2"}], "reserved", None),
            ("pending", [], None, "Venue Staff have not yet approved every venue booking."),
            (None, [], None, "No venue is confirmed for this event yet."),
            ("rejected", [], None, "No venue is confirmed for this event yet."),
            ("approved", [{"id": "E2"}], "requested", "Technical Support have not yet confirmed all the equipment."),
            ("approved", [{"id": "E2"}], None, "Technical Support have not yet confirmed all the equipment."),
        )
        for booking_state, equipment, equipment_state, issue in cases:
            with self.subTest(booking=booking_state, equipment=bool(equipment), equipment_state=equipment_state):
                event = SimpleNamespace(booking_state=booking_state, equipment=equipment, equipment_state=equipment_state)
                self.assertEqual(safety_check.arrangements_issue(event), issue)

    def test_the_assigned_coordinator_sends_a_ready_event_to_the_check(self):
        event = self.ready_event()

        sent = self.send_to_check(event, self.priya)

        self.assertEqual(sent.status, "pending_safety_review")
        self.assertEqual(self.stored(event).status, S.pending_safety_review)
        [(before, after, by, reason)] = self.history(event)
        self.assertEqual((before, after, by, reason), (S.approved, S.pending_safety_review, self.priya.id, None))

    def test_nobody_else_can_send_it(self):
        event = self.ready_event()
        for user in (self.marcus, self.maya, self.hannah, self.grace, self.daniel):
            with self.subTest(user=user.name):
                self.assertEqual(self.refusal(self.send_to_check, event, user).status_code, 403)
        self.assertEqual(self.stored(event).status, S.approved)

    def test_an_event_that_is_not_approved_cannot_be_sent(self):
        for status in (S.submitted, S.under_review, S.pending_clarification, S.rejected, S.cancelled, S.confirmed, S.safety_approved):
            with self.subTest(status=status.value):
                event = self.ready_event(f"Event {status.value}", status=status)
                refused = self.refusal(self.send_to_check, event, self.priya)
                self.assertEqual(refused.status_code, 409)
                self.assertEqual(refused.detail, "A safety check can only be requested for an approved event "
                                                 f"(this event is {label(status).lower()}).")

    def test_the_rule_itself_refuses_a_coordinator_who_is_not_assigned_even_if_the_endpoint_had_let_them_through(self):
        event = self.ready_event()

        with self.assertRaises(ReviewError) as refused:
            safety_check.request_check(self.db, event, self.marcus, NOW)

        self.assertEqual((refused.exception.status_code, refused.exception.message), (403, "Only the assigned coordinator can request a safety check."))

    def test_a_draft_is_not_the_coordinators_to_see_so_it_cannot_be_sent(self):
        event = self.ready_event("Draft", status=S.draft)

        self.assertEqual(self.refusal(self.send_to_check, event, self.priya).status_code, 403)

    def test_an_event_already_waiting_cannot_be_sent_again(self):
        event = self.waiting_event()

        refused = self.refusal(self.send_to_check, event, self.priya)

        self.assertEqual((refused.status_code, refused.detail), (409, "This event is already waiting for its safety check."))

    def test_it_is_refused_until_the_venue_and_equipment_are_confirmed_and_says_what_is_missing(self):
        no_venue = self.event(name="No venue", organiser_id=self.maya.id, coordinator_id=self.priya.id)
        pending = self.ready_event("Pending venue")
        self.db.query(models.VenueBooking).filter_by(event_id=pending.id).update({"status": "pending"})
        venue_bookings_summary = pending
        main.venue_bookings.summarise(self.db, venue_bookings_summary)
        self.db.commit()
        equipment = self.ready_event("Equipment", equipment=[{"id": "E2", "qty": 1, "technicalRequirements": "Front"}], equipment_state="requested")
        for event, issue in ((no_venue, "No venue is confirmed for this event yet."),
                             (pending, "Venue Staff have not yet approved every venue booking."),
                             (equipment, "Technical Support have not yet confirmed all the equipment.")):
            with self.subTest(event=event.name):
                refused = self.refusal(self.send_to_check, event, self.priya)
                self.assertEqual((refused.status_code, refused.detail),
                                 (409, f"{issue} The safety check starts once the venue and equipment are confirmed."))
                self.assertEqual(self.stored(event).status, S.approved)

    def test_reserved_equipment_is_enough(self):
        event = self.ready_event(equipment=[{"id": "E2", "qty": 1, "technicalRequirements": "Front"}], equipment_state="reserved")

        self.assertEqual(self.send_to_check(event, self.priya).status, "pending_safety_review")

    def test_an_event_sent_back_after_rework_says_so_in_its_history(self):
        event = self.waiting_event()
        self.decide_check(event, "changes_requested", "Widen the aisle.")

        self.send_to_check(event, self.priya)

        self.assertEqual(self.history(event)[-1][1:], (S.pending_safety_review, self.priya.id, "Resubmitted for safety review after rework."))


class TestAwaitingEvents(SafetyTestCase):
    def names(self, user):
        return [e.name for e in involved_events(self.db.query(models.Event), user).order_by(models.Event.id)]

    def test_a_safety_officer_sees_exactly_the_events_in_the_four_safety_statuses(self):
        for status in S:
            self.event(name=f"Event {status.value}", status=status, organiser_id=self.maya.id, coordinator_id=self.priya.id)

        listed = self.names(self.hannah)

        self.assertEqual(listed, [f"Event {status.value}" for status in S if status in SAFETY_STATUSES])
        for event in self.db.query(models.Event):
            with self.subTest(status=event.status.value):
                self.assertIs(is_involved(event, self.hannah), event.status in SAFETY_STATUSES)

    def test_an_approved_event_is_not_theirs_to_see_until_it_is_sent(self):
        event = self.ready_event()

        self.assertEqual(self.names(self.hannah), [])
        self.send_to_check(event, self.priya)
        self.assertEqual(self.names(self.hannah), ["Career Fair"])

    def test_every_safety_officer_sees_every_waiting_event(self):
        self.waiting_event()

        self.assertEqual(self.names(self.hannah), self.names(self.ravi))

    def test_the_lead_still_oversees_events_in_the_safety_check(self):
        self.assertTrue(set(SAFETY_STATUSES) <= set(LIVE))
        self.waiting_event()

        self.assertEqual(self.names(self.grace), ["Career Fair"])

    def test_the_list_has_waiting_events_first_longest_waiting_first_then_decided_ones(self):
        first = self.ready_event("First request")
        second = self.ready_event("Second request")
        decided = self.ready_event("Already decided")
        safety_check.request_check(self.db, second, self.priya, NOW.replace(hour=11))
        safety_check.request_check(self.db, first, self.priya, NOW.replace(hour=10))
        safety_check.request_check(self.db, decided, self.priya, NOW.replace(hour=9))
        safety_check.decide(self.db, decided, self.hannah, "approved", "", NOW.replace(hour=12))
        self.db.commit()

        listed = main.list_safety_checks(db=self.db, user=self.hannah)

        self.assertEqual([p["name"] for p in listed], ["First request", "Second request", "Already decided"])
        self.assertEqual([p["requestedAt"] for p in listed[:2]], [NOW.replace(hour=10), NOW.replace(hour=11)])

    def test_the_list_is_empty_when_nothing_is_waiting_or_decided(self):
        self.ready_event()

        self.assertEqual(main.list_safety_checks(db=self.db, user=self.hannah), [])
        self.assertEqual(safety_check.packages(self.db, []), [])

    def test_each_listed_event_says_who_runs_it_and_when(self):
        event = self.waiting_event()

        [package] = main.list_safety_checks(db=self.db, user=self.hannah)

        self.assertEqual((package["eventId"], package["name"], package["status"], package["date"], package["start"], package["end"]),
                         (event.id, "Career Fair", "pending_safety_review", MON, time(10, 0), time(12, 0)))
        self.assertEqual((package["organiser"], package["coordinator"]), ("Maya Rahman", "Priya Tan"))
        self.assertIsNone(package["arrangementsIssue"])
        self.assertEqual(package["reviews"], [])

    def test_an_event_whose_arrangements_stopped_being_confirmed_says_so(self):
        event = self.waiting_event()
        self.db.query(models.VenueBooking).filter_by(event_id=event.id).update({"status": "cancelled"})
        main.venue_bookings.summarise(self.db, event)
        self.db.commit()

        [package] = main.list_safety_checks(db=self.db, user=self.hannah)

        self.assertEqual(package["arrangementsIssue"], "No venue is confirmed for this event yet.")


# ---------------------------------------------------------------- AC3: what is reviewed

def venue_facts(**overrides) -> dict:
    facts = {"name": "Hall A", "capacity": 100, "layouts": ["theatre", "classroom"], "accessibility": ["Wheelchair Access"],
             "layout": "theatre", "attendance": 80, "operating_hours": "08:00 - 22:00", "operating_days": ["Monday", "Tuesday"],
             "setup_minutes": 30, "turnaround_minutes": 15, "restrictions": []}
    facts.update(overrides)
    return facts


def area_of(areas, key) -> dict:
    return next(a for a in areas if a["key"] == key)


class TestWhatIsReviewed(SafetyTestCase):
    def test_there_are_seven_areas_in_the_order_the_story_lists_them(self):
        areas = safety_check.build_areas(80, [], [venue_facts()], [])

        self.assertEqual([(a["key"], a["label"]) for a in areas], [
            ("attendance", "Expected attendance"), ("capacity_layout", "Venue capacity and layout"),
            ("emergency_access", "Emergency access"), ("accessibility", "Accessibility requirements"),
            ("equipment_placement", "Equipment placement"), ("crowd_movement", "Crowd movement"),
            ("venue_restrictions", "Known venue restrictions")])

    def test_expected_attendance_is_shown_or_flagged_when_missing(self):
        self.assertEqual(safety_check.attendance_area(80)["details"], ["80 people are expected."])
        for missing in (None, 0):
            with self.subTest(attendance=missing):
                area = safety_check.attendance_area(missing)
                self.assertEqual((area["details"], area["concerns"]), ([], ["No expected attendance is recorded."]))

    def test_capacity_is_flagged_only_when_the_attendance_is_over_it(self):
        for attendance, over in ((99, False), (100, False), (101, True)):
            with self.subTest(attendance=attendance):
                area = safety_check.capacity_layout_area([venue_facts(attendance=attendance)])
                self.assertEqual(area["concerns"], [f"Hall A: {attendance} people is more than its capacity of 100."] if over else [])

    def test_the_share_of_capacity_is_worked_out_and_a_zero_capacity_does_not_break_it(self):
        area = safety_check.capacity_layout_area([venue_facts(attendance=80), venue_facts(name="Hall B", capacity=0, attendance=5)])

        self.assertEqual(area["details"][0], "Hall A: capacity 100; booked for 80 people (80% of capacity) in a theatre layout.")
        self.assertEqual(area["details"][1], "Hall B: capacity 0; booked for 5 people (0% of capacity) in a theatre layout.")

    def test_a_layout_the_venue_does_not_list_is_flagged_with_what_it_offers(self):
        area = safety_check.capacity_layout_area([venue_facts(layout="banquet"), venue_facts(name="Hall B", layout="banquet", layouts=[])])

        self.assertEqual(area["concerns"], ["Hall A does not list the banquet layout (it offers: theatre, classroom).",
                                            "Hall B does not list the banquet layout (it offers: none recorded)."])

    def test_with_no_confirmed_venue_there_is_nothing_to_review_and_that_is_flagged(self):
        areas = safety_check.build_areas(80, [], [], [])

        self.assertEqual(area_of(areas, "capacity_layout")["concerns"], ["No confirmed venue booking to review."])
        self.assertEqual(area_of(areas, "venue_restrictions")["details"], ["No confirmed venue booking to review."])
        self.assertIn("0 venues", area_of(areas, "crowd_movement")["details"][0])

    def test_emergency_access_and_crowd_movement_say_the_system_does_not_record_them(self):
        areas = safety_check.build_areas(80, [], [venue_facts(), venue_facts(name="Hall B", layout="classroom")], [])

        self.assertEqual((area_of(areas, "emergency_access")["recorded"], area_of(areas, "crowd_movement")["recorded"]), (False, False))
        self.assertIn("not recorded", area_of(areas, "emergency_access")["details"][0])
        self.assertEqual(area_of(areas, "crowd_movement")["details"],
                         ["Crowd flow is not recorded in the system. Layout: classroom, theatre; 80 people across 2 venues."])
        self.assertTrue(all(area["recorded"] for area in areas if area["key"] not in ("emergency_access", "crowd_movement")))

    def test_crowd_movement_counts_a_single_venue_and_an_unknown_attendance(self):
        area = safety_check.crowd_movement_area(None, [venue_facts()])

        self.assertEqual(area["details"], ["Crowd flow is not recorded in the system. Layout: theatre; unknown people across 1 venue."])

    def test_an_accessibility_need_the_venue_does_not_offer_is_flagged_whatever_its_case(self):
        area = safety_check.accessibility_area(["wheelchair access", "Special Physical Seating"], [venue_facts()])

        self.assertEqual(area["details"], ["Needed: wheelchair access, Special Physical Seating.", "Hall A offers: Wheelchair Access."])
        self.assertEqual(area["concerns"], ["Hall A does not offer: Special Physical Seating."])

    def test_no_needs_means_nothing_to_flag_and_a_venue_with_no_features_is_described_as_such(self):
        area = safety_check.accessibility_area([], [venue_facts(accessibility=[])])

        self.assertEqual(area["details"], ["No accessibility needs are recorded for this event.", "Hall A offers: none recorded."])
        self.assertEqual(area["concerns"], [])

    def test_equipment_is_listed_with_its_status_and_technical_requirements(self):
        lines = [{"id": "E2", "qty": 2, "technicalRequirements": "Front of the room", "status": "reserved"},
                 {"id": "E3", "qty": 1, "technicalRequirements": "  "}, {"id": "E9", "qty": 1, "technicalRequirements": "x"}]

        area = safety_check.equipment_area(lines)

        self.assertEqual(area["details"][:3], ["2 × Projector (reserved): Front of the room",
                                               "1 × PA system (pending): no technical requirements recorded",
                                               "1 × E9 (pending): x"])
        self.assertEqual(area["concerns"], ["PA system: nothing is recorded about where or how it is set up."])
        self.assertEqual(area["details"][-1], "Where each item goes is only described by its technical requirements.")

    def test_an_event_without_equipment_says_so(self):
        self.assertEqual(safety_check.equipment_area([])["details"], ["No equipment is requested for this event."])

    def test_known_restrictions_list_the_opening_times_buffers_and_what_the_venue_rules_flag(self):
        area = safety_check.restrictions_area([venue_facts(restrictions=["Hall A is closed on Saturdays."]),
                                               venue_facts(name="Hall B", operating_hours=None, operating_days=[])])

        self.assertEqual(area["details"], [
            "Hall A: open Monday, Tuesday, 08:00 - 22:00; 30 min setup before and 15 min turnaround after the event.",
            "Hall B: open days not recorded, hours not recorded; 30 min setup before and 15 min turnaround after the event."])
        self.assertEqual(area["concerns"], ["Hall A is closed on Saturdays."])

    def test_the_venue_rules_flag_a_closed_day_opening_hours_and_an_unavailable_period(self):
        cases = (
            (dict(operatingDays=["Tuesday"]), "Lecture Theatre 1 is closed on Mondays."),
            (dict(operatingHours="13:00 - 22:00"), "10:00–12:00 is outside Lecture Theatre 1's operating hours (13:00 - 22:00)."),
            (dict(unavailability=[{"start": "2027-01-04T09:00", "end": "2027-01-04T10:00", "reason": "maintenance"}]),
             "Lecture Theatre 1 is unavailable (Maintenance) from 04 Jan 2027, 09:00 to 04 Jan 2027, 10:00."),
        )
        for venue_fields, concern in cases:
            with self.subTest(concern=concern):
                event = self.ready_event(f"Case {concern[:12]}", venue=self.venue(**venue_fields))
                [package] = safety_check.packages(self.db, [event])
                self.assertIn(concern, area_of(package["areas"], "venue_restrictions")["concerns"])

    def test_a_confirmed_booking_is_described_with_its_own_venue_attendance_and_layout(self):
        venue = self.venue(name="Hall A", cap=100, accessibility=["Wheelchair Access"])
        event = self.event(name="Gala", organiser_id=self.maya.id, coordinator_id=self.priya.id, expected_attendance=120,
                           accessibility=["Wheelchair Access", "Special Physical Seating"],
                           equipment=[{"id": "E2", "qty": 1, "technicalRequirements": "Front", "status": "reserved"}], equipment_state="reserved")
        self.book(event, venue, attendance=90, layout="theatre")

        [package] = safety_check.packages(self.db, [event])

        areas = package["areas"]
        self.assertEqual(area_of(areas, "attendance")["details"], ["120 people are expected."])
        self.assertEqual(area_of(areas, "capacity_layout")["details"], ["Hall A: capacity 100; booked for 90 people (90% of capacity) in a theatre layout."])
        self.assertEqual(area_of(areas, "accessibility")["concerns"], ["Hall A does not offer: Special Physical Seating."])
        self.assertEqual(area_of(areas, "equipment_placement")["details"][0], "1 × Projector (reserved): Front")

    def test_only_approved_bookings_are_reviewed_and_an_event_can_have_several(self):
        event = self.ready_event("Gala", venue=self.venue(name="Hall A"))
        self.book(event, self.venue(name="Hall B"))
        self.book(event, self.venue(name="Hall C"), status="pending")
        self.book(event, self.venue(name="Hall D"), status="cancelled")

        [package] = safety_check.packages(self.db, [event])

        names = [line.split(":")[0] for line in area_of(package["areas"], "capacity_layout")["details"]]
        self.assertEqual(names, ["Hall A", "Hall B"])


# ---------------------------------------------------------------- AC4: deciding

class TestDeciding(SafetyTestCase):
    def test_each_outcome_moves_the_event_to_its_status(self):
        for outcome, status in (("approved", S.safety_approved), ("changes_requested", S.safety_changes_requested), ("rejected", S.safety_rejected)):
            with self.subTest(outcome=outcome):
                event = self.waiting_event(f"Event {outcome}")

                self.decide_check(event, outcome, "Because." if outcome != "approved" else "")

                self.assertEqual(self.stored(event).status, status)

    def test_a_comment_is_mandatory_to_reject_or_request_changes_and_nothing_is_saved_without_it(self):
        for outcome in ("rejected", "changes_requested"):
            for comment in ("", "   ", "\n\t"):
                with self.subTest(outcome=outcome, comment=repr(comment)):
                    event = self.waiting_event(f"Event {outcome} {len(comment)}")

                    refused = self.refusal(self.decide_check, event, outcome, comment)

                    self.assertEqual((refused.status_code, refused.detail), (422, "Comment is required."))
                    self.assertEqual(self.stored(event).status, S.pending_safety_review)
                    self.assertEqual(self.db.query(models.SafetyReview).filter_by(event_id=event.id).count(), 0)
                    self.assertEqual(self.notices(self.priya), [])

    def test_a_comment_is_optional_when_approving(self):
        for comment in ("", "Looks fine.", "  Looks fine.  "):
            with self.subTest(comment=comment):
                event = self.waiting_event(f"Approved {len(comment)}")

                self.decide_check(event, "approved", comment)

                review = self.db.query(models.SafetyReview).filter_by(event_id=event.id).one()
                self.assertEqual(review.comment, comment.strip() or None)

    def test_a_comment_may_be_1000_characters_but_not_1001(self):
        for length, accepted in ((1000, True), (1001, False)):
            with self.subTest(length=length):
                event = self.waiting_event(f"Long {length}")
                if accepted:
                    self.decide_check(event, "rejected", "x" * length)
                    self.assertEqual(self.stored(event).status, S.safety_rejected)
                else:
                    refused = self.refusal(self.decide_check, event, "rejected", "x" * length)
                    self.assertEqual((refused.status_code, refused.detail), (422, "Comment must be 1000 characters or fewer."))
                    self.assertEqual(self.stored(event).status, S.pending_safety_review)

    def test_an_over_long_comment_is_refused_when_approving_too(self):
        event = self.waiting_event()

        self.assertEqual(self.refusal(self.decide_check, event, "approved", "x" * 1001).status_code, 422)

    def test_only_a_safety_officer_can_decide(self):
        event = self.waiting_event()
        # Those who can see the event are told why; the others cannot see it at all.
        for user, detail in ((self.priya, "Only a Safety Officer can conduct a safety check."), (self.maya, "Only a Safety Officer can conduct a safety check."),
                             (self.grace, "Only a Safety Officer can conduct a safety check."), (self.daniel, "Only a Safety Officer can conduct a safety check."),
                             (self.marcus, "You don't have permission to do that"), (self.wei, "You don't have permission to do that")):
            with self.subTest(user=user.name):
                refused = self.refusal(self.decide_check, event, "approved", user=user)
                self.assertEqual((refused.status_code, refused.detail), (403, detail))
        self.assertEqual(self.stored(event).status, S.pending_safety_review)
        self.assertEqual(self.db.query(models.SafetyReview).count(), 0)

    def test_an_unknown_outcome_is_refused(self):
        event = self.waiting_event()

        with self.assertRaises(ReviewError) as refused:
            safety_check.decide(self.db, event, self.hannah, "maybe", "", NOW)

        self.assertEqual((refused.exception.status_code, refused.exception.message), (422, "Choose approve, request changes or reject."))
        with self.assertRaises(Exception):
            schemas.SafetyDecisionIn(outcome="maybe")

    def test_only_an_event_waiting_for_a_check_can_be_decided(self):
        for status in S:
            if status == S.pending_safety_review:
                continue
            with self.subTest(status=status.value):
                event = self.ready_event(f"Event {status.value}", status=status)
                if status in SAFETY_STATUSES:
                    detail = f"A safety decision has already been made on this event (it is {label(status)})."
                else:
                    detail = f"This event is not waiting for a safety check (it is {label(status)})."
                with self.assertRaises(ReviewError) as refused:
                    safety_check.decide(self.db, event, self.hannah, "approved", "", NOW)
                self.assertEqual((refused.exception.status_code, refused.exception.message), (409, detail))

    def test_a_second_officer_cannot_decide_an_event_the_first_has_decided(self):
        event = self.waiting_event()
        self.decide_check(event, "rejected", "Not safe.")

        refused = self.refusal(self.decide_check, event, "approved", user=self.ravi)

        self.assertEqual(refused.status_code, 409)
        self.assertEqual(self.stored(event).status, S.safety_rejected)
        self.assertEqual(self.db.query(models.SafetyReview).filter_by(event_id=event.id).count(), 1)

    def test_approving_is_refused_when_the_arrangements_stopped_being_confirmed_since_the_request(self):
        for change, issue in ((dict(booking_state="pending"), "Venue Staff have not yet approved every venue booking."),
                              (dict(booking_state=None), "No venue is confirmed for this event yet."),
                              (dict(equipment=[{"id": "E2", "qty": 1}], equipment_state="requested"),
                               "Technical Support have not yet confirmed all the equipment.")):
            with self.subTest(issue=issue):
                event = self.waiting_event(f"Changed {issue[:10]}")
                for field, value in change.items():
                    setattr(event, field, value)
                self.db.commit()

                refused = self.refusal(self.decide_check, event, "approved")

                self.assertEqual((refused.status_code, refused.detail),
                                 (409, f"Can't approve: {issue} The arrangements changed after the safety check was requested."))
                self.assertEqual(self.stored(event).status, S.pending_safety_review)

    def test_changes_can_still_be_requested_or_the_event_rejected_when_the_arrangements_changed(self):
        for outcome in ("changes_requested", "rejected"):
            with self.subTest(outcome=outcome):
                event = self.waiting_event(f"Unconfirmed {outcome}")
                event.booking_state = "pending"
                self.db.commit()

                self.decide_check(event, outcome, "The venue is not confirmed any more.")

                self.assertEqual(self.stored(event).status, OUTCOME_STATUS[outcome])

    def test_deciding_returns_the_event_as_the_officer_reviews_it_with_its_history(self):
        event = self.waiting_event()

        package = self.decide_check(event, "changes_requested", "Widen the aisle.")

        self.assertEqual((package["eventId"], package["status"]), (event.id, "safety_changes_requested"))
        self.assertEqual([(r["outcome"], r["comment"], r["reviewer"]) for r in package["reviews"]],
                         [("changes_requested", "Widen the aisle.", "Hannah Lau")])


OUTCOME_STATUS = {"approved": S.safety_approved, "changes_requested": S.safety_changes_requested, "rejected": S.safety_rejected}


# ---------------------------------------------------------------- AC5: recorded

class TestRecordedOutcome(SafetyTestCase):
    def test_the_outcome_reviewer_time_and_comment_are_saved(self):
        event = self.waiting_event()

        safety_check.decide(self.db, event, self.hannah, "rejected", "  Exits are blocked.  ", NOW)
        self.db.commit()

        review = self.db.query(models.SafetyReview).filter_by(event_id=event.id).one()
        self.assertEqual((review.outcome, review.comment, review.reviewer_id), ("rejected", "Exits are blocked.", self.hannah.id))
        self.assertEqual(review.reviewed_at.replace(tzinfo=None), NOW.replace(tzinfo=None))

    def test_the_status_change_is_in_the_history_with_who_made_it_and_why(self):
        event = self.waiting_event()
        self.decide_check(event, "rejected", "Exits are blocked.")

        self.assertEqual(self.history(event)[-1], (S.pending_safety_review, S.safety_rejected, self.hannah.id, "Exits are blocked."))

    def test_an_approval_without_a_comment_has_no_reason(self):
        event = self.waiting_event()
        self.decide_check(event, "approved")

        self.assertEqual(self.history(event)[-1], (S.pending_safety_review, S.safety_approved, self.hannah.id, None))

    def test_the_latest_outcome_is_on_the_event_and_every_round_is_kept(self):
        event = self.waiting_event()
        self.decide_check(event, "changes_requested", "Widen the aisle.")
        self.send_to_check(event, self.priya)
        self.decide_check(event, "approved", "Fixed.", user=self.ravi)

        latest = safety_check.latest_review(self.db, self.stored(event))
        [package] = safety_check.packages(self.db, [self.stored(event)])

        self.assertEqual((latest["outcome"], latest["comment"], latest["by"]), ("approved", "Fixed.", "Ravi Menon"))
        self.assertRegex(latest["at"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
        self.assertEqual([(r["outcome"], r["reviewer"]) for r in package["reviews"]],
                         [("changes_requested", "Hannah Lau"), ("approved", "Ravi Menon")])

    def test_an_event_nobody_has_reviewed_has_no_outcome(self):
        self.assertIsNone(safety_check.latest_review(self.db, self.waiting_event()))

    def test_a_reviewer_who_no_longer_exists_is_shown_without_a_name(self):
        event = self.waiting_event()
        self.decide_check(event, "approved")
        self.db.delete(self.hannah)
        self.db.commit()

        self.assertEqual(safety_check.latest_review(self.db, self.stored(event))["by"], "")

    def test_only_the_roles_who_need_the_outcome_receive_it_with_the_event(self):
        event = self.waiting_event()
        self.decide_check(event, "rejected", "Not safe.")
        full = main.event_response(self.db, self.stored(event)).model_dump()

        for role, sees in ((Role.organiser, True), (Role.coordinator, True), (Role.lead, True), (Role.safety, True),
                           (Role.venue, False), (Role.tech, False), (Role.attendee, False)):
            with self.subTest(role=role.value):
                shown = for_role(full, SimpleNamespace(role=role))
                self.assertIs("safetyReview" in shown, sees)
                self.assertIs("safetyReview" in VISIBLE_FIELDS[role], sees)
        self.assertEqual(full["safetyReview"]["comment"], "Not safe.")

    def test_the_transitions_around_the_safety_check_are_exactly_these(self):
        expected = {
            S.approved: {S.pending_safety_review, S.confirmed, S.cancelled},
            S.pending_safety_review: {S.safety_approved, S.safety_changes_requested, S.safety_rejected, S.cancelled},
            S.safety_changes_requested: {S.pending_safety_review, S.cancelled},
            S.safety_rejected: {S.pending_safety_review, S.cancelled},
            S.safety_approved: {S.confirmed, S.cancelled},
        }
        for status, allowed in expected.items():
            self.assertEqual(TRANSITIONS[status], allowed, status.value)
        for current in S:
            for new in S:
                if current != new:
                    with self.subTest(current=current.value, new=new.value):
                        self.assertIs(can_change(current, new), new in TRANSITIONS[current])


# ---------------------------------------------------------------- AC6: notifications

class TestNotifications(SafetyTestCase):
    def test_every_active_safety_officer_is_told_when_an_event_is_ready_and_nobody_else(self):
        inactive = self.user("Old Officer", Role.safety, active=False)
        event = self.ready_event()

        self.send_to_check(event, self.priya)

        expected = ("Safety check needed", "Career Fair on 2027-01-04 is ready for its Operational Safety Check. Review it under Safety checks.")
        self.assertEqual(self.notices(self.hannah), [expected])
        self.assertEqual(self.notices(self.ravi), [expected])
        for user in (inactive, self.priya, self.marcus, self.maya, self.grace, self.daniel, self.wei):
            self.assertEqual(self.notices(user), [], user.name)

    def test_nothing_is_sent_when_the_request_is_refused(self):
        event = self.event(name="No venue", organiser_id=self.maya.id, coordinator_id=self.priya.id)

        self.refusal(self.send_to_check, event, self.priya)

        self.assertEqual(self.notices(self.hannah), [])

    def test_the_coordinator_is_told_each_outcome_with_the_comment(self):
        cases = (
            ("approved", "Looks fine.", "Safety check approved", "Career Fair passed its Operational Safety Check. You can now confirm it. Comment: Looks fine."),
            ("changes_requested", "Widen the aisle.", "Safety changes requested",
             "Career Fair needs changes before it passes its Operational Safety Check. Comment: Widen the aisle."),
            ("rejected", "Exits blocked.", "Safety check rejected",
             "Career Fair did not pass its Operational Safety Check. Revise the arrangements and resubmit. Comment: Exits blocked."),
        )
        for outcome, comment, title, body in cases:
            with self.subTest(outcome=outcome):
                event = self.waiting_event("Career Fair" if outcome == "approved" else f"Career Fair {outcome}")
                before = len(self.notices(self.priya))
                self.decide_check(event, outcome, comment)
                [(got_title, got_body)] = self.notices(self.priya)[before:]
                self.assertEqual(got_title, title)
                self.assertEqual(got_body, body.replace("Career Fair", event.name, 1))

    def test_an_approval_without_a_comment_has_no_comment_in_the_notice(self):
        event = self.waiting_event()

        self.decide_check(event, "approved")

        self.assertEqual(self.notices(self.priya), [("Safety check approved", "Career Fair passed its Operational Safety Check. You can now confirm it.")])

    def test_only_the_events_coordinator_is_told_the_outcome(self):
        event = self.waiting_event()

        self.decide_check(event, "approved", "Fine.")

        for user in (self.marcus, self.maya, self.hannah, self.ravi, self.grace, self.daniel, self.wei):
            self.assertEqual([n for n in self.notices(user) if "Operational Safety Check. You" in n[1]], [], user.name)

    def test_nothing_is_sent_when_the_decision_is_refused(self):
        event = self.waiting_event()

        self.refusal(self.decide_check, event, "rejected", "")

        self.assertEqual(self.notices(self.priya), [])


# ---------------------------------------------------------------- AC7: rework, not the end

class TestRejectionIsNotTheEnd(SafetyTestCase):
    def test_a_safety_rejection_is_not_the_rejection_that_ends_an_event(self):
        self.assertNotEqual(S.safety_rejected, S.rejected)
        self.assertEqual(TRANSITIONS[S.rejected], set())
        self.assertEqual(TRANSITIONS[S.safety_rejected], {S.pending_safety_review, S.cancelled})
        self.assertEqual(TRANSITIONS[S.safety_changes_requested], {S.pending_safety_review, S.cancelled})

    def test_the_rejected_event_stays_open_to_its_coordinator_and_the_lead(self):
        event = self.waiting_event()
        self.decide_check(event, "rejected", "Exits are blocked.")

        stored = self.stored(event)

        self.assertTrue(is_involved(stored, self.priya))
        self.assertTrue(is_involved(stored, self.grace))
        self.assertIn(stored.status, LIVE)
        self.assertEqual(stored.coordinator_id, self.priya.id)

    def test_after_rework_the_event_goes_back_to_the_check_and_can_then_pass(self):
        for outcome in ("rejected", "changes_requested"):
            with self.subTest(outcome=outcome):
                event = self.waiting_event(f"Rework {outcome}")
                self.decide_check(event, outcome, "Fix the exits.")

                self.assertEqual(self.send_to_check(event, self.priya).status, "pending_safety_review")
                self.decide_check(event, "approved", user=self.ravi)

                self.assertEqual(self.stored(event).status, S.safety_approved)
                self.assertEqual([r.outcome for r in self.db.query(models.SafetyReview).filter_by(event_id=event.id).order_by(models.SafetyReview.id)],
                                 [outcome, "approved"])

    def test_an_event_in_rework_can_still_be_cancelled(self):
        event = self.waiting_event()
        self.decide_check(event, "rejected", "Unsafe.")

        main.change_status(self.db, self.stored(event), S.cancelled, self.priya, NOW)
        self.db.commit()

        self.assertEqual(self.stored(event).status, S.cancelled)


# ---------------------------------------------------------------- the page and the backend agree

class TestPageMatchesBackend(unittest.TestCase):
    """Reads the frontend source, since a Python test cannot click through a browser. These guard against the
    page and the backend drifting apart; they are not a full UI test."""

    def source(self, relative) -> str:
        return (REPO / relative).read_text(encoding="utf-8")

    def interface(self, name) -> str:
        types = self.source("lib/types.ts")
        start = types.index(f"export interface {name}")
        return types[start:types.index("\n}", start)]

    def test_the_role_and_every_status_are_known_to_the_page(self):
        types = self.source("lib/types.ts")
        self.assertIn('"safety"', types[types.index("export type Role"):types.index("export type EventStatus")])
        for status in models.EventStatus:
            with self.subTest(status=status.value):
                self.assertIn(f'"{status.value}"', types[types.index("export type EventStatus"):types.index("export type SafetyOutcome")])
                self.assertIn(f"{status.value}: {{ label:", self.source("lib/data/options.ts"))

    def test_the_status_labels_are_the_ones_the_story_names(self):
        options = self.source("lib/data/options.ts")
        for status in SAFETY_STATUSES:
            with self.subTest(status=status.value):
                self.assertIn(f'{status.value}: {{ label: "{label(status)}"', options)

    def test_the_safety_officer_lands_on_the_safety_page_and_opens_nothing_else(self):
        access = self.source("lib/auth/route-access.ts")
        self.assertIn('safety: "/safety"', access)
        self.assertIn('safety: [["/safety", "Safety checks"]]', access)
        self.assertIn("hannah.lau@connectsphere.edu", self.source("lib/data/seed.ts"))

    def test_the_page_knows_every_field_of_a_safety_check_and_of_what_is_reviewed(self):
        for interface, model in (("SafetyCheck", schemas.SafetyCheck), ("SafetyArea", schemas.SafetyArea)):
            for field in model.model_fields:
                with self.subTest(interface=interface, field=field):
                    self.assertRegex(self.interface(interface), rf"\b{field}\b")

    def test_the_officer_can_approve_request_changes_or_reject_and_a_comment_is_required_for_the_last_two(self):
        card = self.source("components/safety/SafetyCheckCard.tsx")
        for button in ("Approve", "Request changes", "Reject"):
            self.assertIn(f">{button}</button>", card)
        self.assertIn("A comment is required when rejecting or requesting changes.", self.source("lib/safety/checks.ts"))

    def test_the_coordinator_can_send_an_event_to_the_check_and_send_it_again_after_rework(self):
        workspace = self.source("components/queue/EventWorkspace.tsx")
        self.assertIn("Request safety check", workspace)
        self.assertIn("Request safety check again", workspace)
        self.assertIn("/safety-check/request", self.source("lib/state/app-context.tsx"))


if __name__ == "__main__":
    unittest.main()

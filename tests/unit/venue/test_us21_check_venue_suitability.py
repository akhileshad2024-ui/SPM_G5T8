"""
Unit tests for US21 — Check Venue Suitability.

"As an Event Coordinator, I want to see whether a venue meets an event's requirements and why it
may be unsuitable so that I can avoid selecting an inappropriate venue."

AC1: each candidate venue is marked suitable, partially suitable or unsuitable
     ..................... TestVerdict, TestAssessingVenues
AC2: every unmet requirement is shown with its reason ........ TestUnmetRequirements
AC3: the comparison is made against the event's recorded venue needs ..... TestComparison
AC4: can still proceed with a partially suitable or unsuitable venue after acknowledging a warning
     ..................... TestAcknowledgementIsNeeded (the rule itself is in
     test_us22_submit_booking_request.py, since proceeding means submitting the booking request)
AC5: any such override is recorded against the event ......... TestOverrideRecord
Also: the endpoint and who may use it ....................... TestSuitabilityEndpoint
      the request the page sends ............................. TestSuitabilityRequest
      the page and the backend agree ......................... TestPageMatchesBackend

The rules are in backend/venue_suitability.py (with the availability reasons from
backend/venue_availability.py) and the endpoint function in backend/main.py is called directly,
with a MagicMock standing in for the database session. So these tests check what the code
decides and asks the database to do. They cannot show that the SQL really returns only active
venues, or that a request without a login gets a 401; the integration tests check those.

Run from the repo root:
    python -m unittest discover -s tests/unit/venue -p "test_us21_*.py" -v
"""

import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

# main.py builds the database engine when imported, so point it at in-memory SQLite
# first. The real Supabase database is never touched.
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["JWT_SECRET"] = "test-secret-for-us17-unit-tests-only-0123456789"
REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "backend"))

from fastapi import HTTPException
from pydantic import ValidationError

import main
import models
import schemas
import venue_availability
import venue_suitability
from login.models import Role
from login.security import require_roles

COORDINATOR = SimpleNamespace(email="priya.tan@connectsphere.edu", role=Role.coordinator)

# 2027-01-04 is a Monday.
MON, SUN = "2027-01-04", "2027-01-10"


def make_venue(**overrides) -> models.Venue:
    """An active venue open Monday to Friday 08:00-22:00, as loaded from the database (never saved)."""
    fields = dict(
        id=1, name="Lecture Theatre 1", location="North wing", cap=100,
        layouts=["theatre", "classroom"], facilities=["Projector", "PA system"],
        accessibility=["Wheelchair Access", "Special Physical Seating"],
        operatingHours="08:00 - 22:00", operatingDays=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        unavailability=[], setupMinutes=0, turnaroundMinutes=0, is_active=True,
        last_updated_by="daniel.ortiz@connectsphere.edu",
        last_updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    fields.update(overrides)
    return models.Venue(**fields)


def needs(**fields) -> schemas.SuitabilityRequest:
    """An event's venue needs. Only the attendance is always known."""
    return schemas.SuitabilityRequest(**{"attendance": 50, **fields})


def booked(**fields) -> schemas.BookedPeriod:
    return schemas.BookedPeriod(**{"venue_id": 1, "date": MON, "start": "10:00", "end": "12:00", **fields})


def verdict_of(venue, **fields) -> str:
    return venue_suitability.assess(venue, needs(**fields))[0]


def reasons(venue, bookings=(), **fields) -> list:
    return [c["reason"] for c in venue_suitability.assess(venue, needs(**fields), bookings)[1] if not c["met"]]


# Everything a typical event might ask of the default venue, all of which it offers.
FULL_NEEDS = dict(attendance=100, layout="theatre", facilities=["Projector"],
                  accessibility=["Wheelchair Access"], date=MON, start="10:00", end="12:00")


# ---------------------------------------------------------------- AC1: suitable, partially suitable, unsuitable

class TestVerdict(unittest.TestCase):
    def test_a_venue_that_meets_every_need_is_suitable(self):
        verdict, checks = venue_suitability.assess(make_venue(), needs(**FULL_NEEDS))

        self.assertEqual(verdict, "suitable")
        self.assertTrue(all(c["met"] for c in checks))

    def test_attendance_equal_to_the_capacity_fits_but_one_more_does_not(self):
        venue = make_venue(cap=100)
        for attendance, expected in ((1, "suitable"), (100, "suitable"), (101, "unsuitable")):
            with self.subTest(attendance=attendance):
                self.assertEqual(verdict_of(venue, attendance=attendance), expected)

    def test_a_missing_layout_accessibility_feature_or_free_slot_makes_the_venue_unsuitable(self):
        venue = make_venue()
        blockers = {
            "layout not supported": dict(layout="banquet"),
            "accessibility feature missing": dict(accessibility=["Mobility/Facility Arrangements"]),
            "closed that day": dict(date=SUN, start="10:00", end="12:00"),
            "event outside operating hours": dict(date=MON, start="07:00", end="09:00"),
        }
        for name, fields in blockers.items():
            with self.subTest(blocker=name):
                self.assertEqual(verdict_of(venue, **fields), "unsuitable")

    def test_a_missing_facility_makes_the_venue_only_partially_suitable(self):
        self.assertEqual(verdict_of(make_venue(), facilities=["Projector", "Stage"]), "partially_suitable")

    def test_setup_or_turnaround_running_outside_operating_hours_is_only_a_caveat(self):
        venue = make_venue(setupMinutes=30)  # setup starts 07:30, before the 08:00 opening

        self.assertEqual(verdict_of(venue, date=MON, start="08:00", end="10:00"), "partially_suitable")

    def test_one_blocking_problem_outweighs_any_number_of_caveats(self):
        self.assertEqual(verdict_of(make_venue(), attendance=500, facilities=["Stage", "Hearing loop"]), "unsuitable")

    def test_an_event_that_needs_nothing_but_a_room_for_its_attendance_gets_a_suitable_venue(self):
        verdict, checks = venue_suitability.assess(make_venue(), needs())

        self.assertEqual(verdict, "suitable")
        self.assertEqual([c["key"] for c in checks], ["capacity"])


class TestAssessingVenues(unittest.TestCase):
    def test_every_active_venue_is_assessed_and_deactivated_ones_are_left_out(self):
        venues = [make_venue(id=1, cap=100), make_venue(id=2, cap=10), make_venue(id=3, is_active=False)]

        results = venue_suitability.assess_venues(venues, needs(attendance=50))

        self.assertEqual([(v.id, verdict) for v, verdict, _ in results], [(1, "suitable"), (2, "unsuitable")])

    def test_only_the_venues_asked_about_are_assessed(self):
        venues = [make_venue(id=1), make_venue(id=2), make_venue(id=3)]

        results = venue_suitability.assess_venues(venues, needs(venue_ids=[3, 1]))

        self.assertEqual([v.id for v, _, _ in results], [1, 3])
        self.assertEqual(venue_suitability.assess_venues(venues, needs(venue_ids=[])), [])

    def test_a_booking_counts_against_its_own_venue_only(self):
        venues = [make_venue(id=1), make_venue(id=2)]
        clash = booked(venue_id=2)

        results = venue_suitability.assess_venues(venues, needs(date=MON, start="10:00", end="12:00", bookings=[clash]))

        self.assertEqual([(v.id, verdict) for v, verdict, _ in results], [(1, "suitable"), (2, "unsuitable")])


# ---------------------------------------------------------------- AC2: every unmet requirement, with its reason

class TestUnmetRequirements(unittest.TestCase):
    def test_every_unmet_requirement_is_listed_each_with_its_own_reason(self):
        weak = make_venue(cap=50, layouts=["classroom"], facilities=["Whiteboard"], accessibility=[],
                          operatingHours="09:00 - 18:00")

        self.assertEqual(
            reasons(weak, attendance=80, layout="theatre", facilities=["Projector", "PA system"],
                    accessibility=["Wheelchair Access", "Special Physical Seating"], date=MON, start="07:00", end="08:00"),
            [
                "Capacity 50 is below the expected attendance of 80.",
                "Does not support a theatre layout.",
                "Projector is not available at this venue.",
                "PA system is not available at this venue.",
                "Wheelchair Access is not provided at this venue.",
                "Special Physical Seating is not provided at this venue.",
                "07:00–08:00 is outside Lecture Theatre 1's operating hours (09:00 - 18:00).",
            ],
        )

    def test_a_met_requirement_has_no_reason(self):
        checks = venue_suitability.check_requirements(make_venue(), needs(**FULL_NEEDS))

        self.assertEqual([c["reason"] for c in checks], [None] * len(checks))

    def test_unmet_requirements_are_summarised_with_label_severity_and_reason(self):
        checks = venue_suitability.check_requirements(make_venue(cap=10), needs(facilities=["Stage"]))

        self.assertEqual(venue_suitability.unmet_requirements(checks), [
            {"label": "Capacity", "severity": "block", "reason": "Capacity 10 is below the expected attendance of 50."},
            {"label": "Facility: Stage", "severity": "warn", "reason": "Stage is not available at this venue."},
        ])

    def test_why_a_venue_is_not_available_is_spelled_out(self):
        period = {"start": "2027-01-04T10:00", "end": "2027-01-04T12:00", "reason": "maintenance", "note": "Rewiring"}
        timing = dict(date=MON, start="10:00", end="12:00")
        cases = {
            "closed on that weekday": (make_venue(), dict(date=SUN, start="10:00", end="12:00"), (),
                                       "Lecture Theatre 1 is closed on Sundays."),
            "deactivated": (make_venue(is_active=False), timing, (),
                            "Lecture Theatre 1 has been deactivated."),
            "unavailability period with a note": (make_venue(unavailability=[period]), timing, (),
                                                  "Lecture Theatre 1 is unavailable (Maintenance: Rewiring) from 04 Jan 2027, 10:00 to 04 Jan 2027, 12:00."),
            "unavailability period without a note": (make_venue(unavailability=[{**period, "reason": "safety", "note": None}]), timing, (),
                                                     "Lecture Theatre 1 is unavailable (Safety concern) from 04 Jan 2027, 10:00 to 04 Jan 2027, 12:00."),
            "unavailability period with an unlisted reason": (make_venue(unavailability=[{**period, "reason": "flood", "note": ""}]), timing, (),
                                                              "Lecture Theatre 1 is unavailable (flood) from 04 Jan 2027, 10:00 to 04 Jan 2027, 12:00."),
            "setup and turnaround running outside hours": (make_venue(setupMinutes=30, turnaroundMinutes=45),
                                                           dict(date=MON, start="08:00", end="10:00"), (),
                                                           "Setup or turnaround (07:30–10:45 incl. 30 min setup and 45 min turnaround) runs outside operating hours (08:00 - 22:00)."),
        }
        for name, (venue, fields, bookings, expected) in cases.items():
            with self.subTest(reason=name):
                self.assertEqual(reasons(venue, bookings, **fields), [expected])

    def test_a_clash_names_the_other_event_whether_it_is_booked_or_only_requested(self):
        venue = make_venue(setupMinutes=30, turnaroundMinutes=45)
        timing = dict(date=MON, start="10:00", end="12:00")
        window = "(venue occupied 09:30–12:45 incl. 30 min setup and 45 min turnaround)"
        cases = {
            "approved booking": (booked(status="approved", event_name="Gala"), f"Clashes with Gala, already booked on 04 Jan 2027 {window}."),
            "pending request": (booked(status="pending", event_name="Fair"), f"Clashes with Fair, already requested on 04 Jan 2027 {window}."),
            "unnamed": (booked(), f"Clashes with another booking, already booked on 04 Jan 2027 {window}."),
        }
        for name, (clash, expected) in cases.items():
            with self.subTest(clash=name):
                self.assertEqual(reasons(venue, [clash], **timing), [expected])

    def test_the_clashing_window_names_only_the_setup_and_turnaround_the_venue_has(self):
        timing = dict(date=MON, start="10:00", end="12:00")
        for setup, turnaround, window in ((30, 0, "09:30–12:00 incl. 30 min setup"), (0, 45, "10:00–12:45 incl. 45 min turnaround"),
                                         (0, 0, "10:00–12:00")):
            with self.subTest(setup=setup, turnaround=turnaround):
                venue = make_venue(setupMinutes=setup, turnaroundMinutes=turnaround)

                self.assertEqual(reasons(venue, [booked(event_name="Gala")], **timing),
                                 [f"Clashes with Gala, already booked on 04 Jan 2027 (venue occupied {window})."])


# ---------------------------------------------------------------- AC3: compared with the event's recorded needs

class TestComparison(unittest.TestCase):
    def test_each_need_is_compared_with_what_the_venue_offers_in_a_fixed_order(self):
        checks = venue_suitability.check_requirements(
            make_venue(facilities=["Projector"]),
            needs(attendance=80, layout="theatre", facilities=["Projector", "Stage"], accessibility=["Wheelchair Access"],
                  date=MON, start="10:00", end="12:00"))

        self.assertEqual([(c["key"], c["label"], c["needed"], c["offered"], c["met"]) for c in checks], [
            ("capacity", "Capacity", "80 people", "100 people", True),
            ("layout", "Layout", "Theatre", "Theatre, Classroom", True),
            ("facility", "Facility: Projector", "Required", "Available", True),
            ("facility", "Facility: Stage", "Required", "Not available", False),
            ("accessibility", "Accessibility: Wheelchair Access", "Required", "Provided", True),
            ("availability", "Availability", "04 Jan 2027, 10:00–12:00", "Free, setup and turnaround included", True),
        ])

    def test_only_the_needs_the_event_has_recorded_are_compared(self):
        self.assertEqual([c["key"] for c in venue_suitability.check_requirements(make_venue(), needs())], ["capacity"])
        self.assertEqual([c["key"] for c in venue_suitability.check_requirements(make_venue(), needs(layout="theatre"))],
                         ["capacity", "layout"])

    def test_matching_ignores_case(self):
        venue = make_venue(layouts=["Theatre"], facilities=["PA system"], accessibility=["wheelchair access"])

        self.assertEqual(verdict_of(venue, layout="THEATRE", facilities=["pa SYSTEM"], accessibility=["Wheelchair Access"]), "suitable")

    def test_a_venue_with_no_layouts_recorded_is_shown_as_such(self):
        for layouts in ([], None):
            with self.subTest(layouts=layouts):
                checks = venue_suitability.check_requirements(make_venue(layouts=layouts), needs(layout="theatre"))

                self.assertEqual((checks[1]["offered"], checks[1]["met"]), ("None recorded", False))

    def test_a_caveat_in_the_availability_check_is_marked_as_one(self):
        checks = venue_suitability.check_requirements(make_venue(setupMinutes=30), needs(date=MON, start="08:00", end="10:00"))

        self.assertEqual((checks[-1]["offered"], checks[-1]["severity"], checks[-1]["met"]), ("Available with a caveat", "warn", False))

    def test_a_blocked_slot_is_marked_not_available(self):
        checks = venue_suitability.check_requirements(make_venue(), needs(date=SUN, start="10:00", end="12:00"))

        self.assertEqual((checks[-1]["offered"], checks[-1]["severity"], checks[-1]["met"]), ("Not available", "block", False))


# ---------------------------------------------------------------- AC4: proceeding needs the warning to be acknowledged

class TestAcknowledgementIsNeeded(unittest.TestCase):
    def test_only_a_fully_suitable_venue_can_be_requested_without_acknowledging(self):
        # The refusal itself (and its message) is tested in test_us22; here, which verdicts need it.
        import booking_request

        for verdict, needs_it in (("suitable", False), ("partially_suitable", True), ("unsuitable", True)):
            with self.subTest(verdict=verdict):
                if needs_it:
                    with self.assertRaises(booking_request.BookingRefused):
                        booking_request.require_acknowledgement(verdict, [], acknowledged=False)
                else:
                    booking_request.require_acknowledgement(verdict, [], acknowledged=False)
                booking_request.require_acknowledgement(verdict, [], acknowledged=True)  # acknowledging always lets it through


# ---------------------------------------------------------------- AC5: the override is recorded

class TestOverrideRecord(unittest.TestCase):
    def test_the_record_keeps_the_verdict_who_acknowledged_when_and_every_unmet_requirement(self):
        at = datetime(2027, 1, 1, 9, 30, tzinfo=timezone.utc)
        verdict, checks = venue_suitability.assess(make_venue(cap=10), needs(layout="banquet", facilities=["Stage"]))

        record = venue_suitability.override_record(verdict, checks, COORDINATOR.email, at)

        self.assertEqual(record["verdict"], "unsuitable")
        self.assertEqual((record["acknowledged_by"], record["acknowledged_at"]), (COORDINATOR.email, at))
        self.assertEqual([u["reason"] for u in record["unmet"]], [
            "Capacity 10 is below the expected attendance of 50.",
            "Does not support a banquet layout.",
            "Stage is not available at this venue.",
        ])

    def test_the_record_is_a_valid_booking_override(self):
        at = datetime(2027, 1, 1, tzinfo=timezone.utc)
        record = venue_suitability.override_record("partially_suitable", [], COORDINATOR.email, at)

        self.assertEqual(schemas.BookingOverride(**record).unmet, [])


# ---------------------------------------------------------------- the request the page sends

class TestSuitabilityRequest(unittest.TestCase):
    def test_the_attendance_is_required_and_must_be_at_least_one(self):
        with self.assertRaises(ValidationError):
            schemas.SuitabilityRequest()
        for attendance, ok in ((0, False), (-5, False), (1, True)):
            with self.subTest(attendance=attendance):
                if ok:
                    self.assertEqual(needs(attendance=attendance).attendance, 1)
                else:
                    with self.assertRaises(ValidationError):
                        needs(attendance=attendance)

    def test_the_other_needs_are_optional_and_tidied(self):
        bare = needs()
        tidy = needs(layout=" Theatre ", facilities=["Projector", "projector"], accessibility=["wheelchair access"])

        self.assertEqual((bare.layout, bare.facilities, bare.accessibility, bare.date, bare.venue_ids), (None, [], [], None, None))
        self.assertEqual((tidy.layout, tidy.facilities, tidy.accessibility), ("theatre", ["Projector"], ["Wheelchair Access"]))

    def test_accessibility_must_be_one_of_the_fixed_features(self):
        with self.assertRaises(ValidationError):
            needs(accessibility=["Step-free access"])


# ---------------------------------------------------------------- the endpoint

class TestSuitabilityEndpoint(unittest.TestCase):
    def fake_db(self, venues):
        db = MagicMock()
        db.query.return_value.filter.return_value.order_by.return_value.all.return_value = venues
        return db

    def test_it_reads_the_active_venues_in_id_order(self):
        db = self.fake_db([])

        main.check_venue_suitability(needs(), db=db, _user=COORDINATOR)

        db.query.assert_called_once_with(models.Venue)
        self.assertEqual(str(db.query.return_value.filter.call_args.args[0]), str(models.Venue.is_active == True))
        self.assertEqual([str(a) for a in db.query.return_value.filter.return_value.order_by.call_args.args], ["Venue.id"])

    def test_it_returns_each_venue_with_its_verdict_and_every_check(self):
        db = self.fake_db([make_venue(id=1, cap=100), make_venue(id=2, name="Small Room", cap=10)])

        result = main.check_venue_suitability(needs(layout="theatre"), db=db, _user=COORDINATOR)

        self.assertEqual([(r.venue.id, r.venue.name, r.verdict) for r in result.results],
                         [(1, "Lecture Theatre 1", "suitable"), (2, "Small Room", "unsuitable")])
        self.assertEqual([c.key for c in result.results[1].checks], ["capacity", "layout"])
        self.assertEqual(result.results[1].checks[0].reason, "Capacity 10 is below the expected attendance of 50.")

    def test_only_event_coordinators_may_check_suitability(self):
        check = require_roles(*main.BOOKING_REQUESTERS)
        for role in Role:
            with self.subTest(role=role.value):
                user = SimpleNamespace(role=role)
                if role == Role.coordinator:
                    self.assertIs(check(user=user), user)
                else:
                    with self.assertRaises(HTTPException) as ctx:
                        check(user=user)
                    self.assertEqual(ctx.exception.status_code, 403)

    def test_the_route_requires_that_check(self):
        route = next(r for r in main.app.routes if getattr(r, "path", None) == "/venues/suitability" and "POST" in r.methods)
        names = [d.call.__qualname__ for d in route.dependant.dependencies]

        self.assertIn("require_roles.<locals>.dependency", names)


# ---------------------------------------------------------------- the page and the backend agree

class TestPageMatchesBackend(unittest.TestCase):
    """Reads the frontend source, since a Python test cannot click through a browser. These guard against
    the page and the backend drifting apart; they are not a full UI test."""

    def source(self, relative):
        return (REPO / relative).read_text(encoding="utf-8")

    def test_the_page_sends_the_field_names_the_backend_expects(self):
        source = self.source("lib/venue-suitability.ts")
        building = source[source.index("export function buildSuitabilityRequest"):]

        for field in ("attendance", "layout", "facilities", "accessibility", "date", "start", "end", "bookings"):
            self.assertIn(field, schemas.SuitabilityRequest.model_fields)
            with self.subTest(field=field):
                self.assertRegex(building, rf"\b{field}\s*[:=]")

    def test_the_page_has_a_label_for_every_verdict_and_every_kind_of_check(self):
        source = self.source("lib/venue-suitability.ts")

        for verdict in ("suitable", "partially_suitable", "unsuitable"):
            with self.subTest(verdict=verdict):
                self.assertRegex(source, rf"\b{verdict}:")

    def test_proceeding_with_a_venue_that_is_not_suitable_goes_through_an_acknowledgement(self):
        source = self.source("components/queue/tabs/VenueTab.tsx")

        self.assertIn("acknowledg", source.lower())
        self.assertIn("verdict", source)


if __name__ == "__main__":
    unittest.main()

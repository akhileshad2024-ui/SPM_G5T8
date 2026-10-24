"""Integration tests for US03 AC6 — an event date in the past can't be submitted.

No field is mandatory (Product Owner decision, 24 Oct 2026: the customer never specified any), so a
request without a date is still accepted; only a date that has already passed is refused. Drafts are
not checked. Real FastAPI and SQLAlchemy on an isolated SQLite database, never Supabase.

Run from the project root:
    python -m unittest tests.integration.test_us03_past_event_date_integration -v
"""

from datetime import timedelta

from tests.integration.test_us05_save_event_draft_integration import US05DraftApiTestCase
import models
import schemas

PAST_DATE = "Preferred date cannot be in the past."


def details(day=None):
    body = {"name": "Past Date Check", "description": "US03 AC6"}
    if day is not None:
        body["preferredDate"] = day.isoformat()
    return body


class TestPastEventDate(US05DraftApiTestCase):
    def submit(self, day=None, draft_id=None):
        return self.organiser.post("/event-requests/submit", json={
            "event_information": {"name": "Past Date Check"}, "event_details": details(day), "draft_id": draft_id,
        })

    def test_a_past_date_is_refused_and_nothing_is_saved(self):
        response = self.submit(schemas.campus_today() - timedelta(days=1))
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()["detail"], {"message": PAST_DATE, "errors": {"preferredDate": PAST_DATE}})
        self.assertEqual(self.db.query(models.Event).count(), 0)

    def test_a_draft_with_a_past_date_stays_a_draft(self):
        draft_id = self.organiser.post("/event-requests/drafts", json={
            "event_information": {"name": "Past Date Check"},
            "event_details": details(schemas.campus_today() - timedelta(days=3)),
        }).json()["id"]
        response = self.submit(schemas.campus_today() - timedelta(days=3), draft_id)
        self.assertEqual(response.status_code, 422, response.text)
        self.db.expire_all()
        self.assertEqual(self.db.get(models.Event, draft_id).status, models.EventStatus.draft)

    def test_today_and_later_dates_are_accepted(self):
        for day in (schemas.campus_today(), schemas.campus_today() + timedelta(days=30)):
            with self.subTest(day=day):
                self.assertEqual(self.submit(day).status_code, 201)

    def test_a_request_without_a_date_is_accepted(self):
        # No field is mandatory, the date included.
        self.assertEqual(self.submit().status_code, 201)

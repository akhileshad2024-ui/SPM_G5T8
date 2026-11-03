# US49 — Reassess Venue Bookings After an Accepted Change

**Priority:** Could Have · **Estimate:** 5 points · **Split from:** US35 (11 Oct 2026) · **Module:** M3 ·
**Updated by:** CR-W7-3 (an event may book several venues)

> "As an Event Coordinator, I want the event's venue bookings to be re-evaluated and flagged for reassessment
> when a change is accepted so that venue information remains consistent."

US49 is the venue part of the shared accepted-change reassessment built with US50 (equipment) and US51
(registration), `backend/arrangement_reassessment.py`. Accepting a change request (US34) may name the reviewed
values (`effective_changes`); they are saved with the decision and the event is not edited until the coordinator
applies them. Flags are the shared "Requires Reassessment" records (`arrangement_reassessments`), also used by
US45. Builds on US21 (venue suitability checks), US41 (several bookings per event) and US14 (confirming an event).

## Acceptance criteria and where they are tested

Test names carry the criterion ID (`[US49-AC2]` in Playwright, `test_US49_AC2_...` in Python).

| ID | Ensure that the Event Coordinator … | How | Unit | API | Functional |
|---|---|---|---|---|---|
| AC1 | Has each of the event's venue bookings re-evaluated automatically when a change is accepted (CR-W7-3) | In the decision transaction, `arrangement_reassessment.accepted` checks every pending or approved booking with `change_reassessment.booking_problems`; the count is saved with the decision (`venue_checked`) and shown under the request | ✓ | ✓ | ✓ |
| AC2 | Sees venue bookings that are no longer valid flagged as "Requires Reassessment" | A booking is no longer valid when it is for another date or time than the event as reviewed, or the change introduces a US21 blocking problem it did not have: capacity, layout, accessibility, closed day, hours, unavailable period, clash with another booking. Its flag carries each reason; the coordinator sees it on the event, Venue Staff on Bookings | ✓ | ✓ | ✓ |
| AC3 | Has the responsible Venue Staff notified of each flagged booking | `messaging.venue_booking_reassess`, once per flagged booking, to every active Venue Staff member (one team manages every venue, US23-AC1). Nobody is told when every booking still fits | ✓ | ✓ | ✓ |
| AC4 | Is prevented from confirming the event while flagged arrangements remain unresolved (also flags raised by US50 and US51) | US14's `outstanding()` lists every open shared flag, venue, equipment or registration, so confirming is refused (409) until each is resolved | ✓ | ✓ | ✓ |

Files:

- Rule: `backend/change_reassessment.py` (`booking_problems`), called from `backend/arrangement_reassessment.py` (`accepted`)
- Page: `app/(dashboard)/bookings/page.tsx` (venue flags for Venue Staff to resolve), `components/my-events/ChangeRequests.tsx`
  (venue bookings checked), `components/queue/ReassessmentPanel.tsx` (heading)
- Tests: `tests/unit/accepted_change/test_us49_reassess_venue_bookings.py` (backend unit),
  `tests/us49_reassess_venue_bookings/test_reassess_venue_bookings_api.py` (API, full workflow),
  `tests/functional/us49-reassess-venue-bookings.spec.ts`

```bash
python -m pytest tests/unit/accepted_change tests/us49_reassess_venue_bookings
npx playwright test tests/functional/us49-reassess-venue-bookings.spec.ts
python run_coverage.py us49
```

## Decisions

1. **One shared mechanism.** US49 replaces the shared service's period-only venue check with the full re-check;
   the reviewed values, flag records, notices, resolution and confirmation gate are the ones US50/US51/US45 use.
2. **Only problems the change introduces count.** Each booking is checked with the US21 rules before and after the
   change; a problem it already had (e.g. a smaller hall accepted with a US21 override) is not raised again. A
   booking for part of the event (a US41 breakout with its own attendance or layout) keeps them.
3. **Resolving a venue flag** follows the shared rules: the reviewed values are applied first; then Venue Staff or
   the coordinator record how it was resolved, once the booking is approved and for the event's period. A booking
   for the old date or time is replaced (cancel and rebook) instead.

## Database change

None of its own: the shared `arrangement_reassessments` table comes with US50/US51
(`backend/migrations/sprint4_yangbo_reassessment.sql`).

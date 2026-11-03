# US49 — Reassess Venue Bookings After an Accepted Change

**Priority:** Could Have · **Estimate:** 5 points · **Split from:** US35 (11 Oct 2026) · **Module:** M3 ·
**Updated by:** CR-W7-3 (an event may book several venues)

> "As an Event Coordinator, I want the event's venue bookings to be re-evaluated and flagged for reassessment
> when a change is accepted so that venue information remains consistent."

Builds on US33/US34 (change requests and their decision), US21 (venue suitability checks), US38 (the "Requires
Reassessment" flag on a booking), US41 (several bookings per event) and US14 (confirming an event). Uses the US36
notification function prepared for it (`messaging.venue_booking_reassess`).

## Acceptance criteria and where they are tested

Test names carry the criterion ID (`[US49-AC2]` in TypeScript/Playwright, `test_US49_AC2_...` in Python).

| ID | Ensure that the Event Coordinator … | How | Unit | API | Functional |
|---|---|---|---|---|---|
| AC1 | Has each of the event's venue bookings re-evaluated automatically when a change is accepted (CR-W7-3) | Accepting a change request may say what it changes (new date, start, end, expected attendance, layout). In the same transaction every booking that holds a venue is re-checked, and each result is saved on the request (`venue_reassessment`) and shown under it | ✓ | ✓ | ✓ |
| AC2 | Sees venue bookings that are no longer valid flagged as "Requires Reassessment" | A booking is no longer valid when the change introduces a problem: another date or time than it holds, or a US21 blocking check (capacity, layout, closed day, hours, unavailable period, clash with another booking) that fails after the change but not before. It gets the shared flag `{reason: "accepted_change", message, problems, change_request_id, flagged_at}` and is listed under "Bookings requiring reassessment" | ✓ | ✓ | ✓ |
| AC3 | Has the responsible Venue Staff notified of each flagged booking | `messaging.venue_booking_reassess`, once per flagged booking, to every active Venue Staff member (one team manages every venue, US23-AC1). Nobody is told when every booking still fits | ✓ | ✓ | ✓ |
| AC4 | Is prevented from confirming the event while flagged arrangements remain unresolved (also flags raised by US50 and US51) | US14's `outstanding()` lists every flagged booking and every equipment line carrying the same flag (US50), so confirming is refused (409) until each is resolved | ✓ | ✓ | ✓ |

Files:

- Rules: `backend/change_reassessment.py` (`accepted_values`, `booking_problems`, `after_acceptance`, `resolve`, `change_flags`)
- Endpoints: `backend/main.py` (`POST /events/{id}/change-requests/{rid}/decision` now takes optional `changes`;
  `POST /bookings/{id}/reassessment/resolve`), confirmation check in `backend/event_confirmation.py`
- Page: `lib/events/change-reassessment.ts`, `components/my-events/ChangeRequests.tsx` (new values when accepting,
  re-check results), `app/(dashboard)/bookings/page.tsx` (Mark still valid), `lib/state/app-context.tsx` (`resolveReassessment`)
- Tests: `tests/unit/accepted_change/test_us49_reassess_venue_bookings.py` (backend unit),
  `tests/us49_reassess_venue_bookings/test_reassess_venue_bookings_api.py` (API, full workflow),
  `tests/unit/event-review/change-reassessment.unit.test.ts` (page), `tests/functional/us49-reassess-venue-bookings.spec.ts`

```bash
python -m pytest tests/unit/accepted_change tests/us49_reassess_venue_bookings
npx vitest run tests/unit/event-review/change-reassessment.unit.test.ts
npx playwright test tests/functional/us49-reassess-venue-bookings.spec.ts
python run_coverage.py us49
```

## Decisions

1. **The coordinator says what the accepted change changes; the event is still not edited.** A change request is
   free text and US34 deliberately records a decision without editing the event (pinned by its tests). So that
   there is something to check the bookings against, accepting may carry `changes` (date, start, end, pax, layout).
   They are saved on the request (`accepted_changes`), never applied to the event. Accepting without them still
   re-checks every booking, and none can be newly invalid. US50 and US51 can read the same `accepted_changes`.
2. **Only problems the change introduces count.** Each booking is checked with the US21 rules before and after the
   change; a problem it already had (e.g. a smaller hall the coordinator accepted with a US21 override) is not
   raised again. A booking for part of the event (a US41 breakout with its own attendance or layout) keeps them.
3. **One "Requires Reassessment" flag per booking, shared with US38.** The existing `venue_bookings.reassessment`
   field holds it, with reason `accepted_change`. US38's re-check only clears its own `venue_time_changed` flags,
   and drops any flag once the booking stops holding the venue.
4. **How a flag is resolved.** Venue Staff mark the booking still valid with a note (`Mark still valid` on
   Bookings); the outcome is kept on the change request and the coordinator is told. Or the coordinator replaces
   the venue: cancelling the flagged booking clears it. A US38 flag can't be cleared by hand: it clears itself
   once the clash is gone.
5. **The flag shape is shared with US50 and US51** (`change_reassessment.FLAG_FIELDS`). US14 already refuses to
   confirm while an equipment line carries it (US50); US51 adds its registration flag to `change_flags()` once it
   has somewhere to keep it.

## Database change

Two new nullable JSON columns on `event_change_requests` (`accepted_changes`, `venue_reassessment`). Run the
**US49** step at the end of `backend/schema_changes.sql` once in the Supabase SQL Editor. Requests decided earlier
keep NULL in both. The booking flag reuses the existing US38 `reassessment` column.

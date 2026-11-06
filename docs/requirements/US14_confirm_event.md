# US14 — Confirm Event

**Priority:** Must Have · **Estimate:** 5 points (re-estimated from 3 on 11 Oct 2026) ·
**Updated by:** CR-W7-3 (AC1), CR-W7-2 (AC6), CR-W7-6 (AC7)

> "As an Event Coordinator, I want to confirm an event once its essential arrangements are complete so that
> the Event Organiser knows the arrangements are finalised."

Builds on US22/US23/US41 (venue bookings), US25–US28 (equipment), US38/US39 (booking flags), US44 (Operational
Safety Check) and uses the US36 notification function prepared for it (`messaging.event_confirmed`).

## Acceptance criteria and where they are tested

Test names carry the criterion ID (`[US14-AC2]` in TypeScript/Playwright, `test_US14_AC2_...` in Python).

| ID | Ensure that the Event Coordinator … | How | Unit | API | Functional |
|---|---|---|---|---|---|
| AC1 | Can confirm an event only when every venue booking is approved (CR-W7-3) and all required equipment is reserved | Each booking that holds a venue must be approved (and there must be one); each equipment line reserved or fulfilled. Only the assigned coordinator | ✓ | ✓ | ✓ |
| AC2 | Is prevented from confirming while arrangements are outstanding, with each outstanding item listed | 409 naming every item; `GET /events/{id}/confirmation` lists them; checklist card on the Request tab | ✓ | ✓ | ✓ |
| AC3 | Has the status set to "Confirmed" with a timestamp recorded | Status via `change_status` (US13 history) plus `events.confirmed_at` / `confirmed_by_id` | ✓ | ✓ | ✓ |
| AC4 | Has the Event Organiser and all involved staff notified | `messaging.event_confirmed`: organiser, Venue Staff (event holds a venue), assigned technician; not the coordinator who confirmed | ✓ | ✓ | ✓ |
| AC5 | Has specified event fields locked after confirmation | `LOCKED_AFTER_CONFIRMATION`: every US16 detail field and the equipment request. Enforced by US16 and equipment editing, which accept only events in planning; shown on the card | ✓ | ✓ | ✓ |
| AC6 | Is prevented from confirming while any booking is flagged as needing alternative arrangements (CR-W7-2) | A booking's US39 `flag` (venue unavailable) — and its US38 `reassessment` flag — are listed as outstanding | ✓ | ✓ | ✓ |
| AC7 | Can confirm only after the Safety Officer approved the Operational Safety Check (US44, CR-W7-6) | Only Safety Approved can be confirmed; every earlier step is listed as outstanding | ✓ | ✓ | ✓ |

Files:

- Rules: `backend/event_confirmation.py` (`outstanding`, `confirm`, `LOCKED_AFTER_CONFIRMATION`)
- Endpoints: `backend/main.py` (`POST /events/{id}/confirm`, `GET /events/{id}/confirmation`)
- Page: `lib/events/confirmation.ts`, `components/queue/tabs/RequestTab.tsx` (Confirmation card),
  `components/queue/EventWorkspace.tsx` (Confirm event button at Safety Approved)
- Tests: `tests/unit/safety/test_us14_confirm_event.py` (backend unit), `tests/us14_confirm_event/test_confirm_event_api.py`
  (API, full workflow), `tests/unit/event-review/confirmation.unit.test.ts` (page), `tests/functional/us14-confirm-event.spec.ts`

```bash
python -m pytest tests/unit/safety/test_us14_confirm_event.py tests/us14_confirm_event
npx vitest run tests/unit/event-review/confirmation.unit.test.ts
npx playwright test tests/functional/us14-confirm-event.spec.ts
python run_coverage.py us14
```

## Decisions

1. **The safety check is enforced in US14's rule, not by editing the status table.** `event_status.TRANSITIONS`
   still allows Approved → Confirmed (pinned by the US13 and US44 tests). The confirm endpoint is the only way to
   reach Confirmed, and its rule accepts only Safety Approved, so the check can't be skipped. Removing the
   shortcut from the table is a one-line follow-up for the US13/US44 owners.
2. **Every outstanding item is listed, not just the first.** US44's `arrangements_issue()` returns one reason;
   US14 needs all of them (AC2), per booking and per equipment item, in the order the coordinator works through them.
3. **Flags count as outstanding:** both the US39 "venue unavailable" flag (AC6) and the US38 "requires
   reassessment" flag. An expired tentative hold (US42) holds nothing, so it is ignored.
4. **What is locked (AC5):** the event's details (the US16 fields) and its equipment request. **Venue bookings are
   not locked**: if a venue becomes unavailable after confirmation, the coordinator must still be able to request a
   replacement (CR-W7-2). Further detail changes go through a change request (US33).
5. **Only the assigned coordinator confirms**, checked by the route and again inside the rule.

## Database change

Two new nullable columns on `events` (`confirmed_at`, `confirmed_by_id`). Run the **US14** step at the end of
`backend/schema_changes.sql` once in the Supabase SQL Editor. Events confirmed earlier stay valid; their
confirmation is still in the US13 status history.

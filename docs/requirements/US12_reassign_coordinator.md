# US12 — Reassign Event Coordinator

**Priority:** Must Have (raised from Could Have by **CR-W7-5**) · **Estimate:** 3 points

> "As an Event Coordinator Lead, I want to reassign an event to another Event Coordinator so that
> coordination can continue when staff availability or responsibilities change."

Builds on US11 (assign) and US43 (the Lead role and its Assignments page), and uses the US36
notification function prepared for it (`messaging.coordinator_reassigned`).

## Acceptance criteria and where they are tested

Test names carry the criterion ID (`[US12-AC2]` in TypeScript/Playwright, `test_US12_AC2_...` in Python).

| ID | Ensure that the Event Coordinator Lead … | How | Unit | API | Functional |
|---|---|---|---|---|---|
| AC1 | Can change the assigned Event Coordinator on an existing event | `POST /events/{id}/reassign` (Lead only; live, already-assigned events; to another active coordinator). "Reassign" on the Assignments page | ✓ | ✓ | ✓ |
| AC2 | Must record a reason for the reassignment | Reason required, 1–1000 characters, saved on the assignment record | ✓ | ✓ | ✓ |
| AC3 | Has the previous coordinator's event-specific access removed and the new coordinator's access granted | Access follows `events.coordinator_id` (`event_requests/access.py`), so one change moves it; the previous coordinator can no longer see or act on the event | ✓ | ✓ | ✓ |
| AC4 | Has both the outgoing and incoming coordinators, and the Event Organiser, notified | `messaging.coordinator_reassigned` in the same transaction, so notices are saved only if the reassignment is | ✓ | ✓ | ✓ |
| AC5 | Can view the complete assignment history for the event | `GET /events/{id}/assignments` (oldest first: who, from whom, to whom, by whom, when, why). "History" on the Assignments page | ✓ | ✓ | ✓ |

Files:

- Rules: `backend/event_review.py` (`reassign`, `assignment_history`, the authority) and
  `lib/events/review/reassignment.ts` (same rules and messages on the page, for instant feedback)
- Endpoints: `backend/main.py` (`reassign_coordinator`, `event_assignment_history`)
- UI: `app/(dashboard)/assignments/page.tsx` (Reassign / History on each assigned event)
- Tests: `tests/unit/lead_assignment/test_us12_reassign_coordinator.py` (backend unit),
  `tests/us12_reassign_coordinator/test_reassign_api.py` (API), `tests/unit/event-review/reassignment.unit.test.ts`
  (page), `tests/functional/us12-reassign-coordinator.spec.ts` (Playwright)

```bash
python -m pytest tests/unit/lead_assignment/test_us12_reassign_coordinator.py tests/us12_reassign_coordinator
npx vitest run tests/unit/event-review/reassignment.unit.test.ts
npx playwright test tests/functional/us12-reassign-coordinator.spec.ts
python run_coverage.py us12
```

## Decisions

1. **History lives in the existing `event_assignments` table** (US11). A reassignment is a new row with
   `previous_coordinator_id` and `reason`; first assignments leave both empty. Reading the rows in order
   gives the complete history, so no separate history table is needed.
2. **Only an assigned event can be reassigned**; an unassigned one is assigned (US11). Closed events
   (draft, rejected, cancelled) can't be reassigned — the Lead doesn't see them (US43).
3. **The Lead check is in the rule as well as the route**, so the permission holds even if the rule is
   called from elsewhere.
4. **Who can read the history:** the Lead, plus anyone currently involved in the event (its coordinator and
   organiser). A coordinator who was reassigned away can no longer read it, consistent with AC3.
5. The review continues where it was: reassignment never changes the event's status or details.

## Database change

Two new nullable columns on `event_assignments` (`previous_coordinator_id`, `reason`). Run the **US12** step
at the end of `backend/schema_changes.sql` once in the Supabase SQL Editor. Existing assignment rows stay
valid (they read as first assignments).

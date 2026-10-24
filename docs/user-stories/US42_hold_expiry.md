# US42 — Expire Tentative Venue Holds

**Source:** Week 7 customer change **CR-W7-4** · **Extends:** US22, US23 · **Module:** M4 ·
**Priority:** Must Have · **Estimate:** 5 points

> "As a Venue Staff member, I want tentative venue holds to expire at a set time so that a venue
> is not held indefinitely while an Event Coordinator finalises arrangements."

## Acceptance criteria (from the backlog card) and where they are tested

Test names carry the criterion ID (`US42-AC1` in TypeScript/Playwright, `test_US42_AC1_...` in Python),
so `npx playwright test -g "US42-AC2"` or `pytest -k US42_AC2` runs one criterion.

| ID | Ensure that the Venue Staff member … | Unit (rules) | API | Functional (browser) |
|---|---|---|---|---|
| AC1 | Must set an expiry date and time when placing a tentative hold | `test_US42_AC1_*` (unit), `[US42-AC1]` page helpers | `test_US42_AC1_*` | 3 tests |
| AC2 | Has the hold expire automatically at its expiry time if the required action is not completed, and the venue released for other requests | `test_US42_AC2_*` | `test_US42_AC2_*` (incl. another event can then book the venue) | 1 test |
| AC3 | Has the Event Coordinator notified before the hold expires and again when it expires | `test_US42_AC3_*`, `[US42-AC3]` | `test_US42_AC3_*` | 2 tests |
| AC4 | Sees an expired hold shown as "Expired" and never treated as a confirmed booking | `[US42-AC4]` | `test_US42_AC4_*` (approving is refused) | 2 tests |

Files:

- Rules: `backend/hold_expiry.py` (server, the authority) and `lib/venues/hold-expiry.ts` (page display)
- Unit tests: `tests/us42_hold_expiry/unit/test_hold_expiry_rules_unit.py`, `tests/us42_hold_expiry/hold-expiry.unit.test.ts`
- API tests: `tests/us42_hold_expiry/test_hold_expiry_api.py`
- Functional tests: `tests/functional/us42-hold-expiry.spec.ts`

```bash
python -m pytest tests/us42_hold_expiry          # backend unit + API
npx vitest run tests/us42_hold_expiry            # page helpers
npx playwright test tests/functional/us42-hold-expiry.spec.ts
```

## Design decisions (agreed for Sprint 3)

1. **The pending booking request is the tentative hold.** A request already holds its venue from
   the moment the coordinator makes it (US22); US42 gives every such hold an expiry, so nothing is
   held indefinitely. A new request gets a **default of 3 days** after it was made (or the start of
   setup, if sooner). Venue Staff **set or change** the expiry on the request ("Hold expires" on the
   Booking requests page, `POST /bookings/{id}/hold`), which records who set it.
2. **The required action is Venue Staff approving the request** (US23). An approved booking keeps
   its venue. A request still pending at its expiry lapses: it becomes **Expired**, the venue is
   free for other requests, and it can never be approved (an expired request isn't pending).
3. **An expiry must be in the future and no later than the start of setup** — a hold that outlives
   the event would be meaningless.
4. **The coordinator is warned 24 hours before expiry**, and told again once it has expired.
5. **No background job.** The server decides from the time whenever bookings are read or decided:
   `hold_expiry.is_lapsed()` stops a lapsed hold blocking the venue straight away, and
   `expire_due()` saves "expired" before bookings or events are listed and before any decision.
6. **Notifications** are worked out by the server (`hold_notice` on each booking: `expiring_soon` /
   `expired`) and shown in the coordinator's notifications when the page loads. Notifications are not
   stored on the server yet (US36), so — like the other stories' notifications — they are not kept
   once dismissed or after signing out.
7. **Venue Staff still see expired holds.** Their event list only includes events that currently
   hold a venue (`event_access.py`, US02), so `GET /bookings` also returns expired holds to Venue
   Staff, shown under "Expired holds".
8. **Campus time.** Expiries are stored in UTC and entered and shown in Singapore time (UTC+8);
   `hold_start` (start of setup) is local wall-clock time and is compared in campus time.

## Database change

New columns on `venue_bookings` (`hold_expires_at`, `hold_expiry_set_by`). SQLAlchemy only creates
missing tables, so run the **US42** step in `backend/schema_changes.sql` once in the Supabase SQL
Editor. It also gives requests that are already pending the default expiry. Bookings saved without
an expiry never lapse, so nothing breaks before the script is run.

## Related

- **US23-AC7** ("Cannot approve a tentative hold whose expiry time has passed") is satisfied by the
  same rule — an expired request is not pending, so it can't be approved — and is tested under US23.
- **CR-W7-4** also updated US19 (availability calendar) and US24 (conflict detection): both read
  holds through `venue_bookings.held_periods()`, which now ignores lapsed holds.

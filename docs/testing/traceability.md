# Implementation Decisions and Test Traceability

The current Story Cards and ACs are maintained in [Notion Product Backlog](https://www.notion.so/3e19922d71f881b29bdef4797725bb80). Requirement changes are recorded in the [shared Change Log](https://docs.google.com/spreadsheets/d/1aHLZDqpS9rIw5dZnVRdMgl5PbkAKtWyXl5YbQbM2qSc/edit). This file consolidates code/test mappings and implementation decisions from the previous per-story notes; it does not create or replace customer ACs. Historical design statements are not new requirements or current DoD sign-off.

## US04 requirement review source notes

Historical review approved on 10 October 2026; changes US04-CHG-01 through US04-CHG-07 are retained in the shared Change Log. The old implementation-gap and pending lists have been removed.

- Week 4 Project Instructions, Event Request Creation: organisers can create and
  submit requests containing event name, purpose, description, proposed timing,
  expected attendance and relevant planning requirements. The list does not say
  that each item must be completed before submission.
- Week 1 Customer Briefing, Typical Process, Step 4: when information is
  incomplete or unclear, the coordinator requests clarification or amendment
  after submission and assignment. Missing information is not universally a
  submission blocker.
- Current-section instructor reply supplied by Wen: no default rejection;
  equipment outside the catalogue cannot be requested; post-submission changes
  are requested by the organiser and reviewed/decided by the coordinator.
  The reply refers mandatory fields to section clarification, but that specific
  clarification document has not been located in this review.
- Week 7 Customer Changes, change 5: new submissions enter an unassigned queue
  for the Event Coordinator Lead, not direct coordinator assignment.
- Week 7 Managing Changes, scenario 1: reopen an incomplete story when an
  original acceptance criterion was missed; verify the remaining valid criteria
  before marking Done again.

## US12 — Reassign Event Coordinator

| AC | How | Unit | API | Functional |
|---|---|---|---|---|
| AC1 | `POST /events/{id}/reassign` (Lead only; live, already-assigned events; to another active coordinator). "Reassign" on the Assignments page | ✓ | ✓ | ✓ |
| AC2 | Reason required, 1–1000 characters, saved on the assignment record | ✓ | ✓ | ✓ |
| AC3 | Access follows `events.coordinator_id` (`event_requests/access.py`), so one change moves it; the previous coordinator can no longer see or act on the event | ✓ | ✓ | ✓ |
| AC4 | `messaging.coordinator_reassigned` in the same transaction, so notices are saved only if the reassignment is | ✓ | ✓ | ✓ |
| AC5 | `GET /events/{id}/assignments` (oldest first: who, from whom, to whom, by whom, when, why). "History" on the Assignments page | ✓ | ✓ | ✓ |

Files:

- Rules: `backend/event_review/service.py` (`reassign`, `assignment_history`, the authority) and
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

### Decisions

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

### Database change

Two new nullable columns on `event_assignments` (`previous_coordinator_id`, `reason`). Run the **US12** step
in `backend/schema_changes.sql` once in the Supabase SQL Editor. Existing assignment rows stay
valid (they read as first assignments).

## US14 — Confirm Event

| AC | How | Unit | API | Functional |
|---|---|---|---|---|
| AC1 | Each booking that holds a venue must be approved (and there must be one); each equipment line reserved or fulfilled. Only the assigned coordinator | ✓ | ✓ | ✓ |
| AC2 | 409 naming every item; `GET /events/{id}/confirmation` lists them; checklist card on the Request tab | ✓ | ✓ | ✓ |
| AC3 | Status via `change_status` (US13 history) plus `events.confirmed_at` / `confirmed_by_id` | ✓ | ✓ | ✓ |
| AC4 | `messaging.event_confirmed`: organiser, Venue Staff (event holds a venue), assigned technician; not the coordinator who confirmed | ✓ | ✓ | ✓ |
| AC5 | `LOCKED_AFTER_CONFIRMATION`: every US16 detail field and the equipment request. Enforced by US16 and equipment editing, which accept only events in planning; shown on the card | ✓ | ✓ | ✓ |
| AC6 | A booking's US39 `flag` (venue unavailable) — and its US38 `reassessment` flag — are listed as outstanding | ✓ | ✓ | ✓ |
| AC7 | Only Safety Approved can be confirmed; every earlier step is listed as outstanding | ✓ | ✓ | ✓ |

Files:

- Rules: `backend/event_review/confirmation.py` (`outstanding`, `confirm`, `LOCKED_AFTER_CONFIRMATION`)
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

### Decisions

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

### Database change

Two new nullable columns on `events` (`confirmed_at`, `confirmed_by_id`). Run the **US14** step in
`backend/schema_changes.sql` once in the Supabase SQL Editor. Events confirmed earlier stay valid; their
confirmation is still in the US13 status history.

## US23 — Approve or Reject Venue Booking

| AC | How | API / unit | Functional |
|---|---|---|---|
| AC1 | All Venue Staff manage every venue (decision below) | `test_US23_AC1_*` | ✓ |
| AC2 | Card shows date and times, the hold window with setup/teardown, attendance, layout, facilities and **accessibility needs** (added) | `test_US23_AC2_*` | ✓ |
| AC3 | Existing; reason enforced by the server | `test_US23_AC3_*` | ✓ |
| AC4 | Approved keeps the venue (a clashing request can't be approved); rejected frees it | `test_US23_AC4_*` | ✓ |
| AC5 | **New:** the server marks decisions from the last 7 days (`decision_notice`); the coordinator sees "Venue booking approved / rejected (+ reason)" when their page loads | `test_US23_AC5_*` + `booking-decisions.unit.test.ts` | ✓ |
| AC6 | Existing (US41); one decision never changes the event's other bookings | `test_US23_AC6_*` | ✓ |
| AC7 | **New message:** "This tentative hold expired on … and can't be approved." (US42 makes the hold expire) | `test_US23_AC7_*` | ✓ |

### Decisions (Sprint 3)

1. **AC1 — "the venues they manage" = every venue.** ConnectSphere's Venue Staff work as one team
   for all venues, so every Venue Staff member sees every pending request. There is no
   venue-to-staff link in the data. *To confirm with the Product Owner*; if venues are later given
   individual managers, the filter belongs in `GET /bookings`.
2. **AC5 — notifications on load.** Venue Staff decide in their own browser, so a notice added
   there never reached the coordinator. The server now marks each decision for 7 days and the
   coordinator's page turns those into notifications when it loads (as US42 does for holds).
   Notifications aren't stored on the server yet (US36), so they are shown on every load within
   those 7 days rather than once.

### Fixes found while testing

- **Rejecting a request left the dialog open.** After a decision the page re-read the event, but a
  rejected booking means the event no longer holds a venue, so Venue Staff aren't allowed to read it
  (403) and the page reported an error even though the rejection was saved. The page now applies the
  saved booking from the decision's response first and treats the re-read as best-effort.
- **A refused decision** (e.g. the hold expired, or a clash) now shows the server's reason and
  refreshes the request, instead of a generic error.

- **US39's functional test TC-US39-04** picked "the notification mentioning the event"; coordinators
  now also get "Venue booking approved" for it (AC5), so its locator was narrowed to the
  "Replacement venue required" notification. Its assertions are unchanged.

Depends on **US42** (hold expiry) for AC7.

## US42 — Expire Tentative Venue Holds

| AC | Unit (rules) | API | Functional (browser) |
|---|---|---|---|
| AC1 | `test_US42_AC1_*` (unit), `[US42-AC1]` page helpers | `test_US42_AC1_*` | 3 tests |
| AC2 | `test_US42_AC2_*` | `test_US42_AC2_*` (incl. another event can then book the venue) | 1 test |
| AC3 | `test_US42_AC3_*`, `[US42-AC3]` | `test_US42_AC3_*` | 2 tests |
| AC4 | `[US42-AC4]` | `test_US42_AC4_*` (approving is refused) | 2 tests |

Files:

- Rules: `backend/bookings/hold_expiry.py` (server, the authority) and `lib/venues/hold-expiry.ts` (page display)
- Unit tests: `tests/us42_hold_expiry/unit/test_hold_expiry_rules_unit.py`, `tests/us42_hold_expiry/hold-expiry.unit.test.ts`
- API tests: `tests/us42_hold_expiry/test_hold_expiry_api.py`
- Functional tests: `tests/functional/us42-hold-expiry.spec.ts`

```bash
python -m pytest tests/us42_hold_expiry          # backend unit + API
npx vitest run tests/us42_hold_expiry            # page helpers
npx playwright test tests/functional/us42-hold-expiry.spec.ts
```

### Design decisions (agreed for Sprint 3)

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
   hold a venue (`event_requests/access.py`, US02), so `GET /bookings` also returns expired holds to Venue
   Staff, shown under "Expired holds".
8. **Campus time.** Expiries are stored in UTC and entered and shown in Singapore time (UTC+8);
   `hold_start` (start of setup) is local wall-clock time and is compared in campus time.

### Database change

New columns on `venue_bookings` (`hold_expires_at`, `hold_expiry_set_by`). SQLAlchemy only creates
missing tables, so run the **US42** step in `backend/schema_changes.sql` once in the Supabase SQL
Editor. It also gives requests that are already pending the default expiry. Bookings saved without
an expiry never lapse, so nothing breaks before the script is run.

### Related

- **US23-AC7** ("Cannot approve a tentative hold whose expiry time has passed") is satisfied by the
  same rule — an expired request is not pending, so it can't be approved — and is tested under US23.
- **CR-W7-4** also updated US19 (availability calendar) and US24 (conflict detection): both read
  holds through `venue_bookings.held_periods()`, which now ignores lapsed holds.

## US49 — Reassess Venue Bookings After an Accepted Change

| AC | How | Unit | API | Functional |
|---|---|---|---|---|
| AC1 | In the decision transaction, `arrangement_reassessment.accepted` checks every pending or approved booking with `change_reassessment.booking_problems`; the count is saved with the decision (`venue_checked`) and shown under the request | ✓ | ✓ | ✓ |
| AC2 | A booking is no longer valid when it is for another date or time than the event as reviewed, or the change introduces a US21 blocking problem it did not have: capacity, layout, accessibility, closed day, hours, unavailable period, clash with another booking. Its flag carries each reason; the coordinator sees it on the event, Venue Staff on Bookings | ✓ | ✓ | ✓ |
| AC3 | `messaging.venue_booking_reassess`, once per flagged booking, to every active Venue Staff member (one team manages every venue, US23-AC1). Nobody is told when every booking still fits | ✓ | ✓ | ✓ |
| AC4 | US14's `outstanding()` lists every open shared flag, venue, equipment or registration, so confirming is refused (409) until each is resolved | ✓ | ✓ | ✓ |

Files:

- Rule: `backend/event_changes/rules.py` (`booking_problems`), called from `backend/event_changes/reassessment.py` (`accepted`)
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

### Decisions

1. **One shared mechanism.** US49 replaces the shared service's period-only venue check with the full re-check;
   the reviewed values, flag records, notices, resolution and confirmation gate are the ones US50/US51/US45 use.
2. **Only problems the change introduces count.** Each booking is checked with the US21 rules before and after the
   change; a problem it already had (e.g. a smaller hall accepted with a US21 override) is not raised again. A
   booking for part of the event (a US41 breakout with its own attendance or layout) keeps them.
3. **Resolving a venue flag** follows the shared rules: the reviewed values are applied first; then Venue Staff or
   the coordinator record how it was resolved, once the booking is approved and for the event's period. A booking
   for the old date or time is replaced (cancel and rebook) instead.

### Database change

None of its own: the shared `arrangement_reassessments` table comes with US50/US51
(`backend/schema_changes.sql`).

## Event review code and test map

Covers **US07, US08, US10, US11**. Each criterion ID (e.g. `US10-AC2`)
appears in the name of the tests that verify it, so a requirement can be
traced straight to its tests:

```bash
npx vitest run -t "US10-AC2"      # run the tests for one criterion
npm run test:us10                 # run every test for one story
```

Boundary / edge-case tests carry a `-Bnn` suffix (e.g. `US10-AC2-B01`).

| Story | Code | Tests |
|---|---|---|
| US07 | `lib/events/review/review.ts` | `tests/unit/event-review/review.unit.test.ts` |
| US08 | `lib/events/review/clarification.ts` | `tests/unit/event-review/clarification.unit.test.ts` |
| US10 | `lib/events/review/decision.ts` | `tests/unit/event-review/decision.unit.test.ts` |
| US11 | `lib/events/review/assignment.ts` | `tests/unit/event-review/assignment.unit.test.ts` |

Shared rules live in `lib/events/review/shared.ts`; `lib/state/app-context.tsx` calls FastAPI and refreshes frontend state. Persisted decisions, role checks and notifications are enforced by the Python backend.

**Functional (end-to-end) tests** drive the real app in a browser, one file per story,
with the same criterion IDs in the test names (`npm run test:functional`,
`npx playwright test -g "US10-AC2"`; see the README's "Functional tests"):

| Story | Functional tests | Criteria checked through the UI |
|---|---|---|
| US07 | `tests/functional/us07-review-requests.spec.ts` | AC1, AC2, AC4, AC5, AC6 |
| US08 | `tests/functional/us08-clarification.spec.ts` | AC1, AC2, AC3, AC4 |
| US10 | `tests/functional/us10-approve-reject.spec.ts` | AC1, AC2, AC3, AC4, AC6 |

Rules a user can't reach through the screens — for example a second coordinator acting on
someone else's event by calling the API directly, or exact length limits — are covered by
the unit and API tests instead.

Each step is also saved by the backend (`backend/event_review/service.py`, same rules and
messages; endpoints in the README's "Event review" section), tested in
`tests/us07_us11_event_review/` (`python -m pytest tests/us07_us11_event_review`,
`npm run test:review`). The coordinator list for US11 comes from the Event
Coordinator accounts (`GET /coordinators`).

### Status flow

```
submitted ──start review──▶ under_review ──approve──▶ approved
                              │   ▲      └──reject───▶ rejected
            request clarif. / │   ┆ organiser responds
            amendment (US08)  ▼   ┆ (US09 — not in this set)
                         pending_clarification
```

### Related stories not covered here

- **US09** (organiser responds to a clarification request) moves a request from
  Pending clarification back to Under review. Until it is built, a request sent
  for clarification stays in Pending clarification.
- **US12** (reassign to another coordinator) is built on top of US11's assignment record:
  see `docs/requirements/US12_reassign_coordinator.md`. US11 itself only assigns an unassigned event.

---

## Reassessment implementation choices and interfaces

These are implementation notes, not additional ACs.

These choices are transparent, conservative, tested, and open to peer/customer review. They do not authorize automatic cancellation or stock release.

| Topic | Implemented rule |
|---|---|
| Equipment invalidity | Requested item removed; reserved quantity/period differs from reviewed values; changed technical requirements; required stock unavailable at the effective interval (existing availability algorithm, excludes this event's own hold). Only the invalid reservations are flagged. |
| Registration invalidity | Disabled while registered attendees still hold places; capacity below registered count; closing date after the event date. Equal capacity/count and equal close/event date are valid; null capacity is unlimited. |
| Venue period consistency | Active booking date/start/end must match the reviewed period. After explicit application, an active mismatching booking cannot be marked resolved; cancel and replace through the existing booking workflow. No automatic booking/time mutation. |
| Attendee impact | Actual reviewed changes to name, date, start/end, registration enablement/capacity/closing date, or venue location notify registered attendees. Purpose-only and unchanged values do not. Notification is independent of whether registration settings need a flag. No invented waitlist promotions or cancellations. |
| No structured values | Re-evaluate saved facts automatically and label the evaluation basis. Do not claim to know the semantic intent of a text proposal. UI explicitly offers structured review values and explains that acceptance retains existing fields. |
| Rework stage | Named venue only → venue planning; equipment only → equipment planning; both → combined arrangement planning, with event status Approved and an auditable safety outcome. Unnamed legacy results keep their existing status but reopen planning editors. |
| Resolve change flags | Explicitly apply a structured reviewed snapshot first; then correct/validate actual arrangements. Registration must be valid, equipment must match the actual period and be reserved (or removed and released), venues must be approved/unflagged or replaced. Evidence note is retained with user/time. |

### Interfaces

All paths are backend paths; browser uses the existing `/api` proxy and session cookie.

| Method/path | Contract |
|---|---|
| POST `/events/{id}/change-requests/{request}/decision` | Existing `{outcome,reason?}` plus optional `effective_changes`. Server identity/time, event then request locks, duplicate decision 409. Reassessment is stored under `decision.reassessment`. Rejection with reviewed values is 422. |
| POST `/events/{id}/change-requests/{request}/apply` | Assigned coordinator, no caller-supplied audit fields; apply stored accepted values separately; stale/repeated/unsafe edits 409. |
| GET `/events/{id}/reassessments` | Involved staff/owner only, no attendees. Includes flags/resolution audit, planning stage and preparation eligibility. Technicians must be assigned and see only equipment flags; venue staff see only venue flags. |
| POST `/events/{id}/reassessments/{flag}/resolve` | `{note}`; event lock, responsible-role validation, saved arrangement checks, audit and commit. Unknown/cross-event flag 404; forbidden 403; invalid/already resolved 409. |
| POST `/events/{id}/safety-check` | Existing outcome/comment plus optional `targets:[{type:"venue"\|"equipment",id}]`. Validates ownership, duplicates and approval/target incompatibility. No free-text target matching. |
| POST `/events/{id}/safety-check/request` | Existing endpoint, now also checks shared flags; event-locked transaction and existing notifications. |
| POST `/events/{id}/preparation` | Assigned coordinator, current approved safety review and no outstanding arrangements. Writes start time/user/review ID; repeated same-review calls return the same record. |
| POST `/events/{id}/confirm`, GET `/events/{id}/confirmation` | Existing US14 interfaces with new shared flags added to the same outstanding function. |


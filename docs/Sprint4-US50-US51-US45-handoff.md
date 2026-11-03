# Sprint 4: US50 / US51 / US45 readiness review

Reviewed 2026-10-30 at `cae5273` on `yangbo-sprint4-us50-us51`.
This is a code audit, not approved acceptance criteria or a completed implementation.

## Requirements source

The supplied Sprint 4 Planning URL could not be read through the available web tool:
https://app.notion.com/p/Sprint-4-Planning-25-Oct-2026-4049922d71f881b6aad3dd57bf2726e8

No complete US50, US51 or US45 acceptance criteria were found in the searched
repository text. US36's handover documents only notification integration, including
US50-AC3 and US51-AC3; it cannot establish the remaining behaviour. Obtain the
canonical stories, all ACs and the original US35 split before implementing policy.

## Existing behaviour and gaps

- `backend/event_changes.py` and `backend/main.py:review_event_change` save an
  accepted/rejected decision against a free-text proposal. Acceptance does not
  update event details, identify changed fields or initiate reassessment.
- `backend/event_updates.py` and `backend/main.py:update_event_details` provide
  separate coordinator planning edits and arrangement-impact history. Confirmed
  events are excluded, and changing equipment/date/time is refused while equipment
  lines are reserved or fulfilled. An approved-change path must be reconciled with
  these guards rather than bypassing them implicitly.
- `backend/equipment.py` already provides technician assignment, stock availability,
  interval reservations, progress changes and audit history. No accepted-change
  reassessment workflow or persistent reassessment flag was found.
- `backend/registrations.py` provides registration, waitlisting, withdrawal and FIFO
  promotion. No accepted-change reconciliation workflow or flag was found.
- `backend/messaging.py:equipment_reassess(db, event)` notifies the assigned
  technician. `attendees_affected(db, event, what_changed)` notifies registered and
  waitlisted attendees. These helpers are covered by existing US36 tests, but are
  not integrated into a US50/US51 workflow. Call in the owning transaction before
  commit, as documented in `US36_Notifications_Handover.md`.
- `backend/venue_reassessment.py` and `VenueBooking.reassessment` implement US38
  venue setup/turnaround conflicts. Their reason and reconciliation logic are
  specific to `venue_time_changed`; this is not an existing general event-change
  flag. A shared flag contract needs agreement with Chin Hui (US49) and Akhi (US44).
- `backend/login/models.py:Role` has no Safety Officer role. No safety-review model,
  decision endpoint or rework/resubmission workflow was found. US44 has notification
  helpers only; `docs/US36-functional-tests.md` explicitly records this dependency.

## Missing decisions to recover from the canonical ACs

1. US50: which accepted changes trigger reassessment, what happens to existing
   reservations/stock holds, who resolves the flag, allowed resolutions, and what
   blocks event progression until resolution.
2. US51: which changes trigger reassessment; rules for reduced capacity, registration
   disablement and changed dates/deadlines; treatment/order of registered and
   waitlisted attendees; completion and notification conditions.
3. US45: eligible safety outcomes and actors, editable fields, retained arrangements,
   affected flags, status transitions, audit requirements and resubmission rules.
4. Shared: how an accepted free-text request becomes actual approved event changes,
   and how repeat decisions/retries avoid repeated effects.
5. US44 interface: persisted review identifier/revision, outcome and feedback shape,
   authorization, pending-review state, submission/decision endpoints, and the
   contract for resubmitting corrected arrangements without retaining stale approval.

## Candidate change locations after requirements are available

- Backend: `event_changes.py`, `main.py`, `models.py`, `schemas.py`,
  `schema_changes.sql`, `equipment.py`, `registrations.py`; introduce a shared
  reassessment module only if the confirmed contracts warrant it.
- Frontend: `lib/types.ts`, `lib/state/app-context.tsx`, existing change-request,
  equipment and registration views. Exact UI files depend on the required actors
  and resolution actions.
- Tests: extend existing change-request integration, equipment, registration and
  notification suites for accepted/rejected changes, permission boundaries,
  atomic rollback, repeat requests, stock conflicts, and confirmed capacity rules.
  Add US45 tests against the agreed US44 contract rather than inventing one.

No production implementation or new acceptance tests have been added: the missing
requirements determine observable behaviour and cannot be inferred from titles.

# Backend Operations and Integration Notes

These implementation and operation notes were consolidated from the original Sprint 3/4 delivery documents. Verification counts and outstanding statements below are historical snapshots, not current sign-off. Use Notion for current DoD and the shared workbook for story-level test executions.

## US50 / US51 / US45 — implementation, review and operation

This supersedes the earlier blocked implementation snapshots in the progress log.
It records implementation choices, not additional customer ACs or a non-author sign-off.

### What changed

- US34 acceptance automatically evaluates all saved equipment reservations and registration settings in the same locked event/decision transaction. Rejection does not evaluate. Existing text-only callers remain compatible and explicitly record `basis=saved_details`; prose is never parsed into authoritative new values.
- A coordinator can supply optional typed `effective_changes` (the existing EventDetailsUpdate field names) when accepting. The decision stores the before/effective snapshots and evaluation counts/flag IDs. Acceptance does not update any event column, allocate equipment, book venues or cancel attendees. This preserves shared US34-TC01.
- Reviewed date/time changes also flag existing venue bookings whose periods differ, through the same shared service and existing Venue Staff notification. Applying a new time cannot silently keep an old booking valid; resolve after cancellation/rebooking through the existing venue APIs. This is period consistency for the new apply action, not a separate venue allocation/approval workflow.
- Applying the reviewed snapshot is a separate explicit coordinator action. Changed fields are checked for stale edits. Time/equipment edits require Technical Support to release reservations first; fulfilled items remain immutable. Applying changes invalidates any previous safety approval by returning the event to planning, with history. It cannot be done while a safety review is pending.
- `arrangement_reassessments` extends the team's Requires Reassessment mechanism to typed equipment reservation, registration settings and safety-named venue booking targets. It supports independent reasons/sources and resolution audit. Existing US38 booking JSON is preserved, not overwritten. Its flags and new shared flags feed the existing US14 outstanding check; there is no second confirmation endpoint.
- Equipment flags notify the assigned Technical Support staff **for each reservation ID**. Only registered attendees receive US51 impact notices; waitlisted/withdrawn people are not automatically included. The general notifications audience used by other stories is unchanged.
- Safety Officers can name exact venue booking/reservation IDs with either rejection or request-changes. Only valid active targets from that event are accepted; approval cannot carry rework targets. Each named arrangement is flagged, and the event returns to approved arrangement planning (earlier than the safety check). The detailed venue/equipment planning stage is derived from those recorded targets. Outcome/history is retained.
- Legacy non-approval decisions without targets remain in the existing safety rework states. Both now permit coordinator detail/equipment editing, show arrangement planning, and use the same resubmission checks. No targets are guessed from comments.
- New shared flags and existing venue reassessment flags block resubmission. Only the responsible technician resolves equipment; assigned coordinator/venue staff resolve venues; assigned coordinator resolves registration settings. A nonempty resolution note is required; saved inventory/settings checks must pass. Staff resolution is an attestation, not a replacement for the next Safety Officer review.
- The existing confirmation API requires safety approval and no outstanding arrangements. Preparation now has an explicit backend action bound to a specific approved safety review and using the same outstanding checks. Both reject direct API calls before approval; button hiding is not the security boundary. Preparation is idempotent for the same approval; it is not a new required prerequisite to confirmation.

### Implementation choices for previously unspecified rules

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
| POST `/events/{id}/safety-check` | Existing outcome/comment plus optional `targets:[{type:"venue"|"equipment",id}]`. Validates ownership, duplicates and approval/target incompatibility. No free-text target matching. |
| POST `/events/{id}/safety-check/request` | Existing endpoint, now also checks shared flags; event-locked transaction and existing notifications. |
| POST `/events/{id}/preparation` | Assigned coordinator, current approved safety review and no outstanding arrangements. Writes start time/user/review ID; repeated same-review calls return the same record. |
| POST `/events/{id}/confirm`, GET `/events/{id}/confirmation` | Existing US14 interfaces with new shared flags added to the same outstanding function. |

### Setup / schema / security

1. Existing databases must already include the team's US44/US14 schema changes from `backend/schema_changes.sql`.
2. Before starting this version against Supabase, run `backend/migrations/sprint4_yangbo_reassessment.sql` using the authorised database administrator. It creates only `arrangement_reassessments` and `event_preparations`, indexes and uniqueness; enables RLS and revokes public/anon/authenticated Data API access. The privileged FastAPI connection continues to enforce its own session roles/ownership. **Codex has not executed this DDL on the shared database.**
3. For isolated tests, SQLAlchemy creates fresh tables on temporary SQLite, never Supabase. No database reset or fixtures should be run against shared data.
4. Install the exact frontend lock file (`npm ci`) and backend test dependencies; this branch uses the repo's existing `.venv312` locally. Run normally using the existing README setup. No new secret or external service is required.
5. Rollback: stop the new app before reverting code. Retain the additive tables for audit; no destructive down migration is needed or automatically executed. Do not drop records to clear flags.

### Review/validation

- Rules: `tests/unit/safety/test_reassessment_rules.py` (US50/US51 validity boundaries).
- API: `tests/integration/test_sprint4_reassessment_workflows.py` (all three stories, actual transactions, permissions, duplicates, invalid targets, mixed validity, registered-only notifications, explicit apply and resolution). Its one deliberate notification failure injection is a rollback test, not a mocked successful workflow.
- Additional API: `test_us45_existing_venue_reassessment.py`, `test_us45_confirmation_gate.py` (existing US38/US14 interoperability).
- Functional: `tests/functional/sprint4-yangbo-reassessment.spec.ts` (4 real browser flows: US50, US51, and each US45 non-approval outcome). Given data is created through real APIs; main actions/observations through the browser. Old US34/US44 are rerun unchanged.
- Commands and exact real results, commit scope, first failures/fixes, CI and remaining DoD are in `docs/testing/reassessment-tests.md`. No local test means main merge or non-author approval has happened.

#### Core commands

```powershell
$env:TMP = (Get-Location).Path
$env:TEMP = (Get-Location).Path
.\.venv312\Scripts\python.exe -m pytest tests -q -p no:cacheprovider
$env:DATABASE_URL = 'sqlite://'
$env:JWT_SECRET = 'unit-discovery-only-secret-0123456789abcdef'
.\.venv312\Scripts\python.exe -m unittest discover -s tests/unit -t tests -q
npm test -- --reporter=dot
npm run build
$env:PYTHON = Join-Path (Get-Location).Path '.venv312\Scripts\python.exe'
$env:TC_SHARED_DB = '0'
.\node_modules\.bin\playwright.cmd test tests/functional/sprint4-yangbo-reassessment.spec.ts tests/functional/us34-review-event-changes.spec.ts tests/functional/us44-operational-safety-check.spec.ts --config playwright.config.ts --output coverage/functional/sprint4-final --reporter list
```

### Final DoD boundaries

The intended outcome is an implemented/tested PR ready for non-author review. A reviewer must assess the documented choices and approve the exact submitted revision. Main merge and build/tests on that actual main merge SHA can only be checked after merging. Neither successful local tests nor a green PR merge simulation is permission to tick those final items as already satisfied. No Notion or earlier Sprint record is changed.


## Yangbo — US25–US32 delivery and DoD evidence

PR: https://github.com/akhileshad2024-ui/SPM_G5T8/pull/36
Sources: Notion Product Backlog and Sprint 3 DoD checklist read 24 October 2026.

### Behavior

Assigned coordinator: Review queue → event → Equipment. Add/edit/remove equipment types, positive integer quantities and technical requirements; choose an active technician and submit. The request and a notification to that technician are saved atomically.

Assigned technician: Equipment → select an event. Check period-specific availability, update line status (Pending / Reserved / Unavailable / Fulfilled), quantity, notes and alternative suggestion. Reserved creates/amends the event/item reservation; Pending/Unavailable releases it; Fulfilled locks it. Status changes save a notification to the assigned coordinator. Every update has a stored actor and timestamp. Notifications survive reload and read state is persisted; active signed-in pages poll every 15 seconds.

Availability excludes maintenance and out-of-service quantities and counts peak concurrent use in half-open time intervals. Adjacent reservations do not overlap. PostgreSQL writes lock stock rows in a consistent order before checking availability and committing reservations. Fulfilled equipment cannot be changed via the generic event editor either.

US29 successful registration commits an attendee-scoped notification and an email outbox row together with the registration. Configured SMTP can deliver after the response; a retry worker handles pending/failed messages. The UI only claims the email is queued, never that it reached the inbox.

### Review fixes

- Closed the old GET /events and GET /events/{id}/history permission bypass: technicians now need the stored equipment assignment everywhere, not just on the new equipment API.
- Empty equipment requests no longer appear in the technician selector.
- Refresh canonical event details after equipment writes so quantity summaries and detail views do not show stale saved values.
- Restored the readable “Projector × 2” summary used by the pre-existing US13 browser tests. Full GitHub logs were unavailable unauthenticated, so this is a code-confirmed regression fix, not a claim that it was the only CI failure.
- Merged main through 356d6e0, retaining the new Lead role and both independent test accounts when resolving the seed-user conflict.
- Preserved the fixed registration-status locator and quoted Python executable paths for Windows paths containing spaces.
- Isolated all automated tests from developer SMTP settings.

### Verification for the revised code

- Frontend unit tests: 351 passed, 21 files.
- TypeScript: passed.
- Production `npm run build`: passed, without font mocks.
- Equipment + registration tests: 75 passed; opt-in PostgreSQL test skipped (no local PostgreSQL available).
- US27 local API performance: 1,000 historical reservations, 5 requests; measured maximum 0.0391 seconds. This verifies local API latency, not a deployed end-to-end SLA.
- Full backend regression: 1,434 tests passed and 609 subtests passed; one opt-in PostgreSQL test skipped.
- The full browser run exposed two legacy equipment-card tests that assumed all requests were displayed at once. US13/US15 now explicitly select the assigned event before inspecting its card; these updates need a fresh run.
- Revised module browser suite: 13 passed on Chromium Headless Shell 134. The full 180-test browser suite is being verified separately; GitHub uses its own installed browser version.
- SMTP delivery tests: a real SMTP connection to a local test receiver passed (no external mail sent). Adapter tests: verify TLS usage, saved recipient, message body, durable retry after transport failure and no resend after successful delivery. TLS/failure adapter tests use mocked transport; the local receiver test uses a real socket. External mailbox receipt is NOT verified.

### Run on Windows (PowerShell, repository root)

```powershell
$env:Path = (Resolve-Path ".\.venv312\Scripts").Path + ";" + $env:Path
$env:PYTHON = "python"
npm.cmd ci
npx.cmd tsc --noEmit
npm.cmd test
python -m pytest -q
npx.cmd playwright install chromium
npm.cmd run test:functional
npm.cmd run build
```

Run the FULL functional suite, including the pre-existing US13/US15 tests. Playwright resets only its throwaway SQLite database. Never run seed scripts against the shared database. Thirteen selected US25–US32 browser tests (see discovery output for the exact count) cover the module and its regressions; full suite results remain required.

### SMTP deployment

Set `SMTP_HOST`, `SMTP_FROM`, port, TLS mode and optional username/password in the backend's private environment. Do not commit credentials or paste them into chat. TLS is required by default; `SMTP_SSL=true` uses implicit TLS, otherwise STARTTLS is used. Plaintext is an explicit local-development-only option.

Start the API (which creates new tables), then run a supervised `python -m mail_worker` process from `backend`, or schedule `python -m mail_worker --once`. Without HOST/FROM the queue stays pending. Failed messages retain a diagnostic error type and are retried up to ten attempts. Check `email_outbox` for exhausted rows and correct configuration before resetting their attempt counts. Delivery is at-least-once: a worker crash after SMTP acceptance but before database commit may produce a duplicate; messages use a stable Message-ID.

Acceptance smoke check: register a test attendee whose mailbox you control in an authorised test deployment, run the worker, verify `sent_at` and actual inbox receipt. Do not claim US29 email AC complete without this evidence.

### Real PostgreSQL concurrency check (local disposable database only)

Use an existing local disposable PostgreSQL or, if Docker is installed:

```powershell
docker run --name connectsphere-dod-pg -e POSTGRES_PASSWORD=dod-local-only -e POSTGRES_DB=dod_test -p 127.0.0.1:55432:5432 -d postgres:16
$env:DOD_POSTGRES_TEST_URL = "postgresql+psycopg://postgres:dod-local-only@127.0.0.1:55432/dod_test"
python -m pytest tests/integration/test_equipment_postgres_concurrency.py -q
```

The test makes and removes a uniquely named schema, and refuses remote hosts. Two threads compete for the last unit using independent PostgreSQL sessions: required result is one success, one HTTP 409, exactly one reservation. Local Docker credentials above are disposable test values, never production credentials.

### Still required before marking Done

1. Updated full browser suite and GitHub CI must pass on this revision.
2. Real SMTP configuration/inbox receipt for US29 AC5.
3. Run the opt-in PostgreSQL concurrency test and record its output.
4. Verify US27 response time in the target deployment if the DoD requires deployment evidence.
5. A teammate must review and approve; merge into main; confirm CI on the merge commit.

These are not waived by passing unit tests. Do not mark peer review, merge, or production verification complete from this document alone.

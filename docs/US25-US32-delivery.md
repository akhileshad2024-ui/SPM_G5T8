# Yangbo — US25–US32 delivery and DoD evidence

PR: https://github.com/akhileshad2024-ui/SPM_G5T8/pull/36
Sources: Notion Product Backlog and Sprint 3 DoD checklist read 24 October 2026.

## Behavior

Assigned coordinator: Review queue → event → Equipment. Add/edit/remove equipment types, positive integer quantities and technical requirements; choose an active technician and submit. The request and a notification to that technician are saved atomically.

Assigned technician: Equipment → select an event. Check period-specific availability, update line status (Pending / Reserved / Unavailable / Fulfilled), quantity, notes and alternative suggestion. Reserved creates/amends the event/item reservation; Pending/Unavailable releases it; Fulfilled locks it. Status changes save a notification to the assigned coordinator. Every update has a stored actor and timestamp. Notifications survive reload and read state is persisted; active signed-in pages poll every 15 seconds.

Availability excludes maintenance and out-of-service quantities and counts peak concurrent use in half-open time intervals. Adjacent reservations do not overlap. PostgreSQL writes lock stock rows in a consistent order before checking availability and committing reservations. Fulfilled equipment cannot be changed via the generic event editor either.

US29 successful registration commits an attendee-scoped notification and an email outbox row together with the registration. Configured SMTP can deliver after the response; a retry worker handles pending/failed messages. The UI only claims the email is queued, never that it reached the inbox.

## Review fixes

- Closed the old GET /events and GET /events/{id}/history permission bypass: technicians now need the stored equipment assignment everywhere, not just on the new equipment API.
- Empty equipment requests no longer appear in the technician selector.
- Refresh canonical event details after equipment writes so quantity summaries and detail views do not show stale saved values.
- Restored the readable “Projector × 2” summary used by the pre-existing US13 browser tests. Full GitHub logs were unavailable unauthenticated, so this is a code-confirmed regression fix, not a claim that it was the only CI failure.
- Merged main through 356d6e0, retaining the new Lead role and both independent test accounts when resolving the seed-user conflict.
- Preserved the fixed registration-status locator and quoted Python executable paths for Windows paths containing spaces.
- Isolated all automated tests from developer SMTP settings.

## Verification for the revised code

- Frontend unit tests: 351 passed, 21 files.
- TypeScript: passed.
- Production `npm run build`: passed, without font mocks.
- Equipment + registration tests: 75 passed; opt-in PostgreSQL test skipped (no local PostgreSQL available).
- US27 local API performance: 1,000 historical reservations, 5 requests; measured maximum 0.0391 seconds. This verifies local API latency, not a deployed end-to-end SLA.
- Full backend regression: 1,434 tests passed and 609 subtests passed; one opt-in PostgreSQL test skipped.
- The full browser run exposed two legacy equipment-card tests that assumed all requests were displayed at once. US13/US15 now explicitly select the assigned event before inspecting its card; these updates need a fresh run.
- Revised module browser suite: 13 passed on Chromium Headless Shell 134. The full 180-test browser suite is being verified separately; GitHub uses its own installed browser version.
- SMTP delivery tests: a real SMTP connection to a local test receiver passed (no external mail sent). Adapter tests: verify TLS usage, saved recipient, message body, durable retry after transport failure and no resend after successful delivery. TLS/failure adapter tests use mocked transport; the local receiver test uses a real socket. External mailbox receipt is NOT verified.

## Run on Windows (PowerShell, repository root)

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

## SMTP deployment

Set `SMTP_HOST`, `SMTP_FROM`, port, TLS mode and optional username/password in the backend's private environment. Do not commit credentials or paste them into chat. TLS is required by default; `SMTP_SSL=true` uses implicit TLS, otherwise STARTTLS is used. Plaintext is an explicit local-development-only option.

Start the API (which creates new tables), then run a supervised `python -m mail_worker` process from `backend`, or schedule `python -m mail_worker --once`. Without HOST/FROM the queue stays pending. Failed messages retain a diagnostic error type and are retried up to ten attempts. Check `email_outbox` for exhausted rows and correct configuration before resetting their attempt counts. Delivery is at-least-once: a worker crash after SMTP acceptance but before database commit may produce a duplicate; messages use a stable Message-ID.

Acceptance smoke check: register a test attendee whose mailbox you control in an authorised test deployment, run the worker, verify `sent_at` and actual inbox receipt. Do not claim US29 email AC complete without this evidence.

## Real PostgreSQL concurrency check (local disposable database only)

Use an existing local disposable PostgreSQL or, if Docker is installed:

```powershell
docker run --name connectsphere-dod-pg -e POSTGRES_PASSWORD=dod-local-only -e POSTGRES_DB=dod_test -p 127.0.0.1:55432:5432 -d postgres:16
$env:DOD_POSTGRES_TEST_URL = "postgresql+psycopg://postgres:dod-local-only@127.0.0.1:55432/dod_test"
python -m pytest tests/integration/test_equipment_postgres_concurrency.py -q
```

The test makes and removes a uniquely named schema, and refuses remote hosts. Two threads compete for the last unit using independent PostgreSQL sessions: required result is one success, one HTTP 409, exactly one reservation. Local Docker credentials above are disposable test values, never production credentials.

## Still required before marking Done

1. Updated full browser suite and GitHub CI must pass on this revision.
2. Real SMTP configuration/inbox receipt for US29 AC5.
3. Run the opt-in PostgreSQL concurrency test and record its output.
4. Verify US27 response time in the target deployment if the DoD requires deployment evidence.
5. A teammate must review and approve; merge into main; confirm CI on the merge commit.

These are not waived by passing unit tests. Do not mark peer review, merge, or production verification complete from this document alone.

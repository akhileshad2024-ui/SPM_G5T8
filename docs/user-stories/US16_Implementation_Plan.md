# US16 — Update Event Details

Status: editing/history implemented; US36 notifications merged. TC02 notification acceptance is being verified; final peer review, merge and DoD remain pending.
Reviewed: 2026-10-23, Asia/Singapore. Owner: Wen Yuetong.

## Notification verification follow-up — 29 Oct 2026 (SGT)

- Current base: main `cae5273`, including US36 PR #39. Its backend already calls
  `messaging.details_changed` when an important detail changes; no new business
  module, table or AC is needed. Older pending notes below describe earlier work.
- Added blue US16-TC02 in the existing shared test record (sheet 600017), before
  its automation: Maya UI submission, Jordan assignment, Priya attendance 85→90,
  then Maya reads the notification across refresh/new login and opens its event.
  Every setup step is UI-driven. The run-start Singapore date and unique event
  name are recorded; shared IDs and catalogue size are not hard-coded.
- Extended the existing US16 Playwright file. TC01 remains a separate unchanged
  workflow; TC02 adds AC3 coverage. `TC_CASE=US16-TC02` selects it for explicit
  shared acceptance and requires Maya/Priya/Jordan credential variables.
- Type check passed. Isolated TC02 passed (10.3s; total 15.5s). An earlier command
  failed before test execution because a relative Python path was resolved from
  backend; the absolute interpreter path fixed that environment issue.
- Live DB read-only checks confirmed existing notifications, event_detail_changes
  and email_outbox columns, plus the three active/unlocked test accounts. No SQL
  setup, seed, reset or shared cleanup is required. Shared acceptance and full
  regression are pending; no new yellow execution or overall Done is claimed yet.
- Unit/API integration evidence already covers recipient selection and ordinary
  edits. This UI TC proves the organiser journey; it does not claim every staff
  recipient/arrangement scenario was exercised through a browser.
- Follow-up review found TC01's blue setup still described coordinator self-
  assignment. Its steps 8–10 now match Lead assignment and both US16 tests use
  Jordan's existing reusable account. Prior yellow records remain unchanged;
  the revised shared procedure is not treated as already executed. Equipment
  checks now cover every displayed catalogue item rather than assuming five.
- Added one real-route integration case for affected organiser/assigned technician/
  Venue Staff recipients, exclusion of unrelated users and no duplicate notice
  on an identical save. All ten US16 integration tests passed.
- PR checkpoint: unittest discovery 449; final full backend 1518 passed + 609
  subtests, one disposable-PostgreSQL-only case skipped; frontend 361 passed.
  Full Playwright 194 passed, one HTTPS-only case skipped (6.2m). After the final
  TC01 setup correction both US16 tests passed again (19.7s); unchanged journeys
  reuse that full run. Type check and production build passed.
- Scoped event_updates coverage remains 100%: 17 statements and six branch
  outcomes. Overall measured backend coverage is about 98%; frontend statement
  17.34% and branch 19.64%. These are separate scopes, not project-wide 100%.
  Existing coverage exclusions/skips still need release-level review.

## Approved requirements

1. The assigned Event Coordinator can update relevant event information during planning.
2. Important changes retain what changed, who changed it and when.
3. Significant changes notify affected users.
4. Ordinary edits are distinguished from changes that may affect existing arrangements.

Source: the approved US16 card in the product backlog. Original/revised wording
and evidence are in Change Log, Product Backlog Changes, rows 39–45.

## Small implementation boundaries

These are implementation decisions, not additional customer requirements:

| File / boundary | Responsibility | Requirement |
| --- | --- | --- |
| `backend/event_updates.py` (new) | Session-based assigned-coordinator check; apply only event-detail fields; identify actual changes and arrangement-sensitive fields | AC1, AC4 |
| `backend/models.py` | Add EventDetailChange, separate from status/venue history | AC2 |
| `backend/schemas.py`, `backend/main.py` | Partial detail-update and history endpoints; save event and history atomically | AC1, AC2 |
| `lib/types.ts`, `lib/state/app-context.tsx` | Shared input/history types and call FastAPI; never treat view permissions as edit permissions | AC1 |
| `components/queue/EventDetailsEditor.tsx` (new) | Small labelled form; show ordinary/arrangement-impact distinction; prevent repeated pending saves | AC1, AC4 |
| Existing Request / Activity tabs | Open editor and show persisted detail-change history | AC1, AC2 |
| `tests/unit/event_request/test_event_updates.py` (new) | Module rules: assignment, supported fields, changed-field classification, unchanged input | AC1, AC4 |
| `tests/integration/test_event_updates_integration.py` (new) | FastAPI session → SQLAlchemy → isolated test DB; persistence, history atomicity, denied cross-event edits | AC1, AC2 |
| `tests/functional/us16-update-event-details.spec.ts` (new) | Execute the same complete UI procedure and exact inputs as US16-TC01 | AC1, AC2, AC4 |

Keep the existing organiser draft endpoint unchanged. Do not grant edits to
assignment, status, organiser/coordinator IDs, booking decisions or safety decisions.
Do not implement the full US33/US34 request/decision workflow or all of US36.

Planning-status scope is Submitted, Under Review, Pending Clarification and Approved.
Editable fields are name, purpose, type, attendance, date/time, venue requirements,
catalogue equipment requirements and registration settings. These are implementation
boundaries for the existing event detail fields, not a new customer field/status matrix.
Do not open direct confirmed-event editing based on removal of the original AC3.
The G3 clarification on confirmed locking is not established as a G5 answer.

For the initial TC, use an assigned Under Review event with no arrangements.
Purpose text is edited as an ordinary correction in that test context. Attendance
is arrangement-sensitive, as explicitly named in the briefing/instructions.
That distinction does not mean every purpose edit in every context is harmless.
An impact warning must not be represented as automatic booking re-evaluation.

## Database approval gate

Copyable SQL was supplied in chat at Wen's request; no separate SQL file.
Wen reported successful execution. Codex subsequently performed read-only inspection
and confirmed all six columns and matching types on the existing Supabase DB.
No schema SQL was executed by Codex. The earlier proposal file was removed.
One new history table; reuse `public.events` for the actual event details.
Do not add a new event-request table, notification table or new status.

The history payload stores only changed field names and their resulting values.
It does not impose a requirement to store every old/new value pair.
Keep event and history writes in one transaction; no client-supplied actor/time.
RLS and revoked Data API access keep this private to the backend. The existing
FastAPI database connection must be verified to have the intended DB privileges.
Application session permissions still need enforcement in FastAPI.

IMPORTANT: `backend/main.py` calls `Base.metadata.create_all()` on import.
The new mapped table was added only after Wen created it and inspection confirmed
its shape. On future environments, approve schema deployment before app startup;
startup itself can otherwise create missing tables.

## Notifications and completion

AC3 remains required and depends on persistent recipient-scoped notification
delivery (US36). The current browser-memory notification list is insufficient.
Do not claim a local toast or mock notification as end-to-end acceptance.
US16-TC01 intentionally covers editing, history and ordinary/significant distinction,
not AC3 delivery. Design the dependent notification TC when its agreed integration
contract is available; do not mark all US16 AC complete before that verification.

## Verification and records

- Shared Sheet: create the blue US16-TC01 specification before development.
- Keep planned UI names clearly provisional until checked against the actual UI.
- Create Playwright after implementation; reconcile every numbered UI action,
  input and checkpoint with the Sheet before executing either version.
- Shared acceptance: authorised coursework accounts, existing DB, one worker,
  no retries, no seed/reset/cleanup. Ordinary CI remains isolated regression.
- Append yellow records only after an actual TC execution. Unit/API test runs
  below are not TC executions and do not populate the yellow TC record.
- Aim for 100% statement and branch coverage of the changed business module;
  report this scope, not project-wide coverage.
- Run focused tests, necessary regression, type check and build at milestones.
- Commit coherent development stages; do not push or create/merge a PR automatically.
- Check sprint DoD only after review/merge and the merge-commit CI are verified,
  following the user's latest workflow. No DoD boxes are checked at this stage.

## Core implementation verification (pre-browser milestone)

- Python: 38 focused unit/integration cases passed using isolated SQLite.
- First collection attempt found a missing backend import path in the new unit
  file; corrected it. Next run found nested optional equipment defaults omitted
  by recursive exclude_unset; fixed input serialisation without weakening the test.
- Scoped `backend/event_updates.py`: 19 statements and 6 branch outcomes, 100%
  measured coverage; not project-wide coverage. HTML: coverage/us16/html/index.html.
- TypeScript type check passed after editor/history/API wiring.
- Playwright US16-TC01 created; acceptance config selects it with TC_STORY=US16.
- Blue shared TC revised to the implemented labels and exact sequence before
  browser execution. AC3 and overall story completion remain pending.

## Verification milestone (2026-10-23 / 24 SGT)

- Implementation commit: `e7c2c54` on `spring3-us16-yuetong`; not pushed.
- Shared-database US16-TC01 run 1 passed, Chromium, 26.2 seconds total
  (25.6 seconds test time), 2026-10-23 23:59 SGT. Generated EVENT_ID=34.
  This was Codex (Playwright), not a manual Wen execution.
- All 22 TC steps were followed: UI submission/assignment, ordinary purpose
  correction, attendance 85→90 with impact warning, persistent actor/value/time
  history, refresh, organiser re-login/read-only verification, final sign-out.
  No API fixture, seed, reset, cleanup or automatic retry. Shared record preserved.
- Archived browser evidence: `coverage/us16/acceptance-run1/report/index.html`
  and `coverage/us16/acceptance-run1/results`. Actual result appended to the
  existing yellow US16-TC01 record; no prior record overwritten.
- Scoped backend tests: 29 unit cases + 9 integration cases passed.
- Scoped coverage: 19 statements, 6 branch outcomes, all covered (100%);
  HTML `coverage/us16/html/index.html`, JSON `coverage/us16/coverage.json`.
  This is NOT 100% repository, API-file or frontend coverage.
- Frontend regression: 296 tests / 18 files passed.
- TypeScript `npx tsc --noEmit` passed; `npm run build` passed. Existing multiple
  lockfile/workspace-root warning remains; no unrelated config changes made.
- First full backend run: 1049 passed, 462 subtests passed, one failure in
  US31 withdrawal deadline test while the suite crossed Singapore midnight.
  That test fixes TODAY=campus_today() at module import, whereas the API checks
  the current day at request time. This is consistent with a stale date at the
  midnight boundary. No registration production/test code was changed.
- The failed deadline case passed on a fresh isolated run; the full backend
  rerun after midnight passed: 1050 tests + 462 subtests, 32.35 seconds.
- CI's normal Playwright testMatch includes the new US16 spec, using isolated
  fixture passwords/data. That CI regression is distinct from the shared run
  above; remote CI/peer review/merge have not been performed by this work.
- AC3 persistent affected-user notifications remains unimplemented/unverified
  until the US36 delivery boundary is integrated. US16 is NOT marked Done.

The standalone SQL proposal file was removed at Wen's request; the SQL was
provided directly in chat. Preserve reproducible schema deployment instructions
in the team's normal migration workflow before another environment is deployed.

## PR #28 CI import fix (2026-10-24 SGT)

- Initial run: https://github.com/akhileshad2024-ui/SPM_G5T8/actions/runs/40046460773
  Backend failed at `python -m unittest discover -s tests/unit -v`, before pytest
  or coverage could execute. Frontend and functional jobs succeeded.
- Exact error: importing US16's unit test imported event_updates → login.models
  → database, which raised `DATABASE_URL is not set` on the clean CI runner.
  Local backend/.env and pytest's conftest had masked the import dependency.
- Fix: remove ORM role/status imports from the pure event_updates module and
  its unit tests. Compare stored string values (the existing ORM enums inherit
  from str); permissions and planning scope stay unchanged. No schema, secrets,
  workflow bypass, skipped tests, business AC or other story code changed.
- Add a US16 technical regression test that imports the module in a fresh
  subprocess with empty database/auth settings and asserts no database/models
  modules were imported. This is not a new customer AC or a new manual TC.
- Focused verification: 39 tests passed; updated module coverage remains 100%
  for 17 statements and 6 branch outcomes (two import statements removed).
- Reproduce CI unit discovery with DATABASE_URL/JWT_SECRET unset, not set to
  empty strings: existing venue tests intentionally use setdefault for their
  SQLite fixture. The empty-string full-discovery diagnostic failed in that
  existing venue fixture; it is not the GitHub runner's unset environment and
  no venue code was modified.
- Remote rerun verification is pending publication of this fix to the same PR.
  Shared TC01 was not rerun; do not append a fictional yellow execution record.
- Local CI-equivalent unit discovery: 251 tests passed with database/auth
  variables unset. Full backend regression: 1051 tests + 462 subtests passed
  in 48.90 seconds, including ORM-backed API permission/persistence coverage.

## Merge main into US16 (2026-10-24 SGT)

- Base integrated: origin/main `305f0fd`; destination: spring3-us16-yuetong.
  No merge into main and no changes to the separate US33 branch.
- Resolve the single textual conflict in backend/main.py imports by preserving
  both event_updates (US16) and venue_unavailability (US39). Keep main's US39,
  US41 and functional-test updates; do not choose an entire file from one side.
- Inspect US16 state updates: spreading the existing event preserves its
  bookings collection; eventFromApi does not replace that field. No additional
  booking logic change was needed for this conflict resolution.
- Post-merge checks: unit discovery 284 passed; full backend 1104 tests and
  474 subtests passed; frontend 296 passed; TypeScript and production build passed.
  No unresolved conflict paths or whitespace errors. Browser functional suite
  was not rerun locally for this merge; remote CI must verify the new merge SHA.
- This does not implement AC3 notifications or TC02. PR approval, remote checks,
  merge into main and final DoD remain separate pending actions.

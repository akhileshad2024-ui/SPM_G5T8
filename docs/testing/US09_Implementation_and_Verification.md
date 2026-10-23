# US09 implementation and verification

## Approved scope

The organiser views outstanding questions and saves a response with the event.
The assigned coordinator reads it and explicitly resumes review. A response does
not directly edit event details, automatically resume review, or send a dedicated
notification. Original AC1 is retained, AC2/AC5 removed, AC3/AC4 rewritten.

- [Approved Story Card](https://app.notion.com/p/3e19922d71f881b29bdef4797725bb80)
- [Backlog change record, rows 29–34](https://docs.google.com/spreadsheets/d/1aHLZDqpS9rIw5dZnVRdMgl5PbkAKtWyXl5YbQbM2qSc/edit#gid=1801879424&range=A29:N34)
- [TC specification and actual executions US09-TC01](https://docs.google.com/spreadsheets/d/1oFFQeaXos2mdzwWmufojRhmvWCXHESTP1bxHzSEaUFw/edit#gid=600009)

## File responsibilities

| File | Responsibility and traceability |
|---|---|
| `backend/event_review.py` | AC2: save a trimmed reply using session identity; preserve prior answered rounds. AC3: validate assigned coordinator and explicitly resume review. Existing US08 opens questions; US13 records the resumed status. |
| `backend/schemas.py` | Only reply text is accepted; client-supplied identity/event fields are rejected. The existing review-note size limit is a technical convention, not a new AC. |
| `backend/main.py` | Authenticated POST `/events/{id}/clarification-response` and `/events/{id}/resume-review`; reuse the current transaction/error handler. |
| `lib/types.ts` | Shared question, reply and earlier-round data shape. No duplicate business type file. |
| `lib/events/request/api.ts` | API data reuses the shared clarification type, including reply/history. |
| `lib/state/app-context.tsx` | Call FastAPI, display errors and replace local event data only after successful saving. No new notification. |
| `components/ui/ClarificationThread.tsx` | AC1/AC2: shared question/reply display; organiser reply form with a pending-click guard. |
| `app/(dashboard)/my-events/[id]/page.tsx` | Add the conversation to the existing organiser View page. |
| `components/queue/tabs/RequestTab.tsx` | AC3: coordinator sees the same retained conversation. |
| `components/queue/EventWorkspace.tsx` | AC3: explicit Resume review action after a saved reply. |

## Test responsibilities

- `tests/us09_clarification/test_event_review_unit.py`: direct module rules with
  simple event objects and mocked database operations. Tests normal replies,
  ownership, wrong status, empty/oversized text, duplicate replies, authorised
  resume and preservation across rounds. Three separately named shared-module
  regression tests protect existing review/assignment guards, not new US09 AC.
- `tests/us09_clarification/test_clarification_api_integration.py`: real FastAPI,
  authenticated cookies, SQLAlchemy and disposable SQLite. Checks persistence
  across sessions, coordinator visibility/resume, status history, unauthorised
  users, malformed payloads, duplicates and unchanged event details.
- `tests/unit/event-review/clarification-thread.unit.test.ts`: five React
  server-render unit tests for the question, role-specific form visibility,
  empty-response button state, saved replies/history and amendment heading.
  These are not browser-interaction or manual acceptance executions.
- `tests/functional/us09-respond-clarification.spec.ts`: full numbered browser
  workflow for US09-TC01, including wizard submission, assignment, asking the
  question, account switching, response saving, refresh/re-login and coordinator
  resume. No API fixture replaces the written UI steps. A separate amendment
  variant is regression evidence, not a second execution of TC01.
- `playwright.acceptance.config.ts`: explicit opt-in for the existing local app
  and its `backend/.env` database. Uses authorised Sheet passwords supplied via
  environment, one worker and no automatic retries. Does not start/reset/seed a
  database or change normal CI configuration.

## Database and manual test

Reuse `events.clarification` JSON. The latest question contains an optional
`response` object; previous answered rounds are retained in `history`. Assign a
new JSON object on save so SQLAlchemy detects it. No migration or setup SQL is
needed. Earlier automated tests used disposable SQLite. Wen subsequently
authorised TC acceptance runs against the existing database; these created
events 28–33 through the browser. No schema changes, resets, deletions or direct
SQL data writes were performed.

The TC was initially written for manual execution. Wen subsequently selected
Playwright as the default TC executor, without a duplicate manual run unless
course/team rules require it. The blue specification identifies automation and
uses the current `Wheelchair Access` option (the old `Step-free access` label
was unavailable). Yellow groups preserve actual results under `Codex
(Playwright)`, not Wen. Peer-review/merge/CI checks remain pending.

## Reproduce verification

Step-by-step alignment audit (23 October 2026): synchronised Basics input order,
explicit selected-option/wait instructions, exact organiser/question/response
checks and attendance/date/time label values. Moved the no-extra-event count
check to the re-login list in both TC and script, where a human can observe it;
added the same Request tab click. Generated IDs/timestamps vary by run, but the
specified actions and expected business outcomes are shared by both executors.

Run 5 was blocked before event creation: GET `/events` returned 500 with
`psycopg.errors.DuplicatePreparedStatement`. The configured Supabase shared
transaction pooler uses port 6543, while Psycopg auto-prepare was still enabled.
The fix in `backend/database.py` supplies `prepare_threshold=None` only for
PostgreSQL/Psycopg on that shared transaction endpoint. SQLite, other drivers,
direct and session-mode connections retain their defaults. Parameterised SQL
is retained; no schema, permission or credential change is involved.

Sources: [Supabase pooling](https://supabase.com/docs/guides/database/connecting-to-postgres#transaction-mode-limitations)
and [Psycopg preparation](https://www.psycopg.org/psycopg3/docs/advanced/prepare.html).
Verification: 24 read-only parameterised SELECTs across transaction boundaries
passed; actual connections reported `prepare_threshold=None`. Seven pure unit
cases in `tests/unit/database/test_connection_options.py` check this selection.
These are infrastructure regression tests, not new US09 AC.

Run 6/event 32 reached the visible question but its exact-text locator omitted
the displayed author prefix. Corrected the test to match the full author/message
line without weakening the text check or changing product UI. Run 7/event 33
then passed the complete aligned TC. HTTP errors now surface directly rather
than waiting for a successful response until timeout. Earlier records remain.

Verified on 23 October 2026 (SGT):

- Final US09 Python suite: 32 passing cases (19 unit, 13 integration).
- Backend regression: 1004 tests and 462 subtests passed. One final shared-guard
  unit test was then added; the final 32-case US09 suite passed afterward.
- After the pooler fix: 39 focused Python cases passed (7 connection options +
  32 US09). Full backend regression: 1012 tests and 462 subtests passed in
  31.96 seconds. TypeScript and `git diff --check` passed.
- Frontend regression: 296 tests across 18 files passed, including five new
  US09 presentation unit tests.
- Type check and Next.js production build passed.
- Shared `backend/event_review.py`: 96/96 statements, 40/40 branch outcomes,
  measured using combined backend regression and final US09 focused coverage.
  This is module coverage, not entire-backend or frontend 100% coverage.
- Reports: `coverage/us09-backend/index.html` and
  `coverage/us09-backend/coverage.json` (generated/ignored artifacts).
- Earlier browser regression: two API-prepared clarification/amendment cases
  passed in 18.6 seconds on disposable SQLite. This measured the old test
  version, not the subsequently expanded full-UI TC.
- Earlier full shared-database US09-TC01: 1 passed in 25.1 seconds (test 24.6 seconds),
  EVENT_ID=31, at approximately 22:11 SGT. Used the written Maya/Priya accounts,
  event name, 2026-11-20 date and specified inputs. Tested every UI phase;
  starting services and appending records are executor preparation/reporting.
- Failed shared runs retained: run 1/event 28 timed out during account switching;
  run 2/event 29 matched queue children as well as the button; run 3/event 30
  captured the baseline before existing rows loaded. Fixed test waits/selectors;
  no production fix was needed for these failures.
- Latest aligned TC: run 7, EVENT_ID=33, 1 passed in 26.6 seconds (test 26.1
  seconds), approximately 22:32 SGT. Same written accounts, inputs, ordered UI
  actions and visible checkpoints; no API fixture replaces TC steps.
- Acceptance evidence: `coverage/acceptance-2026-10-23-run1/` through `run7/`.
  Latest HTML: `coverage/acceptance-2026-10-23-run7/report/index.html`.
  All seven yellow execution groups are retained in the shared TC Sheet.
- Existing environment warnings: npm reported 8 dependency vulnerabilities
  (3 moderate, 4 high, 1 critical); dependencies were installed from the existing
  lockfile, not upgraded. Build warned about multiple workspace lockfiles.

No manual Pass, peer review, remote CI, push, PR or merge is claimed by this
record. Local milestone commits are identified by Git history; they do not
mean the Story has been reviewed or merged.

From the project root, using the existing virtual environment:

```bash
.venv/bin/python -m pytest tests/us09_clarification -q
TZ=UTC .venv/bin/python -m coverage run --branch --source=backend -m pytest tests -q
.venv/bin/python -m coverage report --include='backend/event_review.py' --show-missing
.venv/bin/python -m coverage html -d coverage/us09-backend
npm test
npx tsc --noEmit
npm run build
PYTHON="$PWD/.venv/bin/python" npm run test:functional -- tests/functional/us09-respond-clarification.spec.ts

# Shared TC: start existing app first; set TC_MAYA_PASSWORD and TC_PRIYA_PASSWORD
# in a second terminal from the authorised Sheet credentials (do not commit them).
npm run dev:all
# In that second terminal:
TC_SHARED_DB=1 npx playwright test --config=playwright.acceptance.config.ts
```

The HTML command reports all measured backend files; inspect `event_review.py`
for the shared review-module percentage. Never describe that scope as whole-
project 100%. Identify automated TC results by their actual automated executor.

The Playwright file is added to the existing functional-test discovery pattern.
The current `.github/workflows/tests.yml` already has a `functional` job that
installs Chromium, runs `npm run test:functional`, and uploads
`coverage/functional/` reports. The two new cases will be included when this
branch is pushed and that workflow is triggered; no CI configuration was changed.

Additional validation: TypeScript and `git diff --check` passed after expanding
the full UI test. Ordinary CI retains its disposable SQLite fixture passwords;
it is regression evidence, not execution against the shared TC environment.
The shared acceptance configuration is explicit and is never used by normal CI.

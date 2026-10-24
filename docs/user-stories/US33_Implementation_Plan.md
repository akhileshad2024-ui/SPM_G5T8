# US33 — Request Event Changes

## Requirements review (2026-10-24 SGT)

Wen approved the proposed review by replying “继续”. The original Story is
retained. Original AC1/AC4/AC5 are rewritten; original AC2's unspecified
field/status matrix and AC3's mandatory separate reason are removed.

- [Canonical Story and approved AC](https://app.notion.com/p/3e19922d71f881b29bdef4797725bb80)
- [Original wording, evidence and reasons: Change Log rows 50–55](https://docs.google.com/spreadsheets/d/1aHLZDqpS9rIw5dZnVRdMgl5PbkAKtWyXl5YbQbM2qSc/edit#gid=1801879424&range=A50:N55)
- [Implementation/TC design records: rows 56–57](https://docs.google.com/spreadsheets/d/1aHLZDqpS9rIw5dZnVRdMgl5PbkAKtWyXl5YbQbM2qSc/edit#gid=1801879424&range=A56:N57)
- [US33-TC01 draft](https://docs.google.com/spreadsheets/d/1oFFQeaXos2mdzwWmufojRhmvWCXHESTP1bxHzSEaUFw/edit#gid=600033)

Evidence: Week 1 Customer Briefing, Event Change Requests / Notifications /
Activity History; Week 4 Project Instructions, Event Change Requests / access
control / visible review outcomes; current-section teacher Q5: the organiser
requests a change and the coordinator reviews and decides it. Week 1 explicitly
includes requests after submission or confirmation. No source specifies a
mandatory separate reason or a status-by-field permission matrix.

## Smallest implementation boundary — original proposal

| Responsibility | Planned location | AC / purpose |
| --- | --- | --- |
| Pure request rules | `backend/event_changes.py` | AC1/AC2: own event, proposed text, no direct event mutation; no ORM/config imports |
| Persistence and session authorisation | Existing `backend/models.py`, `schemas.py`, `main.py` | AC1–AC3: save/list proposals and existing review outcomes; actor comes from session |
| Organiser actions and saved list | Existing change modal, shared context/types, event detail view | AC1–AC3: reuse free-text request; display persisted applications |
| Module unit tests | `tests/unit/event_request/test_event_changes.py` | Explain each pure rule and its AC; importable without DATABASE_URL |
| API/database integration | `tests/integration/test_event_changes_integration.py` | Real FastAPI/session/SQLAlchemy; ownership, persistence, event unchanged, failure rollback |
| Executor-neutral UI acceptance | `tests/functional/us33-request-event-changes.spec.ts` | Exact approved TC accounts, inputs, UI actions and expected results |

Inspected starting point: `lib/state/app-context.tsx` handles `m.kind ===
"change"` by setting event status to `under_review`, setting `changeNote`, and
creating a browser-memory notification. This is not persisted request handling.
Replace only that path; do not change review, drafts, bookings or teammate work.

One proposed table, `public.event_change_requests`, references existing events
and users. Proposed columns: id, event_id, requested_by_id, requested_at,
proposed_changes (text), status (technical initial value `pending`), nullable
decision JSON for recorded review outcomes. Do not add drafts/event_requests
tables or overload clarification/status-history JSON. Do not invent automatic
event-status changes, decisions, booking reassessment or notification success.

The SQL proposal is in the TC's Pre-conditions and chat, not a separate SQL file.
It requires approval before execution or adding a mapped model: the existing
backend runs `Base.metadata.create_all` at startup. RLS and revoked Data API
grants protect the new private table; existing privileged backend access still
requires explicit session role/ownership checks. No auth.uid() policy is assumed
for this project's integer users/custom FastAPI authentication.

## Pre-development stage status (historical)

- Notion approved wording updated and read back; only US33 changed.
- Change Log rows 50–57 written and read back.
- US33-TC01 copied from the shared blue/yellow template. Sixteen numbered steps
  cover login, fresh UI event creation, request, unchanged event details,
  refresh/re-login and sign-out. Planned controls are explicitly DRAFT.
- TC content and blank yellow execution fields verified through Sheets API.
  Chrome is signed out of Sheets, so Google-rendered visual verification could
  not be completed; formatting metadata retains blue/yellow, top alignment and
  wrapping. No successful visual review is claimed.
- No production code, test code or database schema changed. No US33 tests run.

## Database verification and original next step (historical)

### Shared database prerequisite verified (2026-10-24 SGT)

After Wen reported successful execution of the supplied SQL, Codex inspected the
actual Supabase project `frpmzwjpdcprvstoairm` using read-only catalogue queries.
The seven columns, primary key, two foreign keys, nonblank-proposal check and
two proposed indexes are present. RLS is enabled. Table and identity-sequence
ACLs grant `postgres` and `service_role`, not PUBLIC/anon/authenticated.
This verifies the schema/security prerequisite, not application behaviour or
backend-session authorisation. Codex did not execute DDL or write test records.
The proposal/setup descriptions above are historical pre-approval records.

Schema creation is now confirmed; next implement and run focused unit/API tests,
scoped statement/branch coverage, matching Playwright and relevant regression.
Run the actual clean-environment CI unit-discovery command as well as pytest,
then type check/build before push. Keep passwords out of source control.

TC01 covers the submitted-event application and persisted pre-decision list,
not the entire story. Still verify the confirmed-event path and design/execute
the remaining matching TC/Playwright checks. US34 supplies review decisions;
US36 supplies significant-change notifications. Integrate those boundaries and
verify outcome visibility/recipient isolation rather than inventing a local
notification or decision. All outstanding items are recorded under US33 in the
[Sprint 3 DoD](https://app.notion.com/p/3f89922d71f881df91e0e80b7f7ff864), not in
the product-backlog card. All DoD boxes remain unchecked until the final review
after peer approval, merge and passing merge-commit CI.

## Implementation milestone (2026-10-24 SGT)

Implemented `event_changes.prepare_request`, the approved table mapping and
strict input/response schemas. POST saves a proposal with session identity;
GET allows the owner or currently assigned coordinator to read proposals and
existing outcomes. Neither endpoint edits event information/status. Existing
submitted/planning/confirmed stages accept proposals; Draft, Rejected and
Cancelled are outside this implementation's active request workflow, not a
new status-by-field permissions matrix. The backend still independently checks
role and ownership even though the modal is an organiser UI action.

The existing change modal now calls FastAPI instead of mutating browser event
state. A synchronous lock and disabled submit/text controls protect pending
saves; failed saves retain the text and release the lock. The new small
`components/my-events/ChangeRequests.tsx` displays saved proposals on the detail
page, including a recorded decision reason when present. There is no approval
endpoint or invented notification. US34/US36 are not implemented by this change.

Verification:

- Five module unit tests plus seven real API/database integration tests passed:
  12 tests and 14 subtests. Tests verify ownership/role, active/confirmed scope,
  text-only proposals, persistence, unchanged event, strict session identity,
  existing review-outcome serialization and import without database env.
- Scoped `backend/event_changes.py`: 13 statements, 6 branch outcomes, 100%.
  Reports: `coverage/us33/coverage.json` and `coverage/us33/html/index.html`.
  This is not whole-project, API-route or frontend 100% coverage.
- First coverage command used an incorrect source path and collected no data;
  rerun with `--source=event_changes` produced the valid report above. The
  accidentally modified root `.coverage` was restored to its clean starting
  version; US33 evidence uses its separate coverage data file.
- CI-style unit discovery without DATABASE_URL/JWT_SECRET: 289 tests passed.
- Full backend regression: 1,077 tests and 488 subtests passed (55.18 seconds).
- Frontend Vitest coverage run: 296 tests / 18 files passed. Repository frontend
  coverage remains 16.81% statements / 20.58% branches, not 100%.
- Type check, production build and diff whitespace check passed. Existing
  multiple-lockfile workspace warning remains unchanged.
- Matching Playwright file created; normal functional CI discovers it. Isolated
  UI regression passed in 22.7 seconds (browser case 8.6 seconds), EVENT_ID=1,
  Request #1 in the throwaway SQLite DB, not the shared Supabase DB.
  Report: `coverage/functional/report/index.html`. Initial sandbox port binding
  failed before test execution; authorised local-port rerun passed.
- Shared acceptance config supports `TC_STORY=US33`, one worker/no retries,
  TC_SHARED_DB=1 and locally supplied TC_MAYA_PASSWORD. It does not seed/reset.

At that milestone, the next step was to reconcile the draft blue TC setup/control descriptions with
this implementation, execute it against the existing app/Supabase and append
only an actual matching run to yellow. Current yellow fields remain blank.
Confirmed-event API coverage is present; the remaining confirmed UI path,
US34 decision UI integration and US36 notification integration still need their
appropriate matching TC/Playwright and boundary verification. No whole-story
Done, shared TC Pass, remote CI, peer approval or merge is claimed.

## Shared acceptance milestone (2026-10-24 SGT)

Before execution, the canonical blue US33-TC01 was reconciled with implemented
controls and the existing Playwright sequence. Removed DRAFT/planned wording;
setup now states the table is already created/verified, no further SQL is
required, and documents the exact opt-in command. Exact accounts, inputs and
sixteen UI steps remain unchanged. The backend OpenAPI included the US33 route.
Read-only DB baseline: 21 Maya events, zero change requests; account active and
unlocked. No credentials were added to repository files.

| Execution | SGT end time | Actual result | Evidence |
| --- | --- | --- | --- |
| Run 1 | 10:31:42 | Blocked at login; Playwright failed after 120 seconds waiting for the email input. Blank page; trace shows Next JavaScript/CSS404. No credentials entered or records created; read-only counts remained21/0. | `coverage/us33/acceptance-run1/report/index.html`, results trace/screenshot |
| Run 2 | 10:34:53 | Pass, about1.3min; EVENT_ID=35, CHANGE_REQUEST_ID=1. Same request after refresh/new login, event Submitted/attendance85 unchanged, date/time/name/purpose unchanged; signed out. | `coverage/us33/acceptance-run2/report/index.html`, result attachment |

Diagnosed the missing development assets after earlier build/test runs shared
the active development server's `.next` directory. Restarted only this project's
identified `dev-all` process; no cache deletion, source change or SQL mutation.
Verified login/main JavaScript returned200 before the controlled second run.
No automatic retries, seed, reset or cleanup. Existing services were left
running for Wen. This was environment restoration, not a US33 business-rule fix.

Read-only post-run Supabase verification: event35 is submitted, attendance85,
2026-11-20 18:00–21:00; exactly one pending proposal with the specified text,
requester equals event organiser and decision is null. Maya events21→22.
Only the UI execution created the new event/request; Codex ran no SQL writes.

Both yellow groups are retained in the shared TC Sheet (Run1 Blocked, Run2
Pass). The first run's timestamp was refined to its actual trace end rather
than the later recording time. Run2 uses the runner's `.last-run.json` finish
timestamp. Change Log row59 records reconciliation, the blocker/restoration and
actual results. Sprint3 DoD Pending updated; no DoD boxes checked. TC/Sheet
content and formatting verified via API; native visual fit is not newly claimed.

Future local verification: do not run production Build or a second Next dev
instance against the same `.next` directory as an active dev server. Complete
the isolated verification first, then restore/check the intended acceptance
server and its assets before a shared run. Do not treat HTTP200 HTML alone as
proof the client application is ready. No unchanged full suites were rerun for
this record-only milestone; implementation/regression evidence above remains
for193832a.

### Current remaining scope

- Confirmed-event UI path still needs matching TC/Playwright and execution;
  confirmed permission is already covered by backend integration tests.
- US34 decision/outcome UI and US36 significant-change notification integration
  remain pending, with their corresponding acceptance/boundary verification.
- Peer review, remote CI, merge and green merge-commit CI precede final DoD.
- Whole US33 is not Done; TC01's submitted-event workflow is verified.

### Dependency check and workflow maintenance (2026-10-24 SGT)

Read-only inspection found zero Confirmed events for Maya. Latest fetched main
ad6928f still has no persistent confirmation endpoint; EventWorkspace explicitly
disables confirmation for stored events pending US14. The confirmed UI acceptance
path therefore depends on US14 or separately approved test-fixture preparation.
No shared fixture was created and no event status was changed for this check.

The personal requirements-first-scrum skill now retains all nine delivery gates
with milestone test frequency and canonical record ownership; validated with
skill-creator's quick validator. Source/AC/SQL approvals and actual execution
history remain required. This working plan holds technical decisions and links,
not another copy of the formal TC. No app tests rerun for this documentation-only
update. The original skill files live outside this Git repository.

### PR preparation: integrate latest main

Merged main ad6928f (US16 delivery) into the US33 branch before publication.
Resolved three insertion conflicts: keep both event_changes/event_updates imports,
both EventChangeRequest/EventDetailChange models, and all US09/US16/US33
acceptance selectors. No story policy/schema change. Verification: CI-style
unit289; full backend1116 plus488subtests; frontend296; type check; isolated
US16/US33 Playwright2passed25.4s. Acceptance-selector discovery also matches
both story files (discovery is not a shared acceptance execution). Production
build passed. Dev-all was stopped before browser/build verification to avoid
sharing .next. Prior shared TC evidence remains attached to193832a; no shared
DB test was repeated for this merge. Publication/PR and their exact status are
recorded only after the corresponding action succeeds.

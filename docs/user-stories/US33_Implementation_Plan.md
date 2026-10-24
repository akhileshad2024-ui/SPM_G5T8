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

## Smallest implementation boundary — proposed, not implemented

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

## Stage status

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

## Remaining work

Approve/create/verify schema, then implement and run focused unit/API tests,
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

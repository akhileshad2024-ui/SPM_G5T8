# US04 persistence verification

Automated checks performed by Codex on 2026-10-10 (SGT).

- 3 submission unit tests and 4 submission integration tests passed.
- Combined US04/05/06 Python regression: 23 passed.
- TypeScript regression: 17 passed. Old TS submission business tests were
  replaced by Python tests; the TS presentation-only edit-action check remains.
- Type check and Next.js production build passed. Initial font fetch failed in
  the sandbox; retry with approved network access passed. Existing workspace
  lockfile warning remains.
- event_submission.py: 5/5 statements, no branches. event_drafts.py: 9/9
  statements and 4/4 branches. This is not full-project/API/frontend coverage.

## Reproduce

```bash
.venv/bin/python -m coverage run --branch --source=event_submission,event_drafts --data-file=/private/tmp/us04.coverage -m unittest tests.unit.event_request.test_us04_event_submission tests.integration.test_us04_event_submission_integration tests.unit.event_request.test_us05_save_event_draft tests.unit.event_request.test_us06_edit_event_draft tests.integration.test_us05_save_event_draft_integration tests.integration.test_us06_edit_event_draft_integration -q
.venv/bin/python -m coverage report --data-file=/private/tmp/us04.coverage --fail-under=100 -m
npm test
npx tsc --noEmit
npm run build
```

## Scope and limitations

New submissions and existing owned drafts persist with Submitted status and
server time. GET /event-requests restores own records; draft GET/PUT and repeat
submission reject submitted rows. Existing events schema is reused. No shared
database writes or migrations were executed by Codex.

Integration tests use real FastAPI/SQLAlchemy with isolated SQLite, not
PostgreSQL locking semantics. No direct manual UI pass is claimed.

Saved form information remains in draft_form (existing schema compatibility).
This work does not migrate all form values into normalised event columns or
implement coordinator review, the Lead role/queue, notifications or separate
purpose/description capture. Those are explicit remaining integration boundaries.
US04 must not be marked fully Done while its approved Lead queue AC is unmet.

Manual cases should cover new submission and draft transition, refresh/re-login,
unchanged draft ID and absence of direct-edit actions. No Console steps required.

## Draft-save duplicate-click follow-up

On 2026-10-10 (SGT), added a frontend in-flight guard for Save as draft.
Repeated clicks while saving are ignored; the Save, Back and Continue/Submit
buttons are disabled while the save is pending. The lock is released on failure
so the user can retry. This is UI protection, not server-side idempotency or a
rule forbidding separate drafts with identical content. No database changes.

- Frontend regression: 19 tests passed, including 2 pending-request unit tests.
- Type check passed.
- Scoped pending-request.ts coverage: 8/8 statements and 2/2 branches (100%).
  This does not claim application-context or whole-project coverage.
- US04/US05/US06 Python regression: 23 tests passed against isolated SQLite.
- Existing manual Pass records preceded this fix; no post-fix manual execution
  is claimed here. Lead queue integration remains pending.

Commands:

```bash
npm test
npx tsc --noEmit
npm exec vitest -- run tests/unit/event-request/pending-request.unit.test.ts --coverage --coverage.include=lib/event-request/pending-request.ts --coverage.reportsDirectory=/private/tmp/us04-pending-request-coverage
```

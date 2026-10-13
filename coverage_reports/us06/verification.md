# US06 automated verification

Verified by Codex on 2026-10-10, approximately 17:28 SGT (UTC+8).

## Scope and results

- US06: 3 unit tests for `event_drafts.can_edit_draft`, 6 integration tests for the list/reopen/update API.
- US05 regression: 3 existing unit tests and 4 existing integration tests.
- Combined Python result: 16 tests passed.
- `npm test`: 23 existing TypeScript regression tests passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed. Existing multiple-lockfile workspace-root warning remains.
- `git diff --check`: passed.

The measured business module is **backend/event_drafts.py only**: 9 statements,
0 missed statements, 4 branches, 0 missed branches. Statement and branch
coverage are both 100%. This does not claim 100% coverage of API routes,
frontend context, or the entire project. See `coverage.json` and `htmlcov/index.html`.

## Reproduce

```bash
.venv/bin/python -m coverage run --branch --source=event_drafts --data-file=/private/tmp/us06.coverage -m unittest tests.unit.event_request.test_us05_save_event_draft tests.unit.event_request.test_us06_edit_event_draft tests.integration.test_us05_save_event_draft_integration tests.integration.test_us06_edit_event_draft_integration -v
.venv/bin/python -m coverage report --data-file=/private/tmp/us06.coverage --fail-under=100 -m
npm test
npx tsc --noEmit
npm run build
```

Integration tests use real FastAPI handlers and SQLAlchemy with an isolated
SQLite database. They do not verify Supabase/PostgreSQL-specific locking or
the deployed database's permissions. No shared database migration or write was
performed. No manual UI test result is claimed.

## Implementation scope

- Reuse `backend/event_drafts.py` for draft ownership/status rules.
- Add authenticated list, reopen and update routes to `backend/main.py`.
- Reuse the existing `events` table and `draft_form` column; no new table or schema change.
- Load the organiser's saved drafts after login/refresh; reopen via FastAPI.
- Use PUT with the existing draft ID after Continue, rather than POSTing a duplicate.
- Remove prototype draft seeds from authenticated sessions and clear loaded drafts on logout.
- Preserve existing submission behaviour outside US06. US04 submission is still
  in-memory in this branch: submitting a database draft does not persist its
  submitted status. That separate persistence gap is not fixed or claimed complete here.
- No delete, autosave, new mandatory fields, or future-story features.

## Manual acceptance

Wen Yuetong reported both cases passed in the shared Google Sheet:

- US06-TC01: 2026-10-10 18:16 SGT. Draft ID 18; count changed from 3 to 4
  on creation and remained 4 after updates. Reopening and re-login retained edits.
- US06-TC02: 2026-10-10 18:26 SGT. Reused Draft 18 and switched accounts
  by logout/login. Alex could not see it; direct GET and PUT returned 404;
  Maya's name and attendance remained unchanged.

These are user-reported manual results, not direct UI observations by Codex.
The simplified manual TC02 specification focuses on account switching and list
isolation. Historical direct-request results are preserved; automated integration
tests cover API ownership checks. US04 submission persistence remains separate.

# Yangbo — Sprint 3 delivery

Source: Notion Product Backlog, US25–US32, read 24 October 2026.
Branch: `yangbo/m5-equipment-registration-tests`.

## What changed

The assigned coordinator opens Review queue → event → Equipment, adds/edits/removes equipment, chooses a technician and submits. The assigned technician opens Equipment, selects the event, checks availability, updates quantities, notes, alternative suggestions and line status. Selecting Pending releases a reservation; Reserved creates/amends it; Fulfilled locks the line. Requests, reservations and audit history persist in the database.

Availability excludes maintenance/out-of-service quantities and uses peak concurrent reservations during the event period. Adjacent intervals do not conflict. Cancelled/rejected events no longer consume stock. Reservations lock shared catalogue rows in PostgreSQL before checking and writing, preventing competing requests from committing the same stock. Unit/API tests use SQLite and do not prove production concurrency behavior.

Existing US29–US32 implementation is retained. Added browser tests cover registration, duplicates, waitlist, closing date, status/history, confirmed/cancelled withdrawal, deadline, managed-event access, filters and CSV export.

## Acceptance coverage and pending work

| Story | Implemented / covered | Pending |
|---|---|---|
| US25 | Equipment type/quantity/technical requirements; planning edits; invalid/unsupported/duplicate items rejected; assigned coordinator only; reserved and fulfilled items protected | AC4 technician notification requires US36 |
| US26 | Assigned technician access; Pending/Reserved/Unavailable/Fulfilled; notes and alternative suggestion; saved user/time audit | AC4 coordinator notifications require US36 |
| US27 | Period availability; overlapping reservations; maintenance/out-of-service exclusion; shortfall displayed | Browser test and representative deployed response-time measurement (<3s) must run |
| US28 | Persistent event/item reservations, capacity guard, amendments and release, adjacent/overlap cases | Browser execution; PostgreSQL concurrent reservation validation |
| US29–32 | Existing implementation plus new browser test suite | Browser execution; actual email delivery remains absent (US29 AC5). Rescheduling workflow dependencies remain outside these tests |

The written US29 criterion says registration is prevented at capacity, while the existing implementation offers a waitlist (consistent with US30's Waitlisted status). The browser test records the existing waitlist behavior; the PO should confirm this interpretation. No additional confirmed place is allocated when full.

## Run

```bash
npm ci
python -m pip install -r backend/requirements.txt pytest httpx
python -m pytest tests/us25_us28_equipment tests/us29_us32_registration -q
npm test
npx tsc --noEmit
npx playwright install chromium
npx playwright test tests/functional/us25-us28-equipment.spec.ts tests/functional/us29-us32-registration.spec.ts
```

Playwright starts its own backend and frontend and resets only its throwaway SQLite database. Do not run seed scripts against the shared database. Existing tables/records are unchanged; SQLAlchemy creates the four new equipment tables on backend startup and seeds missing catalogue rows without resetting existing stock. Existing requests need the assigned coordinator to submit/assign them before a technician can process them.

Operations may set `maintenance` and `out_of_service` on `equipment_stock` to reflect unavailable quantities. These are counts, not individual asset tracking; no inventory administration screen is introduced. Values should be non-negative and sum to no more than total.

## Verification

- Targeted backend tests: 61 passed (equipment API + existing registration API).
- Frontend unit tests: 323 passed across 20 files.
- TypeScript check: passed.
- New Playwright suite discovery: 10 tests in 2 files.
- Browser execution: blocked before any UI assertion. Current Chromium archives were unavailable; a compatible Chromium 134 downloaded successfully, but this environment denied its process socket creation (`socket(): Operation not permitted`). Do not record these tests as passed.
- Full backend regression: 1,180 tests passed, with 488 subtests passed.
- Production build: passed using temporary `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` with local fallback fonts. The unmodified font-fetching build failed in the existing Google Fonts loader; real font delivery is not verified. No font or build configuration changes are included.

## DoD / review

Do not mark all criteria met or Done yet. Peer review, merge, CI on the merge commit, browser tests and the dependencies above remain pending. This branch has not been pushed or merged by this workspace.

## Today's Daily Scrum draft (actual work only)

Completed: reviewed US25–US32 acceptance criteria; implemented persisted equipment requests and technician assignment, line status/notes/history, interval availability and reservations; added API and Playwright coverage.
Next: run the new Playwright suite on a machine with Chromium, review the changes with a teammate, submit/merge the PR and check CI.
Blockers: this environment prevents Chromium from launching. US25/US26 notification criteria depend on US36; US29's real email confirmation is still unimplemented. Production concurrency and availability response time require deployment verification.

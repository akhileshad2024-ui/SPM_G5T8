# ConnectSphere — Event Operations Platform

A Next.js (App Router + TypeScript) rebuild of the ConnectSphere event-operations
prototype: one request moving through review, venue booking, equipment
reservation, and registration, with a different view per role.

Sign-in, the venue catalogue, event requests and venue booking requests are served by a
FastAPI backend (`backend/`) on Supabase Postgres; the app starts with no sample events.
Actions that are not yet saved on the server (equipment reservations, notifications)
only change the browser's copy, held in a single React context
(`lib/state/app-context.tsx`), and are lost on reload.

## Login & role-based access control (RBAC)

All login code lives in `backend/login/`:

```
backend/login/
  models.py        User table and the Role enum
  schemas.py       Request/response bodies for the auth endpoints
  security.py      Password hashing, session cookie, get_current_user, require_roles
  auth.py          /auth/* endpoints: login, logout, me, change-password
  set_password.py  Script: set one account's password
```

**Secure login**

- Passwords are stored only as Argon2id hashes — never in plain text.
- Signing in sets a signed session token in an `HttpOnly`, `SameSite=Lax`
  cookie, so page scripts can't read it.
- 30 minutes without activity signs you out (`SESSION_IDLE_MINUTES`): the
  backend renews the session on every signed-in request, and the frontend
  tracks clicks/typing/scrolling across tabs, keeps the session alive while
  you're active, and returns you to the sign-in page once you've been idle.
  A session never lasts more than 8 hours from sign-in (`SESSION_HOURS`).
- In production (`APP_ENV=production`) credentials are only accepted over
  HTTPS: plain-HTTP requests get 403, HSTS is sent and the cookie is `Secure`.
- Signing out (or changing your password) revokes the session on the server,
  so a copied cookie stops working.
- A wrong password and an unknown email get the same error, so the login can't
  be used to find out which emails have accounts.
- 5 wrong passwords in a row lock the account for 15 minutes.
- Users can change their own password from the sidebar (they must enter the
  current one).
- The frontend calls the backend through `/api/*`, which Next.js forwards to
  FastAPI (`next.config.ts`), so the cookie is same-origin.

**What each role can open**

| Role | Lands on | Pages |
|---|---|---|
| Event Organiser | `/my-events` | My events, New request |
| Event Coordinator | `/queue` | Review queue, Pipeline, Venues (search, filter and read-only details) |
| Venue Staff | `/bookings` | Booking requests, Venue catalogue |
| Technical Support | `/equipment` | Equipment |
| Attendee | `/browse` | Browse events |

Opening any other page redirects to the role's home page; signed-out users are
sent to `/login`. This is `canAccessRoute` in `lib/auth/route-access.ts`, driven by
`NAV_FOR`.

**Backend role checks**

The page guard only controls what the browser shows — the backend is what
actually enforces permissions. Protect every endpoint with one of these from
`backend/login/security.py`:

```python
Depends(get_current_user)                  # any signed-in user, else 401
Depends(require_roles(Role.venue, ...))    # only these roles, else 403
```

| Endpoint | Allowed |
|---|---|
| `POST /auth/login`, `POST /auth/logout` | anyone |
| `GET /auth/me`, `POST /auth/change-password` | any signed-in user |
| `GET /venues` | any signed-in user (active venues only) |
| `GET /venues/{id}` | any signed-in user (active venues only; a deactivated venue is a 404) |
| `POST /venues/search` | Event Coordinator (search and filter active venues) |
| `POST /venues/suitability` | Event Coordinator (compare an event's venue needs with each venue) |
| `POST /venues/{id}/booking-requests` | Event Coordinator assigned to the event (request a venue for an approved event) |
| `GET /bookings` | Event Coordinator, Venue Staff (the saved booking requests of the events they can see) |
| `POST /bookings/{id}/decision` | Venue Staff (approve or reject a pending booking request) |
| `GET /venues?include_inactive=true` | Venue Staff, Event Coordinator |
| `POST /venues`, `PUT /venues/{id}` | Venue Staff |
| `DELETE /venues/{id}` | Venue Staff — always refused with 409: deactivate instead |
| `GET /venues/{id}/history` | Venue Staff |
| `POST /events`, `PUT /events/{id}` | Event Organiser — `PUT` only on their own drafts |
| `GET /events` | any signed-in user — only events they are involved in (below) |
| `GET /events/{id}/history` | users involved in that event |
| `GET /coordinators` | Event Coordinator — the coordinator accounts an event can be assigned to (US11) |
| `POST /events/{id}/assign`, `/review`, `/clarification`, `/decision` | Event Coordinator — the review steps below |

## Event status (US13)

An event's status is always one of: **Draft, Submitted, Under Review, Pending
Clarification, Approved, Rejected, Confirmed, Cancelled**.

**Changing a status — rule for every story:** call `change_status()` in
`backend/event_status.py`; never set `event.status` directly. It refuses changes
the workflow doesn't allow (409) and records each change in the
`event_status_changes` table (old → new status, who, when, optional reason), which
is what `GET /events/{id}/history` and the "Status history" timeline show.

| From | May change to |
|---|---|
| (new request) | Draft, Submitted |
| Draft | Submitted |
| Submitted | Under Review, Cancelled |
| Under Review | Pending Clarification, Approved, Rejected, Cancelled |
| Pending Clarification | Under Review, Cancelled |
| Approved | Confirmed, Cancelled |
| Confirmed | Cancelled |
| Rejected, Cancelled | — (final) |

**Who is involved in an event** (`backend/event_access.py`) — and so may see it,
its status and its history: the organiser who created it (drafts are visible only
to them); a coordinator assigned to it, or any coordinator while it is live
(submitted, not rejected or cancelled) and unassigned; Venue Staff once it has a
venue booking; Technical Support once it requests equipment; attendees once it is
Confirmed with registration open.

## Event review (US07, US08, US10, US11)

The coordinator's review steps are checked on the page (`lib/events/review/`, instant
messages) and saved by the backend, which checks them again with the same rules
(`backend/event_review.py`) and records each status change in the history.

| Step | Endpoint | Status change | Rules |
|---|---|---|---|
| Assign a coordinator (US11) | `POST /events/{id}/assign` `{coordinatorId}` | — | event unassigned and live; the account must be an active Event Coordinator |
| Start review (US07) | `POST /events/{id}/review` | Submitted → Under Review | only Submitted requests |
| Clarification / amendment (US08) | `POST /events/{id}/clarification` `{kind, message}` | Under Review → Pending Clarification | assigned coordinator only; message 1–1000 characters |
| Approve / reject (US10) | `POST /events/{id}/decision` `{outcome, reason}` | Under Review → Approved / Rejected | assigned coordinator only; reject needs a 10–1000 character reason, approve takes an optional note |

Not built yet: the organiser's reply to a clarification (US09, Pending Clarification →
Under Review) and confirming an event (US14, Approved → Confirmed).

## Venue catalogue (US17 + Week 7 changes)

- Each venue records capacity, location, layouts, facilities, accessibility,
  operating hours and days, **setup and turnaround minutes**, and periods when
  it is **temporarily unavailable** (with a reason: maintenance, equipment
  failure, renovation, safety, internal activity, or other + note).
- Accessibility features come from a fixed set (Wheelchair Access, Special Physical Seating,
  Mobility/Facility Arrangements), enforced by both the form and the API. The set is
  `ACCESSIBILITY_FEATURES` in `backend/schemas.py` and `VENUE_ACCESSIBILITY_OPTIONS` in
  `lib/data.ts`; a unit test fails if the two differ.
- Venues are never deleted, only deactivated and reactivated.
- Every create, edit, deactivation and reactivation is written to the
  `venue_changes` table: who made the change, when, and each changed field's old
  and new values.
- A booking occupies its venue from *start − setup* to *end + turnaround*
  (e.g. 10:00–12:00 with 30 + 45 min occupies 09:30–12:45). This window is used
  for suitability, the availability calendar and conflict detection
  (`lib/venues/rules.ts`). Venue Staff can't approve a booking that clashes.
- When a venue edit (longer setup/turnaround, a new unavailable period,
  deactivation) puts existing bookings in trouble, they are **kept** and
  flagged: the coordinator gets a notification, the event's activity log and
  venue tab explain the problem, and the bookings page lists them under
  "Confirmed bookings needing attention". The coordinator can request a
  replacement venue without losing any other event details.

## Venue search (US20)

Event Coordinators search the active venues on the **Venues** page. Every filter is optional and
the ones given must all match:

| Filter | A venue matches when |
|---|---|
| Date and time | it is free for the whole period (date, start and end are given together) |
| Expected attendance | its capacity is at least that many people |
| Location | its location is the one chosen (picked from the locations of the active venues) |
| Accessibility | it offers every ticked feature (the same fixed set as the venue form) |
| Layout | it supports that layout |
| Facilities | it offers every ticked facility |

- **Free for the period** uses the same rules as the rest of the app (`backend/venue_search.py`
  mirrors `lib/venue-rules.ts`): the venue is open that weekday and the event falls within its
  operating hours; no unavailability period overlaps; no booking clashes. Setup and turnaround
  are included, so an event occupies *start − setup* to *end + turnaround* (Week 7 change #1),
  and a window that only touches another does not clash. Setup or turnaround running outside
  operating hours does not rule a venue out, matching the venue tab's warning-only treatment.
- **Bookings** are not stored in the backend yet (events live in the browser), so the page sends
  the bookings that currently hold a venue (approved or pending) together with the search.
  That is why the search is a `POST`.
- **Results are strict:** only venues meeting every filter are listed, no close matches.
- **Filters** are shown as chips (from the response's `applied_filters`); each chip has a button
  that clears just that filter and searches again. "Clear all" resets the search. When nothing
  matches, the page says so and keeps the applied filters on screen.
- The search runs over all active venues in one query and in memory; the unit tests time a
  2,000-venue, 4,000-booking search against the 3-second limit.

## Venue suitability and booking requests (US21, US22)

On an event's **Venue** tab (Event Coordinator) every active venue is checked against the event's
recorded needs by the backend (`backend/venue_suitability.py`, `POST /venues/suitability`):

- Each venue is marked **Suitable**, **Partially suitable** or **Unsuitable**.
- Every need is compared with what the venue offers (capacity, layout, each facility, each
  accessibility feature, and availability at the event's date and time); the unmet ones are listed
  with the reason, and the full comparison can be expanded under each venue.
- How serious a miss is: capacity below the attendance, an unsupported layout, a missing
  accessibility feature (the Week 4 answers say accessibility/layout mismatches make a venue not
  suitable) and anything stopping the venue being used then are **blockers** (unsuitable); a missing
  facility, or setup/turnaround running outside operating hours, is a **caveat** (partially suitable).

Requesting a venue (`backend/booking_request.py`, `POST /venues/{id}/booking-requests`):

- The page names only the event. The server reads the event's saved date, start and end, expected
  attendance, layout and needs, and the venue's setup and teardown periods (the venue's own
  configured times, Week 7 change #1), so the booking records exactly what the event asks for.
  Only the coordinator the event is assigned to may ask.
- Only an **approved** event can ask for a venue. An event that already went through a booking (a
  replacement venue because the first became unavailable, or a new request after a rejection) may
  also ask once it is planning or confirmed, so Week 7 change #2 keeps working.
- The booking is **saved** (`venue_bookings` table) as **pending** and the venue is **provisionally
  held** from the start of setup to the end of teardown. Pending and approved bookings hold a
  venue: search (US20), suitability (US21) and further requests all read them from the table, so a
  venue another coordinator has requested is not free. The booking survives a reload and Venue Staff
  see it on their Booking requests page, with the hold and any override. The new table is created
  automatically when the backend starts; no manual database change is needed.
- **No second pending request** for the same venue and time period (setup and teardown included;
  touching periods are fine). This cannot be overridden.
- A venue that is not fully suitable can still be requested, but only after the coordinator
  acknowledges the warning. The **override** (verdict, who acknowledged, when, every unmet
  requirement) is saved with the booking, shown on the event (`venueOverrides`) and to Venue Staff.
  A clash with an already *approved* booking can be acknowledged too, as the story allows; Venue
  Staff still cannot approve a clashing booking.
- **Venue Staff decide** (`POST /bookings/{id}/decision`): approving makes the booking confirmed and
  blocks the venue for others (refused if an approved booking already holds an overlapping period,
  or the venue was deactivated); rejecting needs a reason and releases the venue, handing the event
  back to its previous approved venue if it had one. Asking for a replacement venue releases the
  event's earlier pending request, and approving the replacement releases its earlier booking.
- Not yet saved: the notification itself (the server produces its text; the page shows it in the
  browser) and the activity log lines, which are rebuilt only for the current session.
- Events now state accessibility needs from the same fixed set as venues (Wheelchair Access, Special
  Physical Seating, Mobility/Facility Arrangements), so the two can be compared.

## Project structure

```
app/
  layout.tsx                 Root layout: fonts, global CSS, AppProvider
  page.tsx                   "/" — redirects to /login or the role's home page
  login/page.tsx             Sign-in screen
  (dashboard)/layout.tsx     Signed-in shell: sidebar, top bar, modal, toast
  (dashboard)/queue/         Coordinator: review queue + event workspace (tabs)
  (dashboard)/board/         Coordinator: pipeline board
  (dashboard)/venues/        Coordinator: venue search + read-only details (US18, US20)
  (dashboard)/my-events/     Organiser: my requests + stats
  (dashboard)/new-request/   Organiser: 3-step new request wizard
  (dashboard)/bookings/      Venue staff: availability calendar + booking requests
  (dashboard)/catalogue/     Venue staff: venue catalogue
  (dashboard)/equipment/     Technical support: inventory + equipment requests
  (dashboard)/browse/        Attendee: browse & register for events

components/
  layout/          Sidebar, TopBar, NotificationsPanel
  ui/              Small shared primitives (Pill, Dot, ProgressBar)
  login/           Sign-in screen pieces
  queue/           Review queue list + event workspace + its 5 tabs
  board/, my-events/, new-request/, bookings/, catalogue/, equipment/, browse/
                   One folder per page, holding that page's own components
  Modal.tsx, Toast.tsx   Global overlays rendered from the dashboard layout

lib/
  types.ts         Shared domain types (Role, EventRecord, Venue, ...)
  data.ts          Static reference data, seed data, per-role nav + route guard
  selectors.ts     Pure helpers (freeQty, suitability, lookups) — no React
  event-request/   US03/US04: request validation + submission (pure, unit tested)
  event-review/    US07/08/10/11: review queue, clarification, approve/reject,
                   coordinator assignment — ACs in docs/user-stories/
  venue-rules.ts   Venue availability: occupied windows, conflicts, unavailability — no React
  venue-search.ts  Venue search (US20): filter state, request body, clearing one filter — no React
  venue-suitability.ts  Venue suitability (US21): request body and verdict wording — no React
  venue-booking.ts      Venue booking request (US22): request body, who may send one, saved bookings onto events — no React
  venue-form.ts    Venue catalogue form state + client-side validation — no React
  api.ts           fetch wrapper for the backend (/api/*)
  app-context.tsx  Global state + every mutation (signIn, approve, requestBooking, ...)
  page-meta.ts     Per-route title/subtitle for the top bar

backend/
  main.py          FastAPI app + venue endpoints
  venue_availability.py  Shared availability rules: occupied windows, closed days/hours, unavailability, clashes
  venue_search.py        Venue search rules (US20): requirements + free-for-the-period check
  venue_suitability.py   Suitability rules (US21): verdict, every need compared, override record
  booking_request.py     Booking request rules (US22): approved event, no duplicate pending, values to save, notification
  venue_bookings.py      Saved bookings (US22): what holds a venue, saving a request, Venue Staff's decision
  database.py      Database connection (reads backend/.env)
  models.py, schemas.py   Venue + venue change-history tables, request/response bodies
  schema_changes.sql  Database changes to run once in the Supabase SQL Editor (US17 columns)
  seed_venues.py   Script: add five demo venues to the catalogue
  login/           Authentication + RBAC (see above)
```

Each page's feature components live in their own folder next to the route
that uses them; only truly cross-page pieces sit in `components/layout` and
`components/ui`.

## Getting started

**Backend** (once) — run these from the `backend/` folder:

```bash
cd backend
cp .env.example .env               # then fill in DATABASE_URL and JWT_SECRET
pip install -r requirements.txt
```

Generate a `JWT_SECRET` with
`python -c "import secrets; print(secrets.token_urlsafe(48))"`. The backend
refuses to start without one.

The user accounts already exist in the team's shared Supabase database (the
`users` table), so there is nothing to seed. There is currently no script or
page for creating new accounts.

Start the backend with `uvicorn main:app --reload` (from `backend/`).

**Database changes** — the backend never alters existing tables. If your database
predates US17, run the steps in `backend/schema_changes.sql` once in the Supabase
dashboard (SQL Editor). The final step (dropping the old `unavailableDates`
column) must wait until every branch uses the new venue model.

**Demo venues** — to fill the venue catalogue with five demo venues (Grand Hall,
The Atrium, ...), run `python -m seed_venues` (from `backend/`; existing venues
are left alone).

**Managing passwords** (from `backend/`):

```bash
python -m login.set_password wei.lim@connectsphere.edu   # prompts for the new password
```

This also clears a lockout and signs that account out everywhere. Don't type
passwords into the `users` table in Supabase — the `password_hash` column must
hold an Argon2 hash, so a plain password there can never sign in.

**Frontend:**

```bash
npm install
npm run dev
```

Open http://localhost:3000 — you'll land on the sign-in screen. Sign in with
one of these accounts (ask the team for the passwords — they are not stored in
the repo):

| Email | Role |
|---|---|
| priya.tan@connectsphere.edu | Event Coordinator |
| maya.rahman@connectsphere.edu | Event Organiser |
| daniel.ortiz@connectsphere.edu | Venue Staff |
| wei.lim@connectsphere.edu | Technical Support |
| sam.adeyemi@student.connectsphere.edu | Attendee |

## Deploying to Vercel

This is a standard Next.js app — push it to GitHub and import the repo at
[vercel.com/new](https://vercel.com/new), or run `npx vercel` from this
directory. Set `BACKEND_URL` to wherever the FastAPI backend is hosted, and
set `APP_ENV=production` in the backend's environment: it then refuses any
request not made over HTTPS (behind a hosting proxy it reads
`X-Forwarded-Proto`), sends HSTS, and makes the session cookie HTTPS-only.

## Tests

```bash
npm test                # all frontend unit tests (vitest)
python -m pytest tests  # all Python tests (pip install pytest pytest-cov once)
python -m unittest discover -s tests/unit/venue -p "test_us17_*.py" -v
python -m unittest discover -s tests/unit/venue -p "test_us18_*.py" -v
python -m unittest discover -s tests/unit/venue -p "test_us20_*.py" -v
python -m unittest discover -s tests/unit/venue -p "test_us21_*.py" -v
python -m unittest discover -s tests/unit/venue -p "test_us22_*.py" -v
                        # US17 backend unit tests: validation rules + change recording, no API or database
python -m unittest discover -s tests/integration -p "test_us17_*.py" -v
python -m unittest discover -s tests/integration -p "test_us20_*.py" -v
python -m unittest discover -s tests/integration -p "test_us21_*.py" -v
python -m unittest discover -s tests/integration -p "test_us22_*.py" -v
                        # US20 integration tests: search through the real API (login, SQL, JSON columns), also run by hand
                        # US17 integration tests (run by hand, not part of the automated coverage): real API + in-memory SQLite, never touches Supabase
python -m pytest tests/us01_secure_login     # US01 backend: unit/ + API tests, throwaway SQLite
python -m pytest tests/us02_rbac             # US02 backend
python -m pytest tests/us03_us04_event_request   # US03/US04 backend
python -m pytest tests/us13_event_status     # US13 backend
npm run test:us01       # US01 frontend unit tests (idle sign-out)
npm run test:us02       # US02 frontend unit tests (page access, who sees which events)

# Coverage for one story (run from the project root), saved under coverage_reports/<story>/<date_time>/.
# US17/US18/US20: runs each UNIT test file on its own -> unit/<test_file>/ (htmlcov/index.html,
# coverage_report.txt, test_output.txt) plus summary.txt, and one line per test file in
# coverage_reports/<story>/history_by_file.csv. Integration tests are not part of this automation.
python run_coverage.py us17      # or us18, us20, us21, us22
# US01, US02, US03, US13: runs the story's whole test folder (htmlcov/index.html, coverage_report.txt,
# test_output.txt, frontend/coverage_report.txt) and adds a line to coverage_reports/<story>/history.csv.
python run_coverage.py us01      # or us02, us03, us13
```

### Functional tests (end to end)

A real browser (Playwright, Chromium) drives the real app: sign in, open the review
queue, click through a story, and check what the user sees. Playwright starts both
servers itself — FastAPI on a throwaway SQLite database seeded with test accounts
(`tests/functional/support/seed_users.py`, never Supabase) and Next.js — on ports
8100 and 3100, so they don't clash with `npm run dev`. Stop `npm run dev` first
anyway: two Next.js dev servers can't share the `.next` folder.

```bash
npx playwright install chromium     # once
npm run test:functional             # all functional tests
npx playwright test -g "US10-AC2"   # one acceptance criterion
npx playwright show-report coverage/functional/report   # results, with screenshots/traces of failures
```

The backend's Python packages must be installed. If `python` isn't the interpreter
that has them (e.g. a virtualenv), point at it: `PYTHON=.venv/bin/python npm run test:functional`.
Covered so far: US07, US08, US10 (`tests/functional/*.spec.ts`). CI runs them in the
`functional` job and keeps the report as an artifact.

US01 and US02 keep their tests in one folder per story (`tests/us01_secure_login/`,
`tests/us02_rbac/`): pytest backend tests (`unit/` for single functions,
`test_*.py` for the API) next to the Vitest frontend tests (`*.unit.test.ts`).

## CI coverage evidence

`.github/workflows/tests.yml` runs on pull requests and pushes to `main`.
It keeps the existing tests, TypeScript check and Next.js build, and measures:

- Backend: statement and branch coverage for `backend/`, using all Python tests.
- Frontend: statement, branch, function and line coverage for TypeScript/TSX
  in `lib/`, `app/` and `components/`, including untested source files.

Coverage includes both unit and integration execution on the backend; it is
not a unit-only metric. Frontend coverage is collected from Vitest unit tests,
not manual browser tests. Config/build scripts, styles and test files are outside
these source scopes. A module's 100% result must not be called project-wide 100%.

Each job uploads its reports even after a test failure when reports exist.
In GitHub, open **Actions → the workflow run → Artifacts**, then download
`backend-coverage-<commit SHA>` and `frontend-coverage-<commit SHA>`.
Backend HTML starts at `html/index.html`; frontend HTML starts at `index.html`.
JSON/XML or LCOV files provide machine-readable results. Reports are requested
to remain for 90 days; download required evidence before it expires. Reports can
contain source code, so share them only with authorised project reviewers.

This initial setup measures coverage without a percentage pass/fail threshold.
Green CI means the tests/checks passed, not that coverage reached 100%. Review
uncovered code, improve justified tests, and document any exception before
agreeing a threshold. Generated reports remain ignored by Git; Actions artifacts
and run logs are the evidence, rather than committing new generated report files.

Local frontend measurement: `npm run test:coverage`.
For backend measurement, install `coverage`, then run:

```bash
python -m coverage run --branch --source=backend --data-file=/tmp/connectsphere-ci.coverage -m pytest tests -q -p no:cacheprovider
python -m coverage report --data-file=/tmp/connectsphere-ci.coverage --show-missing
```

Local verification on 13 Oct 2026 (SGT): 943 Python tests and 474 subtests passed;
291 frontend tests passed; type check and workflow YAML parsing passed. Backend
statement coverage was 97.49% and branch coverage 96.05%. Frontend statement
coverage was 18.20% and branch coverage 21.62% in the full source scope above.
Many UI components/context are not executed by the current unit tests, so their
uncovered code remains visible. This is local verification, not a claim that a
new GitHub Actions run has already uploaded the reports. No 100% claim is made.

## Development scripts

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run start` — run the production build locally

## Architecture
[Editable C4 diagrams (.drawio)](docs/architecture/ConnectSphere_C4_Editable.drawio)
The file contains three English diagrams: C1 System Context, C2 Containers, and C3 Backend Components. These describe the **Proposed Target Architecture**: Next.js / React, a Python monolith, and Supabase DB. Today the backend serves sign-in and the venue catalogue; the other data is still held in the browser.
The Python framework, Supabase Auth usage, database connection method, and email provider remain TBD. Component boundaries and API connections are proposed and should be aligned with the implementation as it develops.
To edit, download the file and open it in draw.io / diagrams.net using **File > Open From > Device**. Use this `.drawio` file as the primary editable source.

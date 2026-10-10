# ConnectSphere — Event Operations Platform

A Next.js (App Router + TypeScript) rebuild of the ConnectSphere event-operations
prototype: one request moving through review, venue booking, equipment
reservation, and registration, with a different view per role.

Sign-in and the venue catalogue are served by a FastAPI backend (`backend/`)
on Supabase Postgres. The rest of the data is still seeded in memory on load
(see `lib/data.ts`) and lives in a single React context (`lib/app-context.tsx`)
— reloading the page resets it (but keeps you signed in).

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
  cookie, so page scripts can't read it. Sessions last 8 hours.
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
sent to `/login`. This is `canAccessRoute` in `lib/data.ts`, driven by
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
| `POST /venues/{id}/booking-requests` | Event Coordinator (request a venue for an approved event) |
| `GET /venues?include_inactive=true` | Venue Staff, Event Coordinator |
| `POST /venues`, `PUT /venues/{id}` | Venue Staff |
| `DELETE /venues/{id}` | Venue Staff — always refused with 409: deactivate instead |
| `GET /venues/{id}/history` | Venue Staff |

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
  (`lib/venue-rules.ts`). Venue Staff can't approve a booking that clashes.
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

- The request holds the event's date, start and end, expected attendance and layout, plus the
  venue's setup and teardown periods (the venue's own configured times, Week 7 change #1).
- Only an **approved** event can ask for a venue. An event that already went through a booking (a
  replacement venue because the first became unavailable, or a new request after a rejection) may
  also ask once it is planning or confirmed, so Week 7 change #2 keeps working.
- The booking is recorded as **pending** and the venue is **provisionally held** from the start of
  setup to the end of teardown (pending requests count when checking availability, as before).
  Venue Staff get a notification and see the hold and any override on the request.
- **No second pending request** for the same venue and time period (setup and teardown included;
  touching periods are fine). This cannot be overridden.
- A venue that is not fully suitable can still be requested, but only after the coordinator
  acknowledges the warning. The **override** (verdict, who acknowledged, when, every unmet
  requirement) is returned, kept on the event (`venueOverrides`), added to its activity log and
  shown to Venue Staff. A clash with an already *approved* booking can be acknowledged too, as the
  story allows; Venue Staff still cannot approve a clashing booking.
- Events live in the browser, so the page sends the event's status and the bookings that currently
  hold venues with each request, and keeps the returned booking on the event. The backend checks
  every rule regardless. Once events are stored in the backend the same rules can read them directly.
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
  venue-rules.ts   Venue availability: occupied windows, conflicts, unavailability — no React
  venue-search.ts  Venue search (US20): filter state, request body, clearing one filter — no React
  venue-suitability.ts  Venue suitability (US21): request body and verdict wording — no React
  venue-booking.ts      Venue booking request (US22): request body and who may send one — no React
  venue-form.ts    Venue catalogue form state + client-side validation — no React
  api.ts           fetch wrapper for the backend (/api/*)
  app-context.tsx  Global state + every mutation (signIn, approve, requestBooking, ...)
  page-meta.ts     Per-route title/subtitle for the top bar

backend/
  main.py          FastAPI app + venue endpoints
  venue_availability.py  Shared availability rules: occupied windows, closed days/hours, unavailability, clashes
  venue_search.py        Venue search rules (US20): requirements + free-for-the-period check
  venue_suitability.py   Suitability rules (US21): verdict, every need compared, override record
  booking_request.py     Booking request rules (US22): approved event, no duplicate pending, record, notification
  database.py      Database connection (reads backend/.env)
  models.py, schemas.py   Venue + venue change-history tables, request/response bodies
  schema_changes.sql  Database changes to run once in the Supabase SQL Editor (US17 columns)
  seed_venues.py   Script: add the five demo venues the sample events refer to
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

**Demo venues** — the sample events (Grand Hall, The Atrium, ...) only link to
real venues once those exist in the catalogue. Add any that are missing with
`python -m seed_venues` (from `backend/`; existing venues are left alone).

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
set `COOKIE_SECURE=true` in the backend's environment when serving over HTTPS.

## Tests

```bash
npm test                # all frontend unit tests (vitest)
python -m unittest discover -s tests -v     # all Python tests
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

# Coverage for one story: runs each UNIT test file on its own and saves a timestamped report per file under
# coverage_reports/<story>/<date_time>/unit/<test_file>/ (htmlcov/index.html, coverage_report.txt, test_output.txt),
# plus summary.txt, and adds one line per test file to coverage_reports/<story>/history_by_file.csv.
# Integration tests are not part of this automation.
python run_coverage.py us17      # or us18, us20, us21, us22
```

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run start` — run the production build locally
## Architecture
[Editable C4 diagrams (.drawio)](docs/architecture/ConnectSphere_C4_Editable.drawio)
The file contains three English diagrams: C1 System Context, C2 Containers, and C3 Backend Components. These describe the **Proposed Target Architecture**: Next.js / React, a Python monolith, and Supabase DB. Today the backend serves sign-in and the venue catalogue; the other data is still held in the browser.
The Python framework, Supabase Auth usage, database connection method, and email provider remain TBD. Component boundaries and API connections are proposed and should be aligned with the implementation as it develops.
To edit, download the file and open it in draw.io / diagrams.net using **File > Open From > Device**. Use this `.drawio` file as the primary editable source.

# ConnectSphere — Event Operations Platform

ConnectSphere follows one event request from submission through review, venue booking,
equipment reservation, safety check, confirmation and attendee registration, with a
different view for each role: Event Organiser, Event Coordinator, Event Coordinator Lead,
Venue Staff, Technical Support, Attendee and Safety Officer.

## Tech stack

- **Frontend:** Next.js (App Router) with TypeScript and React
- **Backend:** FastAPI (Python) in `backend/`
- **Database:** Supabase Postgres (tests use a throwaway SQLite database instead)
- **Tests:** pytest and unittest (backend), Vitest (frontend), Playwright (end to end)

## Getting started

**Backend** (run from the `backend/` folder):

```bash
cd backend
cp .env.example .env               # then fill in DATABASE_URL and JWT_SECRET
pip install -r requirements.txt
uvicorn main:app --reload
```

Generate a `JWT_SECRET` with `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
The backend refuses to start without one.

User accounts already exist in the team's shared Supabase database, so there is nothing
to seed. To set one account's password (from `backend/`):

```bash
python -m auth.set_password wei.lim@connectsphere.edu
```

To add five demo venues to the catalogue, run `python -m seed_venues` (from `backend/`).
For schema changes, review `backend/schema_changes.sql` before applying them with
authorised database access. See [backend operation notes](docs/operations/backend-operations.md).

**Frontend** (from the project root):

```bash
npm install
npm run dev
```

Once `.venv` and `backend/.env` are configured, `npm run dev:all` starts both applications from the project root.

Open http://localhost:3000 and sign in with one of these accounts (ask the team for the
passwords; they are not stored in the repo):

| Email | Role |
|---|---|
| priya.tan@connectsphere.edu | Event Coordinator |
| maya.rahman@connectsphere.edu | Event Organiser |
| daniel.ortiz@connectsphere.edu | Venue Staff |
| wei.lim@connectsphere.edu | Technical Support |
| sam.adeyemi@student.connectsphere.edu | Attendee |

## Project structure

```
app/          Next.js pages, one folder per role's screens
components/   React components, one folder per page plus shared layout and UI pieces
lib/          Frontend logic: types, API client, validation and rules (no React where possible)
backend/      FastAPI app, business component packages, shared SQLAlchemy models and schemas
tests/        All tests, one folder per story (tests/usXX_*), plus unit/, integration/ and functional/
docs/         C4, formal workbooks, consolidated traceability and operation details
coverage_reports/   Timestamped project evidence and retained historical story reports
```

## Backend components

The backend remains one FastAPI application. Packages group related business code;
they are not separate services. `main.py` currently retains most HTTP endpoints and
registers the existing routers. `models.py`, `schemas.py` and `database.py` remain shared.

| Package | Responsibility |
|---|---|
| `auth/` | Passwords, sessions, roles and access checks |
| `event_requests/` | Drafts, submission, event information, visibility and status |
| `event_review/` | Review, clarification, assignment and confirmation |
| `event_changes/` | Change requests and shared arrangement reassessment |
| `venues/` | Catalogue, availability, search, suitability and calendar |
| `bookings/` | Requests, decisions, conflicts, hold expiry and booking flags |
| `equipment/` | Equipment requests, stock and reservations |
| `registrations/` | Registration, waitlisting, withdrawal and lists |
| `safety/` | Operational safety review and rework |
| `notifications/` | Recipient-scoped notices and hold reminders |

Notion M1–M5 identify historical planning workstreams. They are not deployment
containers or a one-to-one mapping to these implementation components.

## Running the tests

```bash
npm test                      # frontend unit tests (Vitest)
python -m pip install -r backend/requirements-test.txt
python -m pytest tests        # backend unit and integration tests
npx playwright install chromium   # once
npm run test:functional       # end-to-end tests (Playwright starts both servers itself)
```

For timestamped execution evidence, activate the project's Python environment first:

```bash
npm run test:evidence:backend
npm run test:evidence:frontend
npm run test:evidence:functional
```

These commands execute the tests themselves; do not run an extra full suite first.
They retain local runs under `coverage_reports/project/history/` (Git-ignored).
For a complete versionable project session, use `python scripts/test_evidence.py all`.
CI uploads its reports and execution records as Actions artifacts with 90-day retention.

To run one story's tests under coverage (from the project root):

```bash
python run_coverage.py us01   # or any story, e.g. us19, us36
```

The report is saved under `coverage_reports/<story>/<date_time>/` (open `htmlcov/index.html`
for the backend and `frontend/htmlcov/index.html` for the frontend).

## Architecture

[Editable C4 diagrams (.drawio)](docs/architecture/ConnectSphere_C4_Editable.drawio):
system context, containers and backend components. Open the file in draw.io / diagrams.net.

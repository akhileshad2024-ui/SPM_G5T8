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
python -m login.set_password wei.lim@connectsphere.edu
```

If your database is older than the current code, run the steps in
`backend/schema_changes.sql` once in the Supabase SQL Editor.

**Frontend** (from the project root):

```bash
npm install
npm run dev
```

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
backend/      FastAPI app (main.py), business rules, database models, login/ (authentication and RBAC)
tests/        All tests, one folder per story (tests/usXX_*), plus unit/, integration/ and functional/
docs/         Architecture diagram
coverage_reports/   Saved test and coverage runs, one folder per story
```

## Running the tests

```bash
npm test                      # frontend unit tests (Vitest)
python -m pytest tests        # backend tests (pip install pytest pytest-cov once)
npx playwright install chromium   # once
npm run test:functional       # end-to-end tests (Playwright starts both servers itself)
```

To run one story's tests under coverage (from the project root):

```bash
python run_coverage.py us01   # or any story, e.g. us19, us36
```

The report is saved under `coverage_reports/<story>/<date_time>/` (open `htmlcov/index.html`
for the backend and `frontend/htmlcov/index.html` for the frontend).

## Architecture

[Editable C4 diagrams (.drawio)](docs/architecture/ConnectSphere_C4_Editable.drawio):
system context, containers and backend components. Open the file in draw.io / diagrams.net.

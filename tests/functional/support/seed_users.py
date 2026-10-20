"""
Creates a fresh throwaway SQLite database with the accounts the functional
tests sign in as. Playwright runs this before starting the backend
(see playwright.config.ts); it is never run against Supabase.

    DATABASE_URL=sqlite:///<file> JWT_SECRET=... python tests/functional/support/seed_users.py
"""

import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[3] / "backend"
sys.path.insert(0, str(BACKEND))

url = os.environ.get("DATABASE_URL", "")
if not url.startswith("sqlite:///"):
    sys.exit("Refusing to seed: DATABASE_URL must point at a throwaway SQLite file, never Supabase.")

# Start from an empty database every run, so tests never see a previous run's events.
db_file = Path(url.removeprefix("sqlite:///"))
db_file.parent.mkdir(parents=True, exist_ok=True)
db_file.unlink(missing_ok=True)

import main  # noqa: E402,F401  (creates every table)
from database import SessionLocal  # noqa: E402
from login.models import Role, User  # noqa: E402
from login.security import hash_password  # noqa: E402

# Keep in sync with tests/functional/support/accounts.ts.
PASSWORD = "Functional-Test-1"
ACCOUNTS = [
    ("maya.rahman@connectsphere.edu", "Maya Rahman", Role.organiser),
    ("priya.tan@connectsphere.edu", "Priya Tan", Role.coordinator),
    ("marcus.lee@connectsphere.edu", "Marcus Lee", Role.coordinator),
]

with SessionLocal() as db:
    password_hash = hash_password(PASSWORD)
    for email, name, role in ACCOUNTS:
        db.add(User(email=email, name=name, role=role, password_hash=password_hash, is_active=True,
                    failed_login_attempts=0, session_version=0))
    db.commit()

print(f"Seeded {len(ACCOUNTS)} functional-test accounts into {db_file}")

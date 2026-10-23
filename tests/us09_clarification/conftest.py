"""Reuse isolated SQLite/session fixtures; never connect to the shared database."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from auth_testkit import client, db, fresh_database, signed_in  # noqa: E402,F401

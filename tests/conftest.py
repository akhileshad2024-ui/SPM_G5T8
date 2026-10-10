"""
Test environment shared by every backend test folder.

pytest loads this before collecting any test module, so whichever test imports
the backend first gets these settings. database.py builds its engine once at
import time, so setting DATABASE_URL in individual test files is order-dependent.
python-dotenv does not override variables that are already set, so the real
Supabase URL in backend/.env is never used.
"""

import atexit
import os
import shutil
import sys
import tempfile
from pathlib import Path

_TMP_DIR = Path(tempfile.mkdtemp(prefix="connectsphere-tests-"))

os.environ["DATABASE_URL"] = f"sqlite:///{_TMP_DIR / 'test.db'}"
os.environ["JWT_SECRET"] = "test-only-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
os.environ["APP_ENV"] = "development"


@atexit.register
def _remove_test_database():
    database = sys.modules.get("database")
    if database is not None:
        database.engine.dispose()  # release the file so Windows lets us delete it
    shutil.rmtree(_TMP_DIR, ignore_errors=True)

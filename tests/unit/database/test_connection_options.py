"""Database configuration regression, not a new US09 business requirement.

The function only inspects fake URLs. No shared database connection is opened.
"""
import pytest

from backend.database import connection_args


@pytest.mark.parametrize("driver", ["postgresql", "postgresql+psycopg"])
def test_supabase_transaction_pooler_disables_psycopg_auto_prepare(driver):
    # Given the supported transaction-pooler endpoint, prevent named statement clashes.
    url = f"{driver}://test:fake@aws-1-test.pooler.supabase.com:6543/postgres"
    assert connection_args(url) == {"prepare_threshold": None}


@pytest.mark.parametrize("url", [
    "sqlite://",
    "postgresql+psycopg://test:fake@aws-1-test.pooler.supabase.com:5432/postgres",
    "postgresql+psycopg://test:fake@db.test.supabase.co:5432/postgres",
    "postgresql+psycopg://test:fake@localhost:6543/postgres",
    "postgresql+psycopg2://test:fake@aws-1-test.pooler.supabase.com:6543/postgres",
])
def test_other_connection_modes_keep_existing_driver_defaults(url):
    # SQLite and other endpoints/drivers must not receive a Psycopg-only option.
    assert connection_args(url) == {}

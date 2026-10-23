import os
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

# FastAPI reads its private configuration from the backend directory.
ENV_FILE = Path(__file__).resolve().parent / ".env"
# utf-8-sig tolerates the BOM that Windows editors often add
load_dotenv(ENV_FILE, encoding="utf-8-sig")

# 2. Get the URL
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL")

# 3. Never hardcode credentials here — fail loudly instead
if not SQLALCHEMY_DATABASE_URL:
    raise RuntimeError(
        f"DATABASE_URL is not set. Add your PostgreSQL connection string to {ENV_FILE}."
    )

# pool_pre_ping: Supabase closes idle connections, so check each pooled one before reusing it
# (otherwise the next request fails with "server closed the connection unexpectedly").
engine = create_engine(SQLALCHEMY_DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

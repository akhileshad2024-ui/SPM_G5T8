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

engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

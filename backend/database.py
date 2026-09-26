import os
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

# 1. Force python to look for the .env file in the exact same folder as this script
BASE_DIR = Path(__file__).resolve().parent
# utf-8-sig tolerates the BOM that Windows editors often add
load_dotenv(BASE_DIR / ".env", encoding="utf-8-sig")

# 2. Get the URL
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL")

# 3. Never hardcode credentials here — fail loudly instead
if not SQLALCHEMY_DATABASE_URL:
    raise RuntimeError(
        f"DATABASE_URL is not set. Create {BASE_DIR / '.env'} (copy .env.example) with your Supabase connection string."
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
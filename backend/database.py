import os
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

# 1. Force python to look for the .env file in the exact same folder as this script
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

# 2. Get the URL
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL")

# 3. Failsafe bypass: If the .env file is STILL failing due to Windows encoding, use your string directly
if not SQLALCHEMY_DATABASE_URL:
    print("⚠️ WARNING: Could not read .env file. Using fallback connection string.")
    SQLALCHEMY_DATABASE_URL = "postgresql://postgres.frpmzwjpdcprvstoairm:0RVnecoWERTpqxcr@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres"

engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
import enum
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Enum
from sqlalchemy.sql import func
from database import Base


class Role(str, enum.Enum):
    """Must stay in sync with the `Role` type in lib/types.ts."""
    organiser = "organiser"
    coordinator = "coordinator"
    venue = "venue"
    tech = "tech"
    attendee = "attendee"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)  # always stored lower-cased
    name = Column(String, nullable=False)
    role = Column(Enum(Role, name="user_role", native_enum=False, create_constraint=True, length=20), nullable=False)
    password_hash = Column(String, nullable=False)  # argon2id, never the raw password
    is_active = Column(Boolean, nullable=False, default=True)

    # Brute-force protection: the account is locked for a while after too many bad passwords.
    failed_login_attempts = Column(Integer, nullable=False, default=0)
    locked_until = Column(DateTime(timezone=True), nullable=True)

    # Embedded in every session token; bumping it revokes all of this user's sessions.
    session_version = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

"""
Create (or reset) the demo accounts, one per role.

    python -m login.seed_users        (run from the backend/ folder)

Prompts for the password to give every demo account; set SEED_PASSWORD to run
non-interactively. Re-running resets the password, clears any lockout and
signs out existing sessions for these accounts.
"""

import os
import sys
from getpass import getpass

from database import Base, SessionLocal, engine
from login.models import Role, User
from login.schemas import MIN_PASSWORD_LENGTH
from login.security import hash_password

DEMO_USERS = [
    ("maya.rahman@connectsphere.edu", "Maya Rahman", Role.organiser),
    ("priya.tan@connectsphere.edu", "Priya Tan", Role.coordinator),
    ("daniel.ortiz@connectsphere.edu", "Daniel Ortiz", Role.venue),
    ("wei.lim@connectsphere.edu", "Wei Lim", Role.tech),
    ("sam.adeyemi@student.connectsphere.edu", "Sam Adeyemi", Role.attendee),
]


def read_password() -> str:
    password = os.getenv("SEED_PASSWORD")
    if password is None:
        password = getpass("Password for the demo accounts: ")
        if getpass("Confirm password: ") != password:
            sys.exit("Passwords don't match.")
    if len(password) < MIN_PASSWORD_LENGTH:
        sys.exit(f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
    return password


def main() -> None:
    password = read_password()
    Base.metadata.create_all(bind=engine)

    with SessionLocal() as db:
        for email, name, role in DEMO_USERS:
            user = db.query(User).filter(User.email == email).first()
            if user is None:
                user = User(email=email, session_version=0)
                db.add(user)
            else:
                user.session_version += 1
            user.name = name
            user.role = role
            user.password_hash = hash_password(password)  # fresh salt per account
            user.is_active = True
            user.failed_login_attempts = 0
            user.locked_until = None
            print(f"  {role.value:<12} {email}")
        db.commit()
    print("Demo accounts ready.")


if __name__ == "__main__":
    main()

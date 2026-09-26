"""
Set the password for a single account.

    python -m login.set_password wei.lim@connectsphere.edu        (run from the backend/ folder)

Prompts for the new password; set NEW_PASSWORD to run non-interactively.
Also clears any lockout and signs the account out everywhere.
"""

import os
import sys
from getpass import getpass

from database import SessionLocal
from login.models import User
from login.schemas import MIN_PASSWORD_LENGTH
from login.security import hash_password


def read_password() -> str:
    password = os.getenv("NEW_PASSWORD")
    if password is None:
        password = getpass("New password: ")
        if getpass("Confirm password: ") != password:
            sys.exit("Passwords don't match.")
    if len(password) < MIN_PASSWORD_LENGTH:
        sys.exit(f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
    return password


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("Usage: python -m login.set_password <email>")
    email = sys.argv[1].strip().lower()

    with SessionLocal() as db:
        user = db.query(User).filter(User.email == email).first()
        if user is None:
            sys.exit(f"No account found for {email}.")

        user.password_hash = hash_password(read_password())
        user.failed_login_attempts = 0
        user.locked_until = None
        user.session_version += 1  # revoke existing sessions
        role = user.role.value
        db.commit()
    print(f"Password updated for {email} ({role}). Existing sessions were signed out.")


if __name__ == "__main__":
    main()

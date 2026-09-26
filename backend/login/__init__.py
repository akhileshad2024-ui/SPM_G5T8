"""
Authentication and role-based access control.

  models.py        User table and the Role enum
  schemas.py       Request/response bodies for the auth endpoints
  security.py      Password hashing, session cookies, get_current_user / require_roles
  auth.py          /auth/* endpoints (login, logout, me, change-password)
  set_password.py  CLI: set one account's password       (python -m login.set_password <email>)
"""

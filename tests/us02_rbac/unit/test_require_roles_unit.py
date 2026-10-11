"""
US02 unit tests for the server-side permission check, require_roles() in
backend/login/security.py: it allows only the listed roles and refuses
everyone else with an authorisation error.
"""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from login.models import Role
from login.security import require_roles

ALL_ROLES = list(Role)


def user_with(role):
    return SimpleNamespace(role=role)


def test_allowed_role_passes_and_gets_the_user_back():
    user = user_with(Role.venue)

    assert require_roles(Role.venue)(user) is user


@pytest.mark.parametrize("role", [r for r in ALL_ROLES if r is not Role.venue])
def test_every_other_role_is_refused_with_403(role):
    with pytest.raises(HTTPException) as err:
        require_roles(Role.venue)(user_with(role))

    assert err.value.status_code == 403
    assert err.value.detail == "You don't have permission to do that"


def test_several_roles_can_be_allowed():
    check = require_roles(Role.coordinator, Role.venue)

    assert check(user_with(Role.coordinator)).role is Role.coordinator
    assert check(user_with(Role.venue)).role is Role.venue
    with pytest.raises(HTTPException):
        check(user_with(Role.attendee))


def test_no_roles_allowed_means_nobody_passes():
    for role in ALL_ROLES:
        with pytest.raises(HTTPException):
            require_roles()(user_with(role))


def test_the_check_uses_the_role_on_the_user_not_a_cached_copy():
    """A role change in the database takes effect on the very next request."""
    check = require_roles(Role.venue)
    user = user_with(Role.attendee)
    with pytest.raises(HTTPException):
        check(user)

    user.role = Role.venue

    assert check(user) is user


def test_each_endpoint_gets_its_own_check():
    assert require_roles(Role.venue) is not require_roles(Role.venue)


def test_roles_match_the_frontend():
    """lib/types.ts Role must list the same roles, or page access and API checks disagree."""
    assert [r.value for r in Role] == ["organiser", "coordinator", "venue", "tech", "attendee"]

"""
US01 — AC5: credentials are transmitted only over a secure TLS connection.

In production (APP_ENV=production) the backend rejects anything that did not
arrive over HTTPS, marks the session cookie Secure and sends HSTS. Local
development (APP_ENV=development) runs on plain http://localhost.
"""

import pytest
from fastapi.testclient import TestClient

from auth_testkit import PASSWORD, email_for, set_cookie_header
from login.models import Role
from main import app

CREDENTIALS = {"email": email_for(Role.attendee), "password": PASSWORD}


def http_client():
    return TestClient(app, base_url="http://testserver")


def https_client():
    return TestClient(app, base_url="https://testserver")


def test_login_over_plain_http_is_refused(production):
    response = http_client().post("/auth/login", json=CREDENTIALS)

    assert response.status_code == 403
    assert response.json()["detail"] == "HTTPS is required"


@pytest.mark.parametrize(
    "method, path",
    [("GET", "/auth/me"), ("POST", "/auth/logout"), ("POST", "/auth/change-password"), ("GET", "/venues")],
)
def test_every_endpoint_refuses_plain_http(production, method, path):
    assert http_client().request(method, path).status_code == 403


def test_login_over_https_succeeds(production):
    response = https_client().post("/auth/login", json=CREDENTIALS)

    assert response.status_code == 200


def test_session_cookie_is_https_only_in_production(production):
    response = https_client().post("/auth/login", json=CREDENTIALS)

    assert "secure" in set_cookie_header(response).lower()


def test_hsts_header_tells_browsers_to_always_use_https(production):
    response = https_client().post("/auth/login", json=CREDENTIALS)

    hsts = response.headers["strict-transport-security"]
    assert "max-age=63072000" in hsts
    assert "includeSubDomains" in hsts


def test_https_via_tls_terminating_proxy_is_accepted(production):
    """Hosting platforms often terminate TLS and forward over http with X-Forwarded-Proto."""
    response = http_client().post("/auth/login", json=CREDENTIALS, headers={"X-Forwarded-Proto": "https"})

    assert response.status_code == 200


def test_proxy_reporting_plain_http_is_refused(production):
    response = https_client().post("/auth/login", json=CREDENTIALS, headers={"X-Forwarded-Proto": "http"})

    assert response.status_code == 403


def test_development_allows_plain_http_on_localhost():
    response = http_client().post("/auth/login", json=CREDENTIALS)

    assert response.status_code == 200
    assert "secure" not in set_cookie_header(response).lower()
    assert "strict-transport-security" not in response.headers

"""Sign-in input validation, non-enumerating failures, closed registration and rate limiting.

Uses a fresh unregistered address per run, so no account is created or locked. Registration requests omit the
name, so even an accidentally open registration rejects them before any insert.
"""
import uuid

import requests

BASE_URL = "https://trymosaic.vercel.app"
HEADERS = {"Origin": BASE_URL}


def post(path: str, **kwargs) -> requests.Response:
    return requests.post(f"{BASE_URL}{path}", headers={**HEADERS, **kwargs.pop("headers", {})}, timeout=30, **kwargs)


def expect(res: requests.Response, status: int, code: str, message=None) -> None:
    assert res.status_code == status, (res.request.url, res.status_code, res.text)
    body = res.json()
    assert body["code"] == code, body
    if message is not None:
        assert body["error"] == message, body
    assert "set-cookie" not in {key.lower() for key in res.headers}, res.headers


def probe_email() -> str:
    return f"testsprite-{uuid.uuid4().hex}@example.com"


def test_invalid_input_is_rejected_before_any_account_lookup() -> None:
    expect(post("/api/auth/login", data="hello", headers={"Content-Type": "text/plain"}), 400, "INVALID_INPUT", "Send a JSON request.")
    expect(post("/api/auth/login", json={"email": "not-an-email", "password": "short"}), 400, "INVALID_INPUT")
    big = {"email": probe_email(), "password": "x" * 12, "padding": "x" * 120_000}
    expect(post("/api/auth/login", json=big), 400, "INVALID_INPUT", "Request is too large.")


def test_unknown_account_gets_the_generic_failure() -> None:
    res = post("/api/auth/login", json={"email": probe_email(), "password": "not-the-password-123"})
    expect(res, 401, "UNAUTHENTICATED", "Email or password is incorrect.")


def test_registration_is_closed() -> None:
    res = post("/api/auth/register", json={"email": probe_email(), "password": "not-the-password-123"})
    expect(res, 403, "FORBIDDEN", "Registration is currently closed.")


def test_repeated_failures_are_rate_limited() -> None:
    email = probe_email()
    statuses = [
        post("/api/auth/login", json={"email": email, "password": "not-the-password-123"}).status_code
        for _ in range(15)
    ]
    assert statuses == [401] * 15, statuses
    expect(
        post("/api/auth/login", json={"email": email, "password": "not-the-password-123"}),
        429,
        "RATE_LIMITED",
        "Too many sign-in attempts. Try again in 15 minutes.",
    )


test_invalid_input_is_rejected_before_any_account_lookup()
test_unknown_account_gets_the_generic_failure()
test_registration_is_closed()
test_repeated_failures_are_rate_limited()

"""Every state-changing request must come from the Mosaic origin; the guard runs before sign-in or routing."""
import uuid

import requests

BASE_URL = "https://trymosaic.vercel.app"
FOREIGN = "https://attacker.example"


def expect_forbidden(res: requests.Response) -> None:
    assert res.status_code == 403, (res.request.method, res.request.url, res.status_code, res.text)
    body = res.json()
    assert body["code"] == "FORBIDDEN", body
    assert body["error"] == "This request must come from the Mosaic application.", body
    assert "set-cookie" not in {key.lower() for key in res.headers}, res.headers


def test_foreign_and_missing_origins_are_rejected() -> None:
    workspace, task = uuid.uuid4(), uuid.uuid4()
    for method, path, body in [
        ("POST", "/api/auth/login", {"email": "probe@example.com", "password": "x" * 12}),
        ("POST", "/api/auth/register", {"email": "probe@example.com", "password": "x" * 12, "name": "Probe"}),
        ("POST", "/api/auth/logout", {}),
        ("POST", "/api/workspaces", {"name": "Forged"}),
        ("PATCH", f"/api/workspaces/{workspace}/tasks/{task}", {"status": "done"}),
    ]:
        for headers in [{"Origin": FOREIGN}, {}]:
            expect_forbidden(requests.request(method, f"{BASE_URL}{path}", json=body, headers=headers, timeout=30))


def test_lookalike_origins_are_rejected() -> None:
    for origin in [BASE_URL + ".attacker.example", BASE_URL.replace("https://", "http://"), "null"]:
        expect_forbidden(
            requests.post(f"{BASE_URL}/api/auth/login", json={}, headers={"Origin": origin}, timeout=30)
        )


test_foreign_and_missing_origins_are_rejected()
test_lookalike_origins_are_rejected()

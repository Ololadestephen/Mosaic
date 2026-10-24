"""Signed-out requests reveal nothing: every workspace route answers 401 before routing. Read-only."""
import uuid

import requests

BASE_URL = "https://mosaic-chi-one.vercel.app"


def expect_error(res: requests.Response, status: int, code: str) -> dict:
    assert res.status_code == status, (res.request.method, res.request.url, res.status_code, res.text)
    body = res.json()
    assert body["code"] == code, body
    uuid.UUID(body["requestId"])
    assert set(body) == {"error", "code", "requestId"}, sorted(body)
    assert "Error:" not in body["error"] and " at " not in body["error"], body
    return body


def test_signed_out_reads_are_rejected_before_routing() -> None:
    workspace, task = uuid.uuid4(), uuid.uuid4()
    for path in [
        "/api/session",
        "/api/workspaces",
        f"/api/workspaces/{workspace}",
        f"/api/workspaces/{workspace}/tasks/{task}",
        f"/api/workspaces/{workspace}/sources",
        "/api/not-a-route",
    ]:
        body = expect_error(requests.get(f"{BASE_URL}{path}", timeout=30), 401, "UNAUTHENTICATED")
        assert body["error"] == "Sign in to continue.", body


def test_forged_session_cookie_is_rejected() -> None:
    res = requests.get(
        f"{BASE_URL}/api/workspaces",
        cookies={"mosaic_session": uuid.uuid4().hex},
        timeout=30,
    )
    expect_error(res, 401, "UNAUTHENTICATED")


def test_signed_out_write_with_valid_origin_is_rejected() -> None:
    res = requests.post(
        f"{BASE_URL}/api/workspaces",
        json={"name": "TestSprite signed-out probe"},
        headers={"Origin": BASE_URL},
        timeout=30,
    )
    expect_error(res, 401, "UNAUTHENTICATED")


def test_unsupported_methods_are_refused() -> None:
    res = requests.delete(f"{BASE_URL}/api/workspaces", headers={"Origin": BASE_URL}, timeout=30)
    assert res.status_code == 405, res.status_code


test_signed_out_reads_are_rejected_before_routing()
test_forged_session_cookie_is_rejected()
test_signed_out_write_with_valid_origin_is_rejected()
test_unsupported_methods_are_refused()

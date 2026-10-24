"""Production readiness and browser security headers. Read-only; sends no credentials."""
import re

import requests

BASE_URL = "https://mosaic-chi-one.vercel.app"


def test_health_reports_ready_build_without_workspace_data() -> None:
    res = requests.get(f"{BASE_URL}/api/health", timeout=30)
    assert res.status_code == 200, res.text
    assert res.headers.get("cache-control") == "no-store", res.headers.get("cache-control")
    body = res.json()
    assert body["status"] == "ready", body
    assert re.fullmatch(r"[0-9a-f]{40}", body["commit"]), body
    assert set(body) == {"status", "version", "commit"}, sorted(body)


def test_pages_send_strict_security_headers() -> None:
    for path in ["/", "/login"]:
        res = requests.get(f"{BASE_URL}{path}", timeout=30)
        assert res.status_code == 200, (path, res.status_code)
        headers = res.headers
        csp = headers.get("content-security-policy", "")
        assert "default-src 'self'" in csp and "frame-ancestors 'none'" in csp, csp
        assert "form-action 'self'" in csp and "base-uri 'self'" in csp, csp
        hsts = headers.get("strict-transport-security", "")
        assert "includeSubDomains" in hsts, hsts
        assert int(re.search(r"max-age=(\d+)", hsts).group(1)) >= 31536000, hsts
        assert headers.get("x-frame-options") == "DENY", headers.get("x-frame-options")
        assert headers.get("x-content-type-options") == "nosniff"
        assert headers.get("referrer-policy") == "same-origin"
        assert "camera=()" in headers.get("permissions-policy", "")


test_health_reports_ready_build_without_workspace_data()
test_pages_send_strict_security_headers()

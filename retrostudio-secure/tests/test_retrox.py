import os
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main as retrostudio_server
from main import app, issue_session, normalize_assets, parse_session, settings
from private_encoder import encode_luau


USER_ID = "11111111-1111-4111-8111-111111111111"


def authenticated_headers(monkeypatch):
    monkeypatch.setenv("APP_SESSION_SECRET", "test-secret-with-at-least-thirty-two-characters")
    session = issue_session({"id": USER_ID})
    return {"cookie": f"rs_session={session}; rs_csrf=test-csrf-token-with-at-least-thirty-two-bytes", "X-CSRF-Token": "test-csrf-token-with-at-least-thirty-two-bytes", "X-RetroStudio-Device": "test-device-identifier-000000000000"}


def test_normalize_assets_keeps_exactly_ten_displayable_records():
    payload = {"data": [{"id": item, "name": f"Asset {item}", "creator": {"name": "Maker"}} for item in range(1, 13)]}

    results = normalize_assets(payload, "Model")

    assert len(results) == 10
    assert results[0]["id"] == "1"
    assert results[0]["creator"] == "Maker"
    assert results[0]["assetType"] == "Model"


def test_live_retrox_search_requires_server_verified_session(monkeypatch):
    monkeypatch.delenv("ROBLOX_OPEN_CLOUD_API_KEY", raising=False)
    response = TestClient(app).post("/api/retrox/assets/search", json={"keyword": "tree", "asset_type": "Model"})

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "RS-AUTH-401"


def test_authenticated_retrox_search_reports_missing_server_key_safely(monkeypatch):
    monkeypatch.delenv("ROBLOX_OPEN_CLOUD_API_KEY", raising=False)
    headers = authenticated_headers(monkeypatch)
    response = TestClient(app).post("/api/retrox/assets/search", json={"keyword": "tree", "asset_type": "Model"}, headers=headers)

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "RX-CONFIG-503"
    assert "ROBLOX_OPEN_CLOUD_API_KEY" not in response.text


def test_render_roblox_compatibility_alias_is_server_only(monkeypatch):
    monkeypatch.delenv("ROBLOX_OPEN_CLOUD_API_KEY", raising=False)
    monkeypatch.setenv("ROBLOX_API_KEY", "server-only-test-value")

    assert settings().roblox_api_key == "server-only-test-value"


def test_authenticated_ai_request_reports_missing_server_key_safely(monkeypatch):
    monkeypatch.delenv("AI_GROQ_API_KEY", raising=False)
    headers = authenticated_headers(monkeypatch)
    response = TestClient(app).post("/api/ai/chat", json={"prompt": "Create a secure Luau plan", "provider": "free"}, headers=headers)

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "RS-AI-CONFIG"
    assert "AI_GROQ_API_KEY" not in response.text


def test_cookie_session_rejects_tampering(monkeypatch):
    headers = authenticated_headers(monkeypatch)
    session = headers["cookie"].split(";", 1)[0].split("=", 1)[1]

    assert parse_session(session) is not None
    assert parse_session(f"{session}x") is None


def test_private_encoder_does_not_return_plain_source():
    output, metrics = encode_luau('print("private implementation")')

    assert "private implementation" not in output
    assert metrics["input_characters"] > 0
    assert metrics["blocks"] >= 1


def test_served_frontend_has_no_legacy_encoder_or_supabase_bundle():
    page = TestClient(app).get("/")

    assert page.status_code == 200
    assert "pako.min.js" not in page.text
    assert "@supabase/supabase-js" not in page.text
    assert "/static/app.js" in page.text


def test_safe_bundle_explicitly_locks_actions_without_server_contracts():
    bundle = (Path(__file__).resolve().parents[1] / "static" / "app.js").read_text()

    assert "data-secure-disabled" in bundle
    assert "#adminBanBtn" in bundle
    assert "#socialTabChat" in bundle


def test_validation_errors_return_a_safe_stable_application_code():
    response = TestClient(app).post("/api/retrox/assets/search", json={"keyword": ""})

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "RS-VALIDATION-422"


def test_discord_login_starts_server_side_pkce_without_browser_secrets(monkeypatch):
    monkeypatch.setenv("APP_SESSION_SECRET", "test-secret-with-at-least-thirty-two-characters")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "publishable-test-key")

    response = TestClient(app).get("/auth/login/discord", follow_redirects=False)

    assert response.status_code == 303
    assert "provider=discord" in response.headers["location"]
    assert "code_challenge=" in response.headers["location"]
    assert "rs_oauth=" in response.headers["set-cookie"]


def test_password_auth_route_is_removed_for_discord_only_login():
    response = TestClient(app).post("/auth/password", json={"email": "no@example.test", "password": "not-used-here"})

    assert response.status_code == 404


class FakeOAuthResponse:
    def __init__(self, status_code, data):
        self.status_code = status_code
        self._data = data

    def json(self):
        return self._data


class FakeOAuthClient:
    def __init__(self, response):
        self.response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, *args, **kwargs):
        return self.response


def configure_discord_oauth(monkeypatch):
    monkeypatch.setenv("APP_SESSION_SECRET", "test-secret-with-at-least-thirty-two-characters")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "publishable-test-key")


def start_discord_oauth(client):
    response = client.get("/auth/login/discord", follow_redirects=False)
    return parse_qs(urlparse(response.headers["location"]).query)["state"][0]


def test_discord_callback_exchanges_pkce_code_and_sets_http_only_session(monkeypatch):
    configure_discord_oauth(monkeypatch)
    client = TestClient(app)
    state = start_discord_oauth(client)
    monkeypatch.setattr(retrostudio_server.httpx, "AsyncClient", lambda **_: FakeOAuthClient(FakeOAuthResponse(200, {"access_token": "verified-token"})))

    async def verified(_: str):
        return {"id": USER_ID}

    monkeypatch.setattr(retrostudio_server, "verify_supabase_token", verified)
    response = client.get(f"/auth/callback?code=code-from-supabase&state={state}", follow_redirects=False)

    assert response.status_code == 303
    assert response.headers["location"] == "/"
    assert "rs_session=" in response.headers["set-cookie"]
    assert "HttpOnly" in response.headers["set-cookie"]


def test_discord_callback_rejects_invalid_state_without_exchanging_code(monkeypatch):
    configure_discord_oauth(monkeypatch)
    client = TestClient(app)
    start_discord_oauth(client)
    response = client.get("/auth/callback?code=code-from-supabase&state=not-the-issued-state", follow_redirects=False)

    assert response.status_code == 303
    assert response.headers["location"] == "/?auth_error=verification"


def test_discord_callback_handles_failed_supabase_code_exchange_safely(monkeypatch):
    configure_discord_oauth(monkeypatch)
    client = TestClient(app)
    state = start_discord_oauth(client)
    monkeypatch.setattr(retrostudio_server.httpx, "AsyncClient", lambda **_: FakeOAuthClient(FakeOAuthResponse(400, {"error": "bad_code"})))
    response = client.get(f"/auth/callback?code=expired-code&state={state}", follow_redirects=False)

    assert response.status_code == 303
    assert response.headers["location"] == "/?auth_error=discord"

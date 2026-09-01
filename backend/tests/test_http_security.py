import asyncio
import re

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.errors import SERVICE_UNAVAILABLE
from app.main import app
from app.security.auth import SupabaseSessionVerifier


def test_production_settings_disable_interactive_api_docs():
    settings = Settings(app_env="production")
    assert settings.docs_enabled is False
    assert app.docs_url is None
    assert app.openapi_url is None


def test_healthcheck_applies_security_headers_and_blocks_untrusted_hosts():
    client = TestClient(app, base_url="http://localhost")
    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]

    rejected = client.get("/healthz", headers={"host": "untrusted.example"})
    assert rejected.status_code == 400


def test_request_identifier_header_is_bounded_and_normalized():
    trusted_request_id = "trusted_request_identifier_12345"
    client = TestClient(app, base_url="http://localhost")

    trusted = client.get("/healthz", headers={"X-Request-ID": trusted_request_id})
    malformed = client.get("/healthz", headers={"X-Request-ID": "\"<untrusted>\""})

    assert trusted.headers["x-request-id"] == trusted_request_id
    assert malformed.headers["x-request-id"] != "\"<untrusted>\""
    assert re.fullmatch(r"[0-9a-f-]{36}", malformed.headers["x-request-id"])


def test_cors_configuration_does_not_allow_every_origin():
    settings = Settings(app_allowed_origins="https://app.example.test")
    assert settings.allowed_origins == ["https://app.example.test"]
    assert "*" not in settings.allowed_origins


def test_server_verifies_user_identity_with_supabase_response(monkeypatch):
    class FakeResponse:
        status_code = 200

        def json(self):
            return {
                "id": "11111111-1111-1111-1111-111111111111",
                "email_confirmed_at": "2026-01-01T00:00:00Z",
                "app_metadata": {"providers": ["google"]},
                "identities": [{"provider": "google"}],
            }

    class FakeClient:
        def __init__(self, timeout):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return False

        async def get(self, url, headers):
            assert url == "https://project.example/auth/v1/user"
            assert headers["Authorization"].startswith("Bearer ")
            assert headers["apikey"] == "publishable-test-key"
            return FakeResponse()

    monkeypatch.setattr("app.security.auth.httpx.AsyncClient", FakeClient)
    verifier = SupabaseSessionVerifier(
        Settings(supabase_url="https://project.example", supabase_publishable_key="publishable-test-key")
    )

    user = asyncio.run(verifier.verify("a" * 32))
    assert user.user_id == "11111111-1111-1111-1111-111111111111"
    assert user.email_verified is True
    assert user.providers == frozenset({"google"})
    assert user.has_approved_oauth_provider is True


def test_server_fails_closed_when_supabase_connection_is_not_configured():
    verifier = SupabaseSessionVerifier(Settings(supabase_url=None, supabase_publishable_key=None))
    try:
        asyncio.run(verifier.verify("a" * 32))
    except type(SERVICE_UNAVAILABLE) as error:
        assert error.code == "SERVICE_UNAVAILABLE"
    else:
        raise AssertionError("The verifier must fail closed without server configuration")

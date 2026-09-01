import asyncio

import pytest

from app.core.config import Settings
from app.core.errors import ACCOUNT_REVIEW, CHALLENGE_REQUIRED
from app.security.turnstile import TurnstileVerifier


def test_turnstile_requires_server_secret_for_challenged_request():
    verifier = TurnstileVerifier(Settings())
    with pytest.raises(type(ACCOUNT_REVIEW)):
        asyncio.run(verifier.verify_for_encoder("token", "request_identifier_12345"))


def test_turnstile_requires_browser_challenge_token_when_secret_exists():
    verifier = TurnstileVerifier(Settings(turnstile_secret_key="test-secret"))
    with pytest.raises(type(CHALLENGE_REQUIRED)):
        asyncio.run(verifier.verify_for_encoder(None, "request_identifier_12345"))


def test_turnstile_verifies_action_and_hostname_with_server_secret(monkeypatch):
    captured = {}

    class FakeResponse:
        status_code = 200

        def json(self):
            return {"success": True, "action": "retrostudio_encoder", "hostname": "app.example"}

    class FakeClient:
        def __init__(self, timeout):
            captured["timeout"] = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return False

        async def post(self, url, data):
            captured["url"] = url
            captured["data"] = data
            return FakeResponse()

    monkeypatch.setattr("app.security.turnstile.httpx.AsyncClient", FakeClient)
    verifier = TurnstileVerifier(
        Settings(
            turnstile_secret_key="test-secret",
            turnstile_expected_hostname="app.example",
        )
    )
    asyncio.run(verifier.verify_for_encoder("browser-token", "request_identifier_12345"))

    assert captured["url"].endswith("/turnstile/v0/siteverify")
    assert captured["data"]["secret"] == "test-secret"
    assert captured["data"]["response"] == "browser-token"
    assert captured["data"]["idempotency_key"]


@pytest.mark.parametrize(
    "payload",
    [
        {"success": False},
        {"success": True, "action": "wrong", "hostname": "app.example"},
        {"success": True, "action": "retrostudio_encoder", "hostname": "wrong.example"},
    ],
)
def test_turnstile_rejects_invalid_or_mismatched_responses(monkeypatch, payload):
    class FakeResponse:
        status_code = 200

        def json(self):
            return payload

    class FakeClient:
        def __init__(self, timeout):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return False

        async def post(self, url, data):
            return FakeResponse()

    monkeypatch.setattr("app.security.turnstile.httpx.AsyncClient", FakeClient)
    verifier = TurnstileVerifier(
        Settings(
            turnstile_secret_key="test-secret",
            turnstile_expected_hostname="app.example",
        )
    )
    with pytest.raises(type(CHALLENGE_REQUIRED)):
        asyncio.run(verifier.verify_for_encoder("browser-token", "request_identifier_12345"))

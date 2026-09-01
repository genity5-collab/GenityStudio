import asyncio

import pytest

from app.core.config import Settings
from app.core.errors import INSUFFICIENT_TOKENS, RATE_LIMITED
from app.security.supabase_gateway import SupabaseSecurityGateway


def test_private_gateway_uses_service_role_only_and_returns_authorization(monkeypatch):
    captured = {}

    class FakeResponse:
        status_code = 200

        def json(self):
            return [{"allowed": True, "decision_code": "AUTHORIZED", "tokens_remaining": 15, "risk_level": "normal"}]

    class FakeClient:
        def __init__(self, timeout):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return False

        async def post(self, url, headers, json):
            captured["url"] = url
            captured["headers"] = headers
            captured["json"] = json
            return FakeResponse()

    monkeypatch.setattr("app.security.supabase_gateway.httpx.AsyncClient", FakeClient)
    gateway = SupabaseSecurityGateway(
        Settings(supabase_url="https://project.example", supabase_service_role_key="service-role-test")
    )
    decision = asyncio.run(
        gateway.authorize_encoder(
            user_id="11111111-1111-1111-1111-111111111111",
            device_hash="a" * 64,
            request_id="request_identifier_12345",
            source_characters=42,
        )
    )

    assert decision.allowed is True
    assert captured["url"].endswith("/rest/v1/rpc/retrostudio_private_authorize_encoder")
    assert captured["headers"]["Authorization"] == "Bearer service-role-test"
    assert captured["json"]["p_user_id"] == "11111111-1111-1111-1111-111111111111"


def test_private_gateway_maps_rate_limit_decision_to_safe_error(monkeypatch):
    class FakeResponse:
        status_code = 200

        def json(self):
            return [{"allowed": False, "decision_code": "RATE_LIMITED", "tokens_remaining": 0, "risk_level": "normal"}]

    class FakeClient:
        def __init__(self, timeout):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return False

        async def post(self, url, headers, json):
            return FakeResponse()

    monkeypatch.setattr("app.security.supabase_gateway.httpx.AsyncClient", FakeClient)
    gateway = SupabaseSecurityGateway(
        Settings(supabase_url="https://project.example", supabase_service_role_key="service-role-test")
    )
    with pytest.raises(type(RATE_LIMITED)):
        asyncio.run(
            gateway.authorize_encoder(
                user_id="11111111-1111-1111-1111-111111111111",
                device_hash="a" * 64,
                request_id="request_identifier_12345",
                source_characters=42,
            )
        )


def test_private_gateway_finalizes_only_through_service_role_and_returns_balance(monkeypatch):
    captured = {}

    class FakeResponse:
        status_code = 200

        def json(self):
            return [{"finalized": True, "decision_code": "FINALIZED", "tokens_remaining": 14}]

    class FakeClient:
        def __init__(self, timeout):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return False

        async def post(self, url, headers, json):
            captured["url"] = url
            captured["headers"] = headers
            captured["json"] = json
            return FakeResponse()

    monkeypatch.setattr("app.security.supabase_gateway.httpx.AsyncClient", FakeClient)
    gateway = SupabaseSecurityGateway(
        Settings(supabase_url="https://project.example", supabase_service_role_key="service-role-test")
    )
    result = asyncio.run(
        gateway.finalize_encoder(
            user_id="11111111-1111-1111-1111-111111111111",
            device_hash="a" * 64,
            request_id="request_identifier_12345",
        )
    )

    assert result.finalized is True
    assert result.tokens_remaining == 14
    assert captured["url"].endswith("/rest/v1/rpc/retrostudio_private_finalize_encoder")
    assert captured["headers"]["Authorization"] == "Bearer service-role-test"
    assert captured["json"]["p_token_cost"] == 1


def test_private_gateway_maps_insufficient_token_finalization_to_safe_error(monkeypatch):
    class FakeResponse:
        status_code = 200

        def json(self):
            return [{"finalized": False, "decision_code": "INSUFFICIENT_TOKENS", "tokens_remaining": 0}]

    class FakeClient:
        def __init__(self, timeout):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return False

        async def post(self, url, headers, json):
            return FakeResponse()

    monkeypatch.setattr("app.security.supabase_gateway.httpx.AsyncClient", FakeClient)
    gateway = SupabaseSecurityGateway(
        Settings(supabase_url="https://project.example", supabase_service_role_key="service-role-test")
    )
    with pytest.raises(type(INSUFFICIENT_TOKENS)):
        asyncio.run(
            gateway.finalize_encoder(
                user_id="11111111-1111-1111-1111-111111111111",
                device_hash="a" * 64,
                request_id="request_identifier_12345",
            )
        )

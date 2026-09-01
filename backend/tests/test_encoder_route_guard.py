from fastapi.testclient import TestClient
import pytest
import time

from app.api import routes
from app.core.config import Settings
from app.core.errors import OUTPUT_TOO_LARGE, SERVICE_UNAVAILABLE, SecureApiError
from app.encoder.engine import DecodeResult, EncodeResult, PrivateEncoder
from app.encoder.legacy_subset import Compilation
from app.main import app
from app.security.auth import AuthenticatedUser
from app.security.supabase_gateway import EncoderAuthorization, EncoderFinalization


def test_encoder_route_fails_closed_before_authorization_side_effects():
    with TestClient(app, base_url="http://localhost") as client:
        response = client.post(
            "/api/encoder/encode",
            json={
                "source": "local part = Instance.new('Part')",
                "mode": "default",
                "device_hash": "a" * 64,
                "request_id": "private_encoder_request_12345",
            },
        )

    assert response.status_code == 503
    assert response.json() == {
        "code": "SERVICE_UNAVAILABLE",
        "message": "The secure encoder service is temporarily unavailable.",
    }


def test_successful_private_encoder_output_is_finalized_after_transformation(monkeypatch):
    calls = []

    class ReadyEncoder:
        def __init__(self, settings):
            pass

        @property
        def is_ready(self):
            return True

        def encode(self, source, mode):
            calls.append("encode")
            return EncodeResult(encoded="server-only-output", blocks=1, skipped_features=())

    class PrivateGateway:
        def __init__(self, settings):
            pass

        async def authorize_encoder(self, **kwargs):
            calls.append("authorize")
            return EncoderAuthorization(True, "AUTHORIZED", 15, "normal")

        async def finalize_encoder(self, **kwargs):
            calls.append("finalize")
            return EncoderFinalization(True, "FINALIZED", 14)

    async def verified_user(authorization, settings):
        return AuthenticatedUser("11111111-1111-1111-1111-111111111111", True)

    monkeypatch.setattr(routes, "PrivateEncoder", ReadyEncoder)
    monkeypatch.setattr(routes, "SupabaseSecurityGateway", PrivateGateway)
    monkeypatch.setattr(routes, "require_authenticated_user", verified_user)
    with TestClient(app, base_url="http://localhost") as client:
        response = client.post(
            "/api/encoder/encode",
            headers={"Authorization": "Bearer " + "a" * 32},
            json={
                "source": "local part = Instance.new('Part')",
                "mode": "default",
                "device_hash": "a" * 64,
                "request_id": "private_encoder_request_12345",
            },
        )

    assert response.status_code == 200
    assert response.json()["tokensRemaining"] == 14
    assert calls == ["authorize", "encode", "finalize"]


def test_private_encoder_failure_never_finalizes_a_token_charge(monkeypatch):
    calls = []

    class FailingEncoder:
        def __init__(self, settings):
            pass

        @property
        def is_ready(self):
            return True

        def encode(self, source, mode):
            calls.append("encode")
            raise SERVICE_UNAVAILABLE

    class PrivateGateway:
        def __init__(self, settings):
            pass

        async def authorize_encoder(self, **kwargs):
            calls.append("authorize")
            return EncoderAuthorization(True, "AUTHORIZED", 15, "normal")

        async def finalize_encoder(self, **kwargs):
            calls.append("finalize")
            return EncoderFinalization(True, "FINALIZED", 14)

    async def verified_user(authorization, settings):
        return AuthenticatedUser("11111111-1111-1111-1111-111111111111", True)

    monkeypatch.setattr(routes, "PrivateEncoder", FailingEncoder)
    monkeypatch.setattr(routes, "SupabaseSecurityGateway", PrivateGateway)
    monkeypatch.setattr(routes, "require_authenticated_user", verified_user)
    with TestClient(app, base_url="http://localhost") as client:
        response = client.post(
            "/api/encoder/encode",
            headers={"Authorization": "Bearer " + "a" * 32},
            json={
                "source": "local part = Instance.new('Part')",
                "mode": "default",
                "device_hash": "a" * 64,
                "request_id": "private_encoder_request_12345",
            },
        )

    assert response.status_code == 503
    assert calls == ["authorize", "encode"]


def test_timed_out_private_encoder_never_finalizes_a_token_charge(monkeypatch):
    calls = []

    class SlowEncoder:
        def __init__(self, settings):
            pass

        @property
        def is_ready(self):
            return True

        def encode(self, source, mode):
            calls.append("encode")
            time.sleep(0.02)
            return EncodeResult(encoded="unreachable", blocks=1, skipped_features=())

    class PrivateGateway:
        def __init__(self, settings):
            pass

        async def authorize_encoder(self, **kwargs):
            calls.append("authorize")
            return EncoderAuthorization(True, "AUTHORIZED", 15, "normal")

        async def finalize_encoder(self, **kwargs):
            calls.append("finalize")
            return EncoderFinalization(True, "FINALIZED", 14)

    async def verified_user(authorization, settings):
        return AuthenticatedUser("11111111-1111-1111-1111-111111111111", True)

    monkeypatch.setattr(routes, "PrivateEncoder", SlowEncoder)
    monkeypatch.setattr(routes, "SupabaseSecurityGateway", PrivateGateway)
    monkeypatch.setattr(routes, "require_authenticated_user", verified_user)
    with TestClient(app, base_url="http://localhost") as client:
        monkeypatch.setattr(app.state, "settings", Settings(encode_execution_timeout_seconds=0.001))
        response = client.post(
            "/api/encoder/encode",
            headers={"Authorization": "Bearer " + "a" * 32},
            json={
                "source": "local part = Instance.new('Part')",
                "mode": "default",
                "device_hash": "a" * 64,
                "request_id": "private_encoder_request_12345",
            },
        )

    assert response.status_code == 503
    assert calls == ["authorize", "encode"]


def test_protected_decode_authorizes_without_finalizing_tokens(monkeypatch):
    calls = []

    class ReadyEncoder:
        def __init__(self, settings):
            pass

        @property
        def is_ready(self):
            return True

        def decode(self, encoded):
            calls.append("decode")
            return DecodeResult(valid=True, blocks=2, audited_compatibility=True)

    class PrivateGateway:
        def __init__(self, settings):
            pass

        async def authorize_encoder(self, **kwargs):
            calls.append("authorize")
            return EncoderAuthorization(True, "AUTHORIZED", 15, "normal")

    async def verified_user(authorization, settings):
        return AuthenticatedUser("11111111-1111-1111-1111-111111111111", True)

    monkeypatch.setattr(routes, "PrivateEncoder", ReadyEncoder)
    monkeypatch.setattr(routes, "SupabaseSecurityGateway", PrivateGateway)
    monkeypatch.setattr(routes, "require_authenticated_user", verified_user)
    with TestClient(app, base_url="http://localhost") as client:
        response = client.post(
            "/api/encoder/decode",
            headers={"Authorization": "Bearer " + "a" * 32},
            json={
                "encoded": "\u001a0000000000000004\u001bfixture",
                "device_hash": "a" * 64,
                "request_id": "private_decoder_request_12345",
            },
        )

    assert response.status_code == 200
    assert response.json() == {"valid": True, "blocks": 2, "auditedCompatibility": True}
    assert calls == ["authorize", "decode"]


def test_private_parity_compiler_honors_the_server_output_limit(monkeypatch):
    compiled = PrivateEncoder(Settings(max_encode_response_characters=10_000)).compile_for_parity('print("safe")')
    assert compiled.blocks == 1

    class OversizedCompiler:
        def compile(self, source):
            return Compilation(serialized="", encoded="x" * 10_001, blocks=1, skipped_features=())

    monkeypatch.setattr("app.encoder.engine.LegacySubsetCompiler", OversizedCompiler)
    with pytest.raises(SecureApiError) as raised:
        PrivateEncoder(Settings(max_encode_response_characters=10_000)).compile_for_parity('print("safe")')
    assert raised.value is OUTPUT_TOO_LARGE

from pathlib import Path

import pytest

from app.core.config import Settings
from app.core.errors import AUTH_REQUIRED, INPUT_TOO_LARGE, INVALID_INPUT, SERVICE_UNAVAILABLE
from app.encoder.engine import PrivateEncoder
from app.security.auth import read_bearer_token


def test_private_encoder_rejects_empty_and_oversized_source():
    encoder = PrivateEncoder(Settings(max_encode_characters=1_000))
    with pytest.raises(type(INVALID_INPUT)):
        encoder.validate_source("  ")
    with pytest.raises(type(INPUT_TOO_LARGE)):
        encoder.validate_source("a" * 1_001)


def test_private_encoder_never_invents_legacy_output_before_parity_port():
    encoder = PrivateEncoder(Settings())
    with pytest.raises(type(SERVICE_UNAVAILABLE)):
        encoder.encode('print("hello")', "default")


def test_malformed_or_missing_bearer_tokens_are_rejected():
    with pytest.raises(type(AUTH_REQUIRED)):
        read_bearer_token(None)
    with pytest.raises(type(AUTH_REQUIRED)):
        read_bearer_token("Bearer not a jwt")


def test_encoder_finalization_migration_is_private_device_bound_and_ledger_backed():
    project_root = Path(__file__).resolve().parents[2]
    migration = (project_root / "supabase/migrations/20260825_private_encoder_finalize_and_device_binding.sql").read_text()

    assert "retrostudio_private_finalize_encoder" in migration
    assert "p_device_hash" in migration
    assert "authorized_at" in migration
    assert "RETROSTUDIO_TOKEN_LEDGER" in migration
    assert "grant execute on function public.retrostudio_private_finalize_encoder" in migration
    assert "to service_role" in migration
    assert "from public, anon, authenticated" in migration


def test_ledger_history_is_a_private_risk_signal_not_a_browser_claim():
    project_root = Path(__file__).resolve().parents[2]
    migration = (project_root / "supabase/migrations/20260825_encoder_ledger_history_risk_signal.sql").read_text()

    assert "RETROSTUDIO_TOKEN_LEDGER" in migration
    assert "RETROSTUDIO_SECURITY_EVENTS" in migration
    assert "v_recent_successes >= 8 or v_recent_denials >= 3" in migration
    assert "v_risk_level := 'suspicious'" in migration
    assert "from public, anon, authenticated" in migration


def test_private_encoder_has_server_side_concurrency_and_execution_bounds():
    project_root = Path(__file__).resolve().parents[2]
    config = (project_root / "backend/app/core/config.py").read_text()
    application = (project_root / "backend/app/main.py").read_text()
    route = (project_root / "backend/app/api/routes.py").read_text()

    assert "max_encode_concurrency" in config
    assert "encode_execution_timeout_seconds" in config
    assert "encoder_semaphore" in application
    assert "asyncio.wait_for" in route
    assert "asyncio.to_thread" in route

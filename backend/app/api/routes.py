import asyncio

from fastapi import APIRouter, Header, Request
from pydantic import BaseModel, ConfigDict, Field

from app.core.config import Settings
from app.core.errors import SERVICE_UNAVAILABLE
from app.encoder.engine import PrivateEncoder
from app.security.auth import require_authenticated_user
from app.security.supabase_gateway import SupabaseSecurityGateway
from app.security.turnstile import TurnstileVerifier


router = APIRouter(prefix="/api", tags=["secure-api"])


class EncodeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)

    source: str = Field(min_length=1)
    mode: str = Field(default="default", pattern="^(default|strict)$")
    device_hash: str = Field(pattern="^[a-f0-9]{64}$")
    request_id: str = Field(min_length=16, max_length=128, pattern="^[A-Za-z0-9_-]+$")
    turnstile_token: str | None = Field(default=None, min_length=1, max_length=2048)


class DecodeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)

    encoded: str = Field(min_length=1)
    device_hash: str = Field(pattern="^[a-f0-9]{64}$")
    request_id: str = Field(min_length=16, max_length=128, pattern="^[A-Za-z0-9_-]+$")
    turnstile_token: str | None = Field(default=None, min_length=1, max_length=2048)


@router.post("/encoder/encode")
async def encode_source(
    payload: EncodeRequest,
    request: Request,
    authorization: str | None = Header(default=None),
):
    settings: Settings = request.app.state.settings
    encoder = PrivateEncoder(settings)
    # Do not create server-side request records until the private parity port is
    # ready to return an actual legacy-compatible result.
    if not encoder.is_ready:
        raise SERVICE_UNAVAILABLE
    async with request.app.state.encoder_semaphore:
        # Identity is derived from the verified session, never from the request body.
        user = await require_authenticated_user(authorization, settings)
        gateway = SupabaseSecurityGateway(settings)
        authorization_decision = await gateway.authorize_encoder(
            user_id=user.user_id,
            device_hash=payload.device_hash,
            request_id=payload.request_id,
            source_characters=len(payload.source),
        )
        if authorization_decision.risk_level in settings.turnstile_challenge_risk_levels:
            await TurnstileVerifier(settings).verify_for_encoder(payload.turnstile_token, payload.request_id)
        try:
            result = await asyncio.wait_for(
                asyncio.to_thread(encoder.encode, payload.source, payload.mode),
                timeout=settings.encode_execution_timeout_seconds,
            )
        except TimeoutError as exc:
            # No finalization occurs after a timed-out transformation.
            raise SERVICE_UNAVAILABLE from exc
        finalization = await gateway.finalize_encoder(
            user_id=user.user_id,
            device_hash=payload.device_hash,
            request_id=payload.request_id,
        )
    return {
        "encoded": result.encoded,
        "blocks": result.blocks,
        "skippedFeatures": list(result.skipped_features),
        "tokensRemaining": finalization.tokens_remaining,
        "auditedCompatibility": True,
    }


@router.post("/encoder/decode")
async def decode_source(
    payload: DecodeRequest,
    request: Request,
    authorization: str | None = Header(default=None),
):
    settings: Settings = request.app.state.settings
    encoder = PrivateEncoder(settings)
    if not encoder.is_ready:
        raise SERVICE_UNAVAILABLE
    async with request.app.state.encoder_semaphore:
        user = await require_authenticated_user(authorization, settings)
        gateway = SupabaseSecurityGateway(settings)
        authorization_decision = await gateway.authorize_encoder(
            user_id=user.user_id,
            device_hash=payload.device_hash,
            request_id=payload.request_id,
            source_characters=len(payload.encoded),
        )
        if authorization_decision.risk_level in settings.turnstile_challenge_risk_levels:
            await TurnstileVerifier(settings).verify_for_encoder(payload.turnstile_token, payload.request_id)
        try:
            result = await asyncio.wait_for(
                asyncio.to_thread(encoder.decode, payload.encoded),
                timeout=settings.encode_execution_timeout_seconds,
            )
        except TimeoutError as exc:
            raise SERVICE_UNAVAILABLE from exc
    return {
        "valid": result.valid,
        "blocks": result.blocks,
        "auditedCompatibility": result.audited_compatibility,
    }

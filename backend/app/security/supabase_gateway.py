from dataclasses import dataclass

import httpx

from app.core.config import Settings
from app.core.errors import ACCOUNT_REVIEW, FORBIDDEN, INSUFFICIENT_TOKENS, RATE_LIMITED, REPLAY_REJECTED, SERVICE_UNAVAILABLE


@dataclass(frozen=True, slots=True)
class EncoderAuthorization:
    allowed: bool
    decision_code: str
    tokens_remaining: float
    risk_level: str


@dataclass(frozen=True, slots=True)
class EncoderFinalization:
    finalized: bool
    decision_code: str
    tokens_remaining: float


class SupabaseSecurityGateway:
    """Calls only private service-role Supabase procedures from the FastAPI server."""

    def __init__(self, settings: Settings):
        self._settings = settings

    async def authorize_encoder(self, *, user_id: str, device_hash: str, request_id: str, source_characters: int) -> EncoderAuthorization:
        if not self._settings.supabase_url or not self._settings.effective_supabase_service_role_key:
            raise SERVICE_UNAVAILABLE
        try:
            async with httpx.AsyncClient(timeout=self._settings.auth_timeout_seconds) as client:
                response = await client.post(
                    f"{self._settings.supabase_url.rstrip('/')}/rest/v1/rpc/retrostudio_private_authorize_encoder",
                    headers={
                        "apikey": self._settings.effective_supabase_service_role_key,
                        "Authorization": f"Bearer {self._settings.effective_supabase_service_role_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "p_user_id": user_id,
                        "p_device_hash": device_hash,
                        "p_request_id": request_id,
                        "p_source_characters": source_characters,
                    },
                )
        except httpx.HTTPError as exc:
            raise SERVICE_UNAVAILABLE from exc
        if response.status_code != 200:
            raise SERVICE_UNAVAILABLE
        payload = response.json()
        if not isinstance(payload, list) or len(payload) != 1 or not isinstance(payload[0], dict):
            raise SERVICE_UNAVAILABLE
        row = payload[0]
        decision = EncoderAuthorization(
            allowed=row.get("allowed") is True,
            decision_code=str(row.get("decision_code") or "SERVICE_UNAVAILABLE"),
            tokens_remaining=float(row.get("tokens_remaining") or 0),
            risk_level=str(row.get("risk_level") or "normal"),
        )
        if not decision.allowed:
            self._raise_decision_error(decision.decision_code)
        return decision

    async def finalize_encoder(
        self,
        *,
        user_id: str,
        device_hash: str,
        request_id: str,
        token_cost: float = 1,
    ) -> EncoderFinalization:
        if not self._settings.supabase_url or not self._settings.effective_supabase_service_role_key:
            raise SERVICE_UNAVAILABLE
        try:
            async with httpx.AsyncClient(timeout=self._settings.auth_timeout_seconds) as client:
                response = await client.post(
                    f"{self._settings.supabase_url.rstrip('/')}/rest/v1/rpc/retrostudio_private_finalize_encoder",
                    headers={
                        "apikey": self._settings.effective_supabase_service_role_key,
                        "Authorization": f"Bearer {self._settings.effective_supabase_service_role_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "p_user_id": user_id,
                        "p_device_hash": device_hash,
                        "p_request_id": request_id,
                        "p_token_cost": token_cost,
                    },
                )
        except httpx.HTTPError as exc:
            raise SERVICE_UNAVAILABLE from exc
        if response.status_code != 200:
            raise SERVICE_UNAVAILABLE
        payload = response.json()
        if not isinstance(payload, list) or len(payload) != 1 or not isinstance(payload[0], dict):
            raise SERVICE_UNAVAILABLE
        row = payload[0]
        decision = EncoderFinalization(
            finalized=row.get("finalized") is True,
            decision_code=str(row.get("decision_code") or "SERVICE_UNAVAILABLE"),
            tokens_remaining=float(row.get("tokens_remaining") or 0),
        )
        if not decision.finalized:
            self._raise_finalization_error(decision.decision_code)
        return decision

    @staticmethod
    def _raise_decision_error(decision_code: str) -> None:
        if decision_code == "REPLAY_REJECTED":
            raise REPLAY_REJECTED
        if decision_code == "RATE_LIMITED":
            raise RATE_LIMITED
        if decision_code == "ACCOUNT_REVIEW":
            raise ACCOUNT_REVIEW
        if decision_code == "ACCOUNT_RESTRICTED":
            raise FORBIDDEN
        raise SERVICE_UNAVAILABLE

    @staticmethod
    def _raise_finalization_error(decision_code: str) -> None:
        if decision_code == "INSUFFICIENT_TOKENS":
            raise INSUFFICIENT_TOKENS
        if decision_code == "ACCOUNT_REVIEW":
            raise ACCOUNT_REVIEW
        if decision_code == "NOT_AUTHORIZED":
            raise FORBIDDEN
        raise SERVICE_UNAVAILABLE

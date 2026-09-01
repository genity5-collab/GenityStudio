import uuid

import httpx

from app.core.config import Settings
from app.core.errors import ACCOUNT_REVIEW, CHALLENGE_REQUIRED, SERVICE_UNAVAILABLE


class TurnstileVerifier:
    """Validates a one-time human-verification token only from the trusted API."""

    _siteverify_url = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

    def __init__(self, settings: Settings):
        self._settings = settings

    async def verify_for_encoder(self, token: str | None, request_id: str) -> None:
        if not self._settings.turnstile_secret_key:
            raise ACCOUNT_REVIEW
        if not isinstance(token, str) or not token or len(token) > 2048:
            raise CHALLENGE_REQUIRED

        try:
            async with httpx.AsyncClient(timeout=self._settings.turnstile_timeout_seconds) as client:
                response = await client.post(
                    self._siteverify_url,
                    data={
                        "secret": self._settings.turnstile_secret_key,
                        "response": token,
                        "idempotency_key": str(uuid.uuid5(uuid.NAMESPACE_URL, request_id)),
                    },
                )
        except httpx.HTTPError as exc:
            raise SERVICE_UNAVAILABLE from exc
        if response.status_code != 200:
            raise SERVICE_UNAVAILABLE
        payload = response.json()
        if not isinstance(payload, dict) or payload.get("success") is not True:
            raise CHALLENGE_REQUIRED
        if payload.get("action") != self._settings.turnstile_expected_action:
            raise CHALLENGE_REQUIRED
        expected_hostname = self._settings.turnstile_expected_hostname.strip().lower()
        if expected_hostname and str(payload.get("hostname") or "").lower() != expected_hostname:
            raise CHALLENGE_REQUIRED

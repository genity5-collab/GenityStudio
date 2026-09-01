import re
from dataclasses import dataclass, field

import httpx

from app.core.config import Settings
from app.core.errors import AUTH_REQUIRED, SERVICE_UNAVAILABLE, SecureApiError


_BEARER_PATTERN = re.compile(r"^[A-Za-z0-9._-]{20,4096}$")
APPROVED_OAUTH_PROVIDERS = frozenset({"google", "discord"})


@dataclass(frozen=True, slots=True)
class AuthenticatedUser:
    user_id: str
    email_verified: bool
    providers: frozenset[str] = field(default_factory=frozenset)

    @property
    def has_approved_oauth_provider(self) -> bool:
        return bool(self.providers & APPROVED_OAUTH_PROVIDERS)


def read_bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise AUTH_REQUIRED
    token = authorization.removeprefix("Bearer ").strip()
    if not _BEARER_PATTERN.fullmatch(token):
        raise AUTH_REQUIRED
    return token


class SupabaseSessionVerifier:
    """Validates the actual session with Supabase; it never trusts browser user IDs."""

    def __init__(self, settings: Settings):
        self._settings = settings

    async def verify(self, bearer_token: str) -> AuthenticatedUser:
        if not self._settings.supabase_url or not self._settings.effective_supabase_publishable_key:
            raise SERVICE_UNAVAILABLE

        try:
            async with httpx.AsyncClient(timeout=self._settings.auth_timeout_seconds) as client:
                response = await client.get(
                    f"{self._settings.supabase_url.rstrip('/')}/auth/v1/user",
                    headers={
                        "apikey": self._settings.effective_supabase_publishable_key,
                        "Authorization": f"Bearer {bearer_token}",
                    },
                )
        except httpx.HTTPError as exc:
            raise SERVICE_UNAVAILABLE from exc

        if response.status_code in {401, 403}:
            raise AUTH_REQUIRED
        if response.status_code != 200:
            raise SERVICE_UNAVAILABLE

        payload = response.json()
        user_id = payload.get("id")
        if not isinstance(user_id, str) or not user_id:
            raise AUTH_REQUIRED
        providers = {
            provider.lower()
            for provider in payload.get("app_metadata", {}).get("providers", [])
            if isinstance(provider, str)
        }
        providers.update(
            identity.get("provider", "").lower()
            for identity in payload.get("identities", [])
            if isinstance(identity, dict) and isinstance(identity.get("provider"), str)
        )
        return AuthenticatedUser(
            user_id=user_id,
            email_verified=bool(payload.get("email_confirmed_at")),
            providers=frozenset(providers),
        )


async def require_authenticated_user(authorization: str | None, settings: Settings) -> AuthenticatedUser:
    token = read_bearer_token(authorization)
    return await SupabaseSessionVerifier(settings).verify(token)

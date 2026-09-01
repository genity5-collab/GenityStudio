from functools import lru_cache
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    app_allowed_origins: str = ""
    app_allowed_hosts: str = "localhost,127.0.0.1"
    supabase_url: str | None = None
    supabase_publishable_key: str | None = None
    supabase_service_role_key: str | None = None
    supabase_legacy_server_key: str | None = Field(default=None, validation_alias="SUPABASE_KEY", exclude=True)
    app_internal_signing_secret: str | None = None
    turnstile_secret_key: str | None = None
    turnstile_expected_hostname: str = ""
    turnstile_expected_action: str = "retrostudio_encoder"
    turnstile_timeout_seconds: float = Field(default=5.0, gt=0, le=15)
    max_encode_characters: int = Field(default=120_000, ge=1_000, le=500_000)
    max_encode_response_characters: int = Field(default=600_000, ge=10_000, le=1_500_000)
    max_decode_serialized_characters: int = Field(default=750_000, ge=10_000, le=2_000_000)
    max_encode_concurrency: int = Field(default=4, ge=1, le=20)
    encode_execution_timeout_seconds: float = Field(default=12.0, gt=0, le=45)
    limited_compatibility_enabled: bool = False
    auth_timeout_seconds: float = Field(default=5.0, gt=0, le=15)

    @field_validator("app_env", mode="before")
    @classmethod
    def normalize_environment(cls, value: str) -> str:
        normalized = str(value or "development").strip().lower()
        aliases = {"dev": "development", "prod": "production"}
        normalized = aliases.get(normalized, normalized)
        if normalized not in {"development", "staging", "production"}:
            raise ValueError("APP_ENV must be development, staging, or production")
        return normalized

    @property
    def allowed_origins(self) -> list[str]:
        return [value.strip().rstrip("/") for value in self.app_allowed_origins.split(",") if value.strip()]

    @property
    def allowed_hosts(self) -> list[str]:
        return [value.strip() for value in self.app_allowed_hosts.split(",") if value.strip()]

    @property
    def docs_enabled(self) -> bool:
        return self.app_env != "production"

    @property
    def effective_supabase_publishable_key(self) -> str | None:
        return self.supabase_publishable_key or self.supabase_legacy_server_key

    @property
    def effective_supabase_service_role_key(self) -> str | None:
        return self.supabase_service_role_key or self.supabase_legacy_server_key

    @property
    def turnstile_challenge_risk_levels(self) -> frozenset[str]:
        return frozenset({"suspicious", "high"})


@lru_cache
def get_settings() -> Settings:
    return Settings()

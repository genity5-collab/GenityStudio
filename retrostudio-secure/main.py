"""Production FastAPI host for the preserved RetroStudio user interface.

Only public presentation assets are served to the browser. Authentication,
authorization, token accounting, audit events, and Roblox credentials remain
server-side or in Supabase.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import time
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlencode, urlparse

import httpx
from fastapi import Cookie, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from starlette.middleware.base import BaseHTTPMiddleware

from private_encoder import EncoderInputError, encode_luau

LOGGER = logging.getLogger("retrostudio")
APP_DIR = Path(__file__).parent
UI_HTML = APP_DIR / "ui.html"
STATIC_DIR = APP_DIR / "static"
ROBLOX_SEARCH_URL = "https://apis.roblox.com/toolbox-service/v2/assets:search"
RESULT_LIMIT = 10
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{16,128}$")
ALLOWED_ASSET_TYPES = {"Image", "Model", "Decal", "Mesh", "Audio"}


@dataclass(frozen=True)
class Settings:
    environment: str
    supabase_url: str | None
    supabase_publishable_key: str | None
    supabase_service_role_key: str | None
    session_secret: str
    device_pepper: str
    public_base_url: str | None
    cors_origins: tuple[str, ...]
    turnstile_secret: str | None
    roblox_api_key: str | None

    @property
    def production(self) -> bool:
        return self.environment.lower() == "production"


def settings() -> Settings:
    origins = tuple(item.strip().rstrip("/") for item in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",") if item.strip())
    return Settings(
        environment=os.getenv("APP_ENV", "development"),
        supabase_url=os.getenv("SUPABASE_URL", "").rstrip("/") or None,
        supabase_publishable_key=os.getenv("SUPABASE_PUBLISHABLE_KEY", "") or None,
        supabase_service_role_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY", "") or None,
        session_secret=os.getenv("APP_SESSION_SECRET", ""),
        device_pepper=os.getenv("DEVICE_HASH_PEPPER", "") or os.getenv("APP_SESSION_SECRET", ""),
        public_base_url=os.getenv("PUBLIC_BASE_URL", "").rstrip("/") or None,
        cors_origins=origins,
        turnstile_secret=os.getenv("TURNSTILE_SECRET_KEY", "") or None,
        roblox_api_key=os.getenv("ROBLOX_OPEN_CLOUD_API_KEY", "") or os.getenv("ROBLOX_API_KEY", "") or None,
    )


class PasswordRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class EncoderRequest(BaseModel):
    source: str = Field(min_length=1, max_length=16_000)
    request_id: str = Field(min_length=16, max_length=128)
    turnstile_token: str | None = Field(default=None, max_length=4096)

    @field_validator("request_id")
    @classmethod
    def valid_request_id(cls, value: str) -> str:
        if not REQUEST_ID_PATTERN.fullmatch(value):
            raise ValueError("Invalid request identifier.")
        return value


class AssetSearchRequest(BaseModel):
    keyword: str = Field(min_length=1, max_length=80)
    asset_type: Literal["Image", "Model", "Decal", "Mesh", "Audio"] = "Model"

    @field_validator("keyword")
    @classmethod
    def normalize_keyword(cls, value: str) -> str:
        result = " ".join(value.split())
        if not result:
            raise ValueError("Enter an asset keyword.")
        return result


class AiChatRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4_000)
    provider: Literal["gemini", "chatgpt", "claude", "grok", "qwen", "mistral", "kimi", "free"] = "free"

    @field_validator("prompt")
    @classmethod
    def normalize_prompt(cls, value: str) -> str:
        result = value.strip()
        if not result:
            raise ValueError("Enter a message first.")
        return result


class SessionExchangeRequest(BaseModel):
    access_token: str = Field(min_length=20, max_length=8192)


class SlidingRateLimit:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str, limit: int, window_seconds: int) -> bool:
        now = time.monotonic()
        hits = self._hits[key]
        while hits and now - hits[0] >= window_seconds:
            hits.popleft()
        if len(hits) >= limit:
            return False
        hits.append(now)
        return True


RATE_LIMITER = SlidingRateLimit()
ENCODER_SEMAPHORE = asyncio.Semaphore(2)
app = FastAPI(title="New RetroStudio Encoder", docs_url=None, redoc_url=None, openapi_url=None, debug=False)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings().cors_origins),
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type", "X-CSRF-Token", "X-RetroStudio-Device"],
)


class SecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Any) -> Response:
        content_length = request.headers.get("content-length")
        if content_length and content_length.isdigit() and int(content_length) > 32_768:
            return safe_error(413, "RS-BODY-413", "Request is too large.")

        response: Response = await call_next(request)
        policy = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob: https:; connect-src 'self'; font-src 'self' data:; "
            "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
        )
        response.headers["Content-Security-Policy"] = policy
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"
        if settings().production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


app.add_middleware(SecurityMiddleware)


def safe_error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"detail": {"code": code, "message": message}}, status_code=status)


@app.exception_handler(HTTPException)
async def http_error_handler(_: Request, error: HTTPException) -> JSONResponse:
    detail = error.detail if isinstance(error.detail, dict) else {"code": "RS-REQUEST", "message": "Request could not be completed."}
    return JSONResponse({"detail": detail}, status_code=error.status_code)


@app.exception_handler(Exception)
async def unknown_error_handler(_: Request, error: Exception) -> JSONResponse:
    trace_id = secrets.token_hex(8)
    LOGGER.error("unexpected_request_error trace_id=%s class=%s", trace_id, type(error).__name__)
    return safe_error(500, f"RS-INTERNAL-{trace_id}", "The request could not be completed safely.")


def b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def issue_session(user: dict[str, Any]) -> str:
    config = settings()
    if len(config.session_secret) < 32:
        raise HTTPException(status_code=503, detail={"code": "RS-CONFIG-503", "message": "Secure sessions are not configured."})
    subject = str(user.get("id", ""))
    if not re.fullmatch(r"[0-9a-f-]{36}", subject):
        raise HTTPException(status_code=401, detail={"code": "RS-AUTH-401", "message": "Unable to verify this session."})
    payload = {"sub": subject, "exp": int(time.time()) + 3600, "sid": secrets.token_urlsafe(18)}
    encoded = b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(config.session_secret.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).digest()
    return f"{encoded}.{b64url(signature)}"


def parse_session(raw: str | None) -> dict[str, Any] | None:
    if not raw or "." not in raw:
        return None
    config = settings()
    if len(config.session_secret) < 32:
        return None
    encoded, received = raw.rsplit(".", 1)
    expected = b64url(hmac.new(config.session_secret.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).digest())
    if not hmac.compare_digest(received, expected):
        return None
    try:
        payload = json.loads(b64url_decode(encoded))
    except (ValueError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or int(payload.get("exp", 0)) <= int(time.time()):
        return None
    if not re.fullmatch(r"[0-9a-f-]{36}", str(payload.get("sub", ""))):
        return None
    return payload


def request_ip_key(request: Request) -> str:
    value = request.client.host if request.client else "unknown"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def device_hash(request: Request, user_id: str) -> str:
    candidate = request.headers.get("X-RetroStudio-Device", "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{16,128}", candidate):
        candidate = "unbound"
    pepper = settings().device_pepper
    return hashlib.sha256(f"{pepper}:{user_id}:{candidate}".encode("utf-8")).hexdigest()


def csrf_valid(request: Request) -> bool:
    cookie = request.cookies.get("rs_csrf", "")
    submitted = request.headers.get("X-CSRF-Token", "")
    return len(cookie) >= 32 and hmac.compare_digest(cookie, submitted)


def require_user(request: Request, *, csrf: bool = True) -> dict[str, Any]:
    session = parse_session(request.cookies.get("rs_session"))
    if not session:
        raise HTTPException(status_code=401, detail={"code": "RS-AUTH-401", "message": "Sign in is required for this operation."})
    if csrf and request.method in {"POST", "PUT", "PATCH", "DELETE"} and not csrf_valid(request):
        raise HTTPException(status_code=403, detail={"code": "RS-CSRF-403", "message": "Security verification failed. Refresh and try again."})
    return session


def enforce_rate_limit(request: Request, user_id: str, operation: str, limit: int, window_seconds: int) -> None:
    account_key = f"account:{operation}:{user_id}"
    network_key = f"network:{operation}:{request_ip_key(request)}"
    if not RATE_LIMITER.allow(account_key, limit, window_seconds) or not RATE_LIMITER.allow(network_key, limit * 2, window_seconds):
        raise HTTPException(status_code=429, detail={"code": "RS-RATE-429", "message": "Too many requests. Please wait before trying again."})


def require_supabase(*, service_role: bool = False) -> Settings:
    config = settings()
    if not config.supabase_url or not config.supabase_publishable_key or (service_role and not config.supabase_service_role_key):
        raise HTTPException(status_code=503, detail={"code": "RS-CONFIG-503", "message": "The secure data service is not configured."})
    return config


async def verify_supabase_token(access_token: str) -> dict[str, Any]:
    config = require_supabase()
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(
                f"{config.supabase_url}/auth/v1/user",
                headers={"apikey": config.supabase_publishable_key or "", "Authorization": f"Bearer {access_token}"},
            )
    except httpx.RequestError:
        raise HTTPException(status_code=503, detail={"code": "RS-AUTH-503", "message": "Authentication is temporarily unavailable."}) from None
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail={"code": "RS-AUTH-401", "message": "Sign in could not be verified."})
    body = response.json()
    if not isinstance(body, dict) or not body.get("id"):
        raise HTTPException(status_code=401, detail={"code": "RS-AUTH-401", "message": "Sign in could not be verified."})
    return body


async def supabase_service_rpc(function_name: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
    config = require_supabase(service_role=True)
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.post(
                f"{config.supabase_url}/rest/v1/rpc/{function_name}",
                headers={"apikey": config.supabase_service_role_key or "", "Authorization": f"Bearer {config.supabase_service_role_key}", "Content-Type": "application/json"},
                json=payload,
            )
    except httpx.RequestError:
        raise HTTPException(status_code=503, detail={"code": "RS-DATA-503", "message": "Authorization is temporarily unavailable."}) from None
    if response.status_code >= 400:
        LOGGER.warning("supabase_rpc_failed function=%s status=%s", function_name, response.status_code)
        raise HTTPException(status_code=503, detail={"code": "RS-DATA-503", "message": "Authorization is temporarily unavailable."})
    data = response.json()
    return data if isinstance(data, list) else []


async def audit_event(user_id: str | None, event_type: str, request_id: str | None, device: str | None, detail: dict[str, str]) -> None:
    config = settings()
    if not config.supabase_url or not config.supabase_service_role_key:
        return
    safe_detail = {key: value[:120] for key, value in detail.items() if isinstance(value, str)}
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            await client.post(
                f"{config.supabase_url}/rest/v1/RETROSTUDIO_SECURITY_EVENTS",
                headers={"apikey": config.supabase_service_role_key, "Authorization": f"Bearer {config.supabase_service_role_key}", "Content-Type": "application/json"},
                json={"subject_user_id": user_id, "event_type": event_type, "request_id": request_id, "device_hash": device, "detail": safe_detail},
            )
    except httpx.RequestError:
        LOGGER.warning("security_audit_write_unavailable event=%s", event_type)


async def verify_turnstile(token: str | None, request: Request) -> bool:
    secret = settings().turnstile_secret
    if not secret or not token:
        return False
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            response = await client.post("https://challenges.cloudflare.com/turnstile/v0/siteverify", data={"secret": secret, "response": token})
        data = response.json()
        return bool(data.get("success"))
    except (httpx.RequestError, ValueError):
        return False


async def call_ai_provider(provider: str, prompt: str) -> str:
    """Use fixed provider URLs and Render-only keys; never accept a browser API key."""
    openai_compatible = {
        "chatgpt": ("AI_OPENAI_API_KEY", "https://api.openai.com/v1/chat/completions", "gpt-4.1-mini"),
        "grok": ("AI_XAI_API_KEY", "https://api.x.ai/v1/chat/completions", "grok-3-mini"),
        "qwen": ("AI_QWEN_API_KEY", "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", "qwen-plus"),
        "mistral": ("AI_MISTRAL_API_KEY", "https://api.mistral.ai/v1/chat/completions", "mistral-small-latest"),
        "kimi": ("AI_MOONSHOT_API_KEY", "https://api.moonshot.cn/v1/chat/completions", "moonshot-v1-8k"),
        "free": ("AI_GROQ_API_KEY", "https://api.groq.com/openai/v1/chat/completions", "openai/gpt-oss-20b"),
    }
    if provider == "gemini":
        key = os.getenv("AI_GEMINI_API_KEY", "")
        if not key:
            raise HTTPException(status_code=503, detail={"code": "RS-AI-CONFIG", "message": "This server-side AI provider is not configured."})
        try:
            async with httpx.AsyncClient(timeout=25.0) as client:
                response = await client.post(
                    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
                    headers={"x-goog-api-key": key, "Content-Type": "application/json"},
                    json={"contents": [{"role": "user", "parts": [{"text": prompt}]}], "generationConfig": {"maxOutputTokens": 1200}},
                )
            body = response.json()
            content = body.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text") if isinstance(body, dict) else None
        except (httpx.RequestError, ValueError, IndexError, AttributeError):
            response, content = None, None
        if response is None or not response.is_success or not isinstance(content, str) or not content.strip():
            raise HTTPException(status_code=503, detail={"code": "RS-AI-UPLINK", "message": "The server-side AI provider is temporarily unavailable."})
        return content.strip()[:12_000]

    if provider == "claude":
        key = os.getenv("AI_ANTHROPIC_API_KEY", "")
        if not key:
            raise HTTPException(status_code=503, detail={"code": "RS-AI-CONFIG", "message": "This server-side AI provider is not configured."})
        try:
            async with httpx.AsyncClient(timeout=25.0) as client:
                response = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={"x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json"},
                    json={"model": "claude-3-5-haiku-latest", "max_tokens": 1200, "messages": [{"role": "user", "content": prompt}]},
                )
            body = response.json()
            content = body.get("content", [{}])[0].get("text") if isinstance(body, dict) else None
        except (httpx.RequestError, ValueError, IndexError, AttributeError):
            response, content = None, None
        if response is None or not response.is_success or not isinstance(content, str) or not content.strip():
            raise HTTPException(status_code=503, detail={"code": "RS-AI-UPLINK", "message": "The server-side AI provider is temporarily unavailable."})
        return content.strip()[:12_000]

    secret_name, url, model = openai_compatible[provider]
    key = os.getenv(secret_name, "")
    if not key:
        raise HTTPException(status_code=503, detail={"code": "RS-AI-CONFIG", "message": "This server-side AI provider is not configured."})
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            response = await client.post(
                url,
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={"model": model, "messages": [{"role": "user", "content": prompt}], "max_tokens": 1200, "temperature": 0.5},
            )
        body = response.json()
        content = body.get("choices", [{}])[0].get("message", {}).get("content") if isinstance(body, dict) else None
    except (httpx.RequestError, ValueError, IndexError, AttributeError):
        response, content = None, None
    if response is None or not response.is_success or not isinstance(content, str) or not content.strip():
        raise HTTPException(status_code=503, detail={"code": "RS-AI-UPLINK", "message": "The server-side AI provider is temporarily unavailable."})
    return content.strip()[:12_000]


def safe_thumbnail_url(value: Any, asset_id: str) -> str:
    if isinstance(value, str) and urlparse(value).scheme == "https":
        return value
    return f"https://www.roblox.com/asset-thumbnail/image?assetId={asset_id}&width=420&height=420&format=png"


def get_string(source: dict[str, Any], *keys: str, default: str = "") -> str:
    for key in keys:
        item = source.get(key)
        if isinstance(item, str) and item.strip():
            return item.strip()
    return default


def normalize_assets(payload: dict[str, Any], asset_type: str) -> list[dict[str, str]]:
    raw = next((payload.get(key) for key in ("data", "assets", "results", "items") if isinstance(payload.get(key), list)), [])
    normalized: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        asset_id = str(item.get("id") or item.get("assetId") or item.get("asset_id") or "").strip()
        if not asset_id:
            continue
        creator = item.get("creator") if isinstance(item.get("creator"), dict) else {}
        thumbnail = item.get("thumbnail") if isinstance(item.get("thumbnail"), dict) else {}
        image_url = get_string(item, "thumbnailUrl", "imageUrl", "iconUrl") or get_string(thumbnail, "url", "imageUrl")
        normalized.append({
            "id": asset_id,
            "name": get_string(item, "name", "displayName", default=f"Untitled asset {asset_id}"),
            "creator": get_string(item, "creatorName") or get_string(creator, "name", "displayName", "username", default="Unknown creator"),
            "assetType": asset_type,
            "thumbnailUrl": safe_thumbnail_url(image_url, asset_id),
        })
        if len(normalized) == RESULT_LIMIT:
            break
    return normalized


@app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    if not UI_HTML.exists():
        return HTMLResponse("<h1>RetroStudio UI is unavailable.</h1>", status_code=500)
    raw = UI_HTML.read_text(encoding="utf-8")
    raw = raw.replace("</head>", '<link rel="stylesheet" href="/static/retrox-assets.css"></head>', 1)
    return HTMLResponse(raw)


@app.get("/health")
async def health() -> dict[str, bool | str]:
    config = settings()
    return {"ok": True, "service": "new-retrostudio-encoder", "production": config.production}


@app.get("/auth/login/{provider}")
async def oauth_login(provider: Literal["google", "discord"], request: Request) -> RedirectResponse:
    config = require_supabase()
    public_base = config.public_base_url or str(request.base_url).rstrip("/")
    if config.production and not config.public_base_url:
        raise HTTPException(status_code=503, detail={"code": "RS-CONFIG-503", "message": "Secure sign-in is not configured."})
    target = f"{config.supabase_url}/auth/v1/authorize?{urlencode({'provider': provider, 'redirect_to': public_base + '/auth/callback'})}"
    return RedirectResponse(target, status_code=303)


@app.get("/auth/callback", response_class=HTMLResponse)
async def oauth_callback() -> HTMLResponse:
    return HTMLResponse('<!doctype html><title>Completing sign in</title><p>Completing secure sign in…</p><script src="/static/auth-callback.js" defer></script>')


@app.post("/auth/session")
async def create_session(payload: SessionExchangeRequest, response: Response) -> dict[str, bool]:
    user = await verify_supabase_token(payload.access_token)
    response.set_cookie("rs_session", issue_session(user), httponly=True, secure=settings().production, samesite="lax", max_age=3600, path="/")
    response.set_cookie("rs_csrf", secrets.token_urlsafe(32), httponly=False, secure=settings().production, samesite="lax", max_age=3600, path="/")
    await audit_event(str(user["id"]), "auth_session_created", None, None, {"method": "oauth_or_password"})
    return {"ok": True}


@app.post("/auth/password")
async def password_login(payload: PasswordRequest, request: Request, response: Response) -> dict[str, bool]:
    enforce_rate_limit(request, request_ip_key(request), "password", 5, 600)
    config = require_supabase()
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            upstream = await client.post(
                f"{config.supabase_url}/auth/v1/token?grant_type=password",
                headers={"apikey": config.supabase_publishable_key or "", "Content-Type": "application/json"},
                json={"email": payload.email, "password": payload.password},
            )
        data = upstream.json()
    except (httpx.RequestError, ValueError):
        raise HTTPException(status_code=503, detail={"code": "RS-AUTH-503", "message": "Sign in is temporarily unavailable."}) from None
    token = data.get("access_token") if isinstance(data, dict) else None
    if upstream.status_code != 200 or not isinstance(token, str):
        await audit_event(None, "auth_password_failed", None, None, {"source": "password"})
        raise HTTPException(status_code=401, detail={"code": "RS-AUTH-401", "message": "Sign in could not be verified."})
    user = await verify_supabase_token(token)
    response.set_cookie("rs_session", issue_session(user), httponly=True, secure=settings().production, samesite="lax", max_age=3600, path="/")
    response.set_cookie("rs_csrf", secrets.token_urlsafe(32), httponly=False, secure=settings().production, samesite="lax", max_age=3600, path="/")
    await audit_event(str(user["id"]), "auth_password_succeeded", None, None, {"source": "password"})
    return {"ok": True}


@app.post("/auth/logout")
async def logout(request: Request, response: Response) -> dict[str, bool]:
    require_user(request)
    response.delete_cookie("rs_session", path="/")
    response.delete_cookie("rs_csrf", path="/")
    return {"ok": True}


@app.get("/api/session")
async def current_session(request: Request) -> dict[str, bool | str]:
    user = require_user(request, csrf=False)
    return {"authenticated": True, "user_id": str(user["sub"])}


@app.post("/api/encoder/encode")
async def encode(request: Request, payload: EncoderRequest) -> dict[str, Any]:
    user = require_user(request)
    user_id = str(user["sub"])
    enforce_rate_limit(request, user_id, "encoder", 8, 60)
    device = device_hash(request, user_id)
    rows = await supabase_service_rpc("retrostudio_private_authorize_encoder", {
        "p_user_id": user_id,
        "p_device_hash": device,
        "p_request_id": payload.request_id,
        "p_source_characters": len(payload.source),
    })
    decision = rows[0] if rows else {"allowed": False, "decision_code": "authorization_unavailable", "risk_level": "high"}
    if not decision.get("allowed"):
        if decision.get("risk_level") in {"high", "severe"} and settings().turnstile_secret and not await verify_turnstile(payload.turnstile_token, request):
            raise HTTPException(status_code=403, detail={"code": "RS-VERIFY-403", "message": "Additional verification is required before encoding."})
        await audit_event(user_id, "encoder_denied", payload.request_id, device, {"decision": str(decision.get("decision_code", "denied"))})
        raise HTTPException(status_code=403, detail={"code": "RS-ENCODER-403", "message": "This encoding request is not authorized."})

    try:
        async with ENCODER_SEMAPHORE:
            output, metrics = encode_luau(payload.source)
    except EncoderInputError as error:
        raise HTTPException(status_code=422, detail={"code": "RS-SOURCE-422", "message": str(error)}) from None

    finalized = await supabase_service_rpc("retrostudio_private_finalize_encoder", {
        "p_user_id": user_id,
        "p_device_hash": device,
        "p_request_id": payload.request_id,
        "p_token_cost": 1,
    })
    if not finalized or not finalized[0].get("finalized"):
        await audit_event(user_id, "encoder_finalize_denied", payload.request_id, device, {"decision": str(finalized[0].get("decision_code", "unknown") if finalized else "empty")})
        raise HTTPException(status_code=409, detail={"code": "RS-ENCODER-409", "message": "The request could not be finalized safely. Please try again."})
    await audit_event(user_id, "encoder_completed", payload.request_id, device, {"input_characters": str(metrics["input_characters"]), "blocks": str(metrics["blocks"])})
    return {"output": output, "stats": metrics, "tokens_remaining": finalized[0].get("tokens_remaining")}


@app.post("/api/ai/chat")
async def ai_chat(request: Request, payload: AiChatRequest) -> dict[str, str]:
    user = require_user(request)
    user_id = str(user["sub"])
    enforce_rate_limit(request, user_id, f"ai_{payload.provider}", 6, 60)
    answer = await call_ai_provider(payload.provider, payload.prompt)
    await audit_event(user_id, "ai_response_completed", None, None, {"provider": payload.provider, "prompt_length": str(len(payload.prompt))})
    return {"content": answer, "provider": payload.provider}


@app.post("/api/retrox/assets/search")
async def search_retrox_assets(request: Request, payload: AssetSearchRequest) -> dict[str, Any]:
    user = require_user(request)
    enforce_rate_limit(request, str(user["sub"]), "retrox_assets", 10, 60)
    key = settings().roblox_api_key
    if not key:
        raise HTTPException(status_code=503, detail={"code": "RX-CONFIG-503", "message": "RetroX search is not configured. Add a server-only Roblox Creator Store key."})
    query = urlencode({"keyword": payload.keyword, "assetType": payload.asset_type, "limit": RESULT_LIMIT})
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            upstream = await client.get(f"{ROBLOX_SEARCH_URL}?{query}", headers={"x-api-key": key, "Accept": "application/json"})
    except httpx.RequestError:
        raise HTTPException(status_code=503, detail={"code": "RX-UPLINK-503", "message": "RetroX search is temporarily unavailable."}) from None
    if upstream.status_code in {401, 403}:
        raise HTTPException(status_code=424, detail={"code": "RX-CRED-401", "message": "The server-side Roblox credential is invalid or lacks Creator Store search permission."})
    if upstream.is_error:
        raise HTTPException(status_code=503, detail={"code": "RX-UPLINK-503", "message": "RetroX search is temporarily unavailable."})
    try:
        results = normalize_assets(upstream.json(), payload.asset_type)
    except ValueError:
        raise HTTPException(status_code=503, detail={"code": "RX-UPLINK-503", "message": "RetroX received an invalid upstream response."}) from None
    if not results:
        return {"status": "empty", "results": []}
    if len(results) != RESULT_LIMIT:
        raise HTTPException(status_code=502, detail={"code": "RX-PACKET-010", "message": "RetroX received fewer than ten usable assets. Refine the search and try again."})
    await audit_event(str(user["sub"]), "retrox_asset_search", None, None, {"asset_type": payload.asset_type})
    return {"status": "ready", "results": results}

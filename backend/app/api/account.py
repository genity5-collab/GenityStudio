"""Account proxy: frontend calls these endpoints instead of touching ACCOUNTS directly.
The backend uses the service role key to bypass RLS."""

import httpx
from fastapi import APIRouter, Header, Request
from pydantic import BaseModel, ConfigDict

from app.core.config import Settings
from app.core.errors import AUTH_REQUIRED, SERVICE_UNAVAILABLE
from app.security.auth import require_authenticated_user

router = APIRouter(prefix="/api/account", tags=["account"])


class AccountUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str | None = None
    profile_picture: str | None = None
    description: str | None = None
    known_as: str | None = None
    api_keys: dict | None = None
    coder_data: dict | None = None
    free_data: dict | None = None
    settings: dict | None = None
    chat_history: list | None = None


async def _sb_headers(settings: Settings, token: str | None = None) -> dict:
    key = settings.effective_supabase_service_role_key
    if not settings.supabase_url or not key:
        raise SERVICE_UNAVAILABLE
    h = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    return h


async def _get_user_profile(bearer: str, settings: Settings) -> dict:
    """Fetch full user profile from Supabase auth using the user's access token."""
    try:
        async with httpx.AsyncClient(timeout=settings.auth_timeout_seconds) as client:
            resp = await client.get(
                f"{settings.supabase_url.rstrip('/')}/auth/v1/user",
                headers={
                    "apikey": settings.effective_supabase_publishable_key or "",
                    "Authorization": f"Bearer {bearer}",
                },
            )
    except httpx.HTTPError:
        raise SERVICE_UNAVAILABLE
    if resp.status_code != 200:
        raise AUTH_REQUIRED
    return resp.json()


@router.get("")
async def get_account(request: Request, authorization: str | None = Header(default=None)):
    """Load the user's ACCOUNTS row. Auto-creates if not found."""
    settings: Settings = request.app.state.settings
    user = await require_authenticated_user(authorization, settings)
    headers = await _sb_headers(settings)
    base = settings.supabase_url.rstrip("/")
    table = f"{base}/rest/v1/ACCOUNTS"

    # Try to load existing account
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f'{table}?user_id=eq.{user.user_id}&limit=1',
                headers=headers,
            )
    except httpx.HTTPError:
        raise SERVICE_UNAVAILABLE

    if resp.status_code == 200:
        rows = resp.json()
        if rows and len(rows) > 0:
            return rows[0]

    # Not found — fetch user profile and create account
    bearer = authorization.removeprefix("Bearer ").strip() if authorization else ""
    profile = await _get_user_profile(bearer, settings)
    meta = profile.get("user_metadata", {}) or {}

    new_account = {
        "user_id": user.user_id,
        "display_name": meta.get("full_name") or meta.get("name") or meta.get("user_name") or (profile.get("email", "user").split("@")[0]),
        "profile_picture": meta.get("avatar_url") or meta.get("picture", ""),
        "description": meta.get("description", ""),
        "role": "",
        "known_as": "",
        "api_keys": {},
        "chat_history": [],
        "coder_data": {"count": 0, "week": _week_num()},
        "free_data": {"credits": 5, "lastReset": _now_ms(), "lockoutUntil": 0},
        "settings": {},
        "bonus_credits": 0,
        "bonus_used": False,
        "updated_at": _now_iso(),
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(table, headers=headers, json=new_account)
    except httpx.HTTPError:
        raise SERVICE_UNAVAILABLE

    if resp.status_code in (200, 201):
        rows = resp.json()
        if rows and len(rows) > 0:
            return rows[0]
    # If insert failed (maybe duplicate), try loading again
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f'{table}?user_id=eq.{user.user_id}&limit=1',
                headers=headers,
            )
        if resp.status_code == 200:
            rows = resp.json()
            if rows and len(rows) > 0:
                return rows[0]
    except httpx.HTTPError:
        pass

    raise SERVICE_UNAVAILABLE


@router.patch("")
async def update_account(
    payload: AccountUpdate,
    request: Request,
    authorization: str | None = Header(default=None),
):
    """Update the user's ACCOUNTS row."""
    settings: Settings = request.app.state.settings
    user = await require_authenticated_user(authorization, settings)
    headers = await _sb_headers(settings)
    base = settings.supabase_url.rstrip("/")
    table = f"{base}/rest/v1/ACCOUNTS"

    # Build update dict (only non-None fields)
    update_data = payload.model_dump(exclude_none=True)
    if not update_data:
        return {"ok": True}

    update_data["updated_at"] = _now_iso()

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.patch(
                f'{table}?user_id=eq.{user.user_id}',
                headers=headers,
                json=update_data,
            )
    except httpx.HTTPError:
        raise SERVICE_UNAVAILABLE

    if resp.status_code in (200, 204):
        if resp.status_code == 200:
            rows = resp.json()
            if rows and len(rows) > 0:
                return rows[0]
        return {"ok": True}

    raise SERVICE_UNAVAILABLE


def _week_num() -> int:
    from datetime import date
    d = date.today()
    return (d - date(d.year, 1, 1)).days // 7


def _now_ms() -> int:
    import time
    return int(time.time() * 1000)


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


@router.delete("")
async def delete_account(
    request: Request,
    authorization: str | None = Header(default=None),
):
    """Delete the user's ACCOUNTS row."""
    settings: Settings = request.app.state.settings
    user = await require_authenticated_user(authorization, settings)
    headers = await _sb_headers(settings)
    base = settings.supabase_url.rstrip("/")
    table = f"{base}/rest/v1/ACCOUNTS"

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.delete(
                f'{table}?user_id=eq.{user.user_id}',
                headers=headers,
            )
    except httpx.HTTPError:
        raise SERVICE_UNAVAILABLE

    if resp.status_code in (200, 204):
        return {"ok": True}

    raise SERVICE_UNAVAILABLE

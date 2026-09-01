from contextlib import asynccontextmanager
from asyncio import Semaphore
import re
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import router as api_router
from app.api.account import router as account_router
from app.core.config import get_settings
from app.core.errors import SecureApiError


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.settings = get_settings()
    app.state.encoder_semaphore = Semaphore(app.state.settings.max_encode_concurrency)
    yield


settings = get_settings()
app = FastAPI(
    title="New RetroStudio Encoder API",
    docs_url="/docs" if settings.docs_enabled else None,
    redoc_url=None,
    openapi_url="/openapi.json" if settings.docs_enabled else None,
    lifespan=lifespan,
)

app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    max_age=600,
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    candidate_request_id = request.headers.get("X-Request-ID", "")
    request_id = candidate_request_id if re.fullmatch(r"[A-Za-z0-9_-]{16,128}", candidate_request_id) else str(uuid4())
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = (
        "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; "
        "frame-ancestors 'none'; base-uri 'self'"
    )
    active_settings = getattr(request.app.state, "settings", settings)
    if active_settings.app_env == "production":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


@app.exception_handler(SecureApiError)
async def secure_api_error_handler(_: Request, exc: SecureApiError):
    return JSONResponse(status_code=exc.status_code, content={"code": exc.code, "message": exc.message})


@app.get("/healthz", include_in_schema=False)
async def healthcheck():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# API routes — registered BEFORE the SPA catch-all so they take priority
# ---------------------------------------------------------------------------
app.include_router(api_router)
app.include_router(account_router)


# ---------------------------------------------------------------------------
# Frontend serving
# ---------------------------------------------------------------------------
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
ASSETS_DIR = STATIC_DIR / "assets"

# Mount static assets (JS/CSS bundles) at /assets
if ASSETS_DIR.exists():
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")

# Cache for the React build's index.html (no template replacement needed -
# Vite bakes env vars at build time)
_react_html_cache: str | None = None


def _load_react_html() -> str:
    global _react_html_cache
    if _react_html_cache is not None:
        return _react_html_cache
    with open(STATIC_DIR / "index.html", "r", encoding="utf-8") as f:
        _react_html_cache = f.read()
    return _react_html_cache


# Cache for the legacy frontend (still served at /legacy for backwards compat)
_legacy_html_cache: str | None = None


def _load_legacy_html() -> str:
    global _legacy_html_cache
    if _legacy_html_cache is not None:
        return _legacy_html_cache
    legacy_path = STATIC_DIR / "legacy" / "index.html"
    with open(legacy_path, "r", encoding="utf-8") as f:
        _legacy_html_cache = f.read()
    return _legacy_html_cache


# Serve the React app at the root
@app.get("/", include_in_schema=False)
async def serve_react_frontend():
    return HTMLResponse(content=_load_react_html(), media_type="text/html")


# Serve the legacy v24 frontend at /legacy (retains original functionality)
@app.get("/legacy", include_in_schema=False)
async def serve_legacy_frontend(request: Request):
    s = request.app.state.settings
    html = _load_legacy_html()
    sb_url = (s.supabase_url or "").rstrip("/")
    sb_pub = s.effective_supabase_publishable_key or ""
    groq_key = s.groq_api_key or ""
    html = html.replace("__SB_URL__", sb_url)
    html = html.replace("__SB_PUB_KEY__", sb_pub)
    html = html.replace("__GROQ_KEY__", groq_key)
    return HTMLResponse(content=html, media_type="text/html")


# SPA catch-all: any non-API, non-static, non-health route returns the React app
# so client-side routing (wouter) works on refresh / deep links.
# This is registered LAST so all API routes above take priority.
@app.get("/{path:path}", include_in_schema=False)
async def spa_catch_all(path: str):
    # If the path maps to an actual static file, serve it
    candidate = STATIC_DIR / path
    if candidate.is_file():
        return FileResponse(candidate)
    # Otherwise return the React app for SPA routing
    return HTMLResponse(content=_load_react_html(), media_type="text/html")

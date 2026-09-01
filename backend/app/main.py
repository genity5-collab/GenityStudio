from contextlib import asynccontextmanager
from asyncio import Semaphore
import re
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse, FileResponse

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


# Serve the frontend
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
_frontend_cache: str | None = None


def _load_frontend_html() -> str:
    global _frontend_cache
    if _frontend_cache is not None:
        return _frontend_cache
    html_path = STATIC_DIR / "index.html"
    with open(html_path, "r", encoding="utf-8") as f:
        _frontend_cache = f.read()
    return _frontend_cache


@app.get("/", include_in_schema=False)
async def serve_frontend(request: Request):
    s: Settings = request.app.state.settings
    html = _load_frontend_html()
    # Inject secrets from env vars — never hardcode in the HTML
    sb_url = (s.supabase_url or "").rstrip("/")
    sb_pub = s.effective_supabase_publishable_key or ""
    groq_key = s.groq_api_key or ""
    html = html.replace("__SB_URL__", sb_url)
    html = html.replace("__SB_PUB_KEY__", sb_pub)
    html = html.replace("__GROQ_KEY__", groq_key)
    from fastapi.responses import HTMLResponse
    return HTMLResponse(content=html, media_type="text/html")


app.include_router(api_router)
app.include_router(account_router)

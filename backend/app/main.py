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


@app.get("/", include_in_schema=False)
async def serve_frontend():
    return FileResponse(STATIC_DIR / "index.html", media_type="text/html")


app.include_router(api_router)

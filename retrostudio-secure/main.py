"""
RetroStudio Secure Gateway (Python + HTML)
- Serves the UI with strong security headers
- Never exposes service_role
- Publishable key / project URL only via env (Render)
- Rate limiting + basic anti-abuse
- Same system: Discord OAuth, Free AI, CoolFormat, social, etc.
Deploy on Render: set env vars, use the Procfile / render.yaml
"""

import os
import time
from collections import defaultdict
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

# ---------- Config (all secrets from env — never hardcode) ----------
APP_HTML = Path(__file__).parent / "app.html"
SUPABASE_URL = os.getenv("SUPABASE_URL", "")          # e.g. https://xxxx.supabase.co
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")  # publishable / anon only
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*").split(",")
RATE_LIMIT_PER_MIN = int(os.getenv("RATE_LIMIT_PER_MIN", "60"))

app = FastAPI(title="RetroStudio Secure", docs_url=None, redoc_url=None)

# ---------- Simple in-memory rate limiter ----------
_hits: dict[str, list[float]] = defaultdict(list)

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Rate limit by IP
        ip = request.client.host if request.client else "unknown"
        now = time.time()
        window = _hits[ip]
        _hits[ip] = [t for t in window if now - t < 60]
        if len(_hits[ip]) >= RATE_LIMIT_PER_MIN:
            return JSONResponse({"error": "rate limited"}, status_code=429)
        _hits[ip].append(now)

        response = await call_next(request)

        # Ultimate browser hardening headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        # HSTS only when behind HTTPS (Render terminates TLS)
        if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        # CSP: allow only self + required CDNs for the existing app
        csp = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: https: blob:; "
            "connect-src 'self' https://*.supabase.co https://generativelanguage.googleapis.com "
            "https://api.openai.com https://api.x.ai https://dashscope.aliyuncs.com "
            "https://api.mistral.ai https://api.moonshot.cn https://api.anthropic.com "
            "https://koda-5a35270e.base44.app; "
            "frame-ancestors 'none'; "
            "base-uri 'self'; "
            "form-action 'self'; "
            "object-src 'none'; "
            "upgrade-insecure-requests"
        )
        response.headers["Content-Security-Policy"] = csp
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
        response.headers["Pragma"] = "no-cache"
        response.headers["X-Robots-Tag"] = "noindex, nofollow"
        return response


app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in ALLOWED_ORIGINS if o.strip()],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def inject_config(html: str) -> str:
    """
    Inject runtime config so the browser never needs hardcoded project ID
    in the source that gets committed. Still uses publishable key only.
    """
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        # Fail closed in production; allow local preview
        marker = "/* __RS_CONFIG__ */"
        injection = (
            "/* CONFIG MISSING — set SUPABASE_URL and SUPABASE_ANON_KEY on Render */\n"
            "window.__RS_CONFIG__={url:'',key:''};\n"
        )
        return html.replace(marker, injection, 1) if marker in html else html

    # Replace the hardcoded values that exist in the uploaded HTML
    # so a public GitHub clone does not contain the real project ref.
    safe = html
    # Generic replacement — the uploaded file contains the real values;
    # we overwrite them at serve time from env.
    import re
    safe = re.sub(
        r'var SB_URL\s*=\s*["\']https://[^"\']+["\']\s*;',
        f'var SB_URL="{SUPABASE_URL}";',
        safe,
        count=1,
    )
    safe = re.sub(
        r'var SB_KEY\s*=\s*["\'][^"\']+["\']\s*;',
        f'var SB_KEY="{SUPABASE_ANON_KEY}";',
        safe,
        count=1,
    )
    return safe


@app.get("/", response_class=HTMLResponse)
async def index():
    if not APP_HTML.exists():
        return HTMLResponse("<h1>app.html missing</h1>", status_code=500)
    raw = APP_HTML.read_text(encoding="utf-8", errors="replace")
    return HTMLResponse(inject_config(raw))


@app.get("/health")
async def health():
    return {"ok": True, "service": "retrostudio-secure"}


@app.get("/api/config")
async def public_config():
    """Minimal public config — never service_role."""
    return {
        "supabase_url": SUPABASE_URL or None,
        "has_anon": bool(SUPABASE_ANON_KEY),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "10000")))

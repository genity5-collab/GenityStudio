# RetroStudio Secure Service

This is the Python 3/FastAPI service for the preserved RetroStudio page layout. The browser receives the UI template and non-sensitive interaction code only. Encoder authorization, AI-provider keys, Roblox search credentials, and Supabase service access remain on the server.

## Authentication

**Discord is the only active sign-in path.** The original password/username block is hidden because Supabase password authentication requires an email or phone identifier, and this application does not display or collect email. The server starts Discord OAuth with signed state and PKCE, then exchanges the callback code on the server for a short-lived HTTP-only session.

Before testing Discord sign-in, configure the Discord provider in **Supabase Authentication → Providers** and add this exact callback URL in **Supabase Authentication → URL Configuration**:

```text
https://YOUR-RENDER-SERVICE.onrender.com/auth/callback
```

Set `PUBLIC_BASE_URL` to the same Render origin. The Discord client secret belongs in Supabase, not in Render or browser code.

## Render Environment

Set these only in Render’s encrypted Environment settings. Use `.env.example` as the complete variable list. All values stay server-side.

| Variable | Purpose |
|---|---|
| `APP_SESSION_SECRET` | Signs application session cookies. |
| `DEVICE_HASH_PEPPER` | Salts device-context hashes. |
| `SUPABASE_URL` | Connected Supabase project URL. |
| `SUPABASE_PUBLISHABLE_KEY` | Verifies Supabase user sessions. |
| `SUPABASE_SERVICE_ROLE_KEY` | Calls vetted private RPCs and writes audit events. |
| `ROBLOX_API_KEY` or `ROBLOX_OPEN_CLOUD_API_KEY` | Exactly one server-only Roblox Creator Store key for RetroX. |
| `AI_*_API_KEY` | Only provider keys you elect to enable. |

## Local Validation

Run the following from this folder:

```bash
pytest -q
python scripts/security_audit.py
pip-audit -r requirements.txt
```

The root repository files support existing Render services configured with a blank root directory. They use `python -m pip install -r requirements.txt` and `python -m uvicorn main:app --host 0.0.0.0 --port $PORT`.

See [`SECURITY.md`](SECURITY.md) for the authority model, Supabase controls, and production prerequisites.

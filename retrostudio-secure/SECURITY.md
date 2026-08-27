# Security Model

## Authority Boundary

The browser serves only the preserved RetroStudio interface markup, styling, and a non-sensitive interaction layer. It has no service-role key, Roblox key, private encoder module, database password, OAuth client secret, or authority over balances, roles, risk state, or encoder access.

The Python 3/FastAPI service verifies a session, validates each request, applies account and network rate limits, calls Supabase private authorization RPCs using its server-only service role, runs the private encoder, then finalizes the debit through Supabase before returning an artifact. The authenticated `/api/retrox/assets/search` endpoint is the **only** route allowed to use the Roblox Creator Store credential.

## Supabase

The `server_authority_lockdown_python_backend_v2` migration revokes browser roles from the account authority row, ledger, security events, risk state, request guards, rate windows, and private encoder RPCs. These records remain accessible only to the service role after FastAPI has made the authorization decision. The pre-existing private RPCs retain the atomic ledger and replay protections.

## Deployment Secrets

Set the following in Render, never in source files:

| Variable | Required | Purpose |
|---|---:|---|
| `APP_SESSION_SECRET` | Yes | Signs short-lived, HTTP-only application sessions. |
| `DEVICE_HASH_PEPPER` | Yes | Salts a per-session device-binding hash. |
| `SUPABASE_URL` | Yes | Supabase project URL. |
| `SUPABASE_PUBLISHABLE_KEY` | Yes | Validates Supabase user sessions. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Calls private RPCs and writes security events. |
| `ROBLOX_OPEN_CLOUD_API_KEY` | For live RetroX search | Used only by the server-side RetroX route. |
| `AI_*_API_KEY` | Per enabled provider | Each provider key is selected only inside FastAPI; the browser never submits or receives a provider secret. |
| `TURNSTILE_SECRET_KEY` | For high-risk verification | Verifies Turnstile tokens server-side. |
| `PUBLIC_BASE_URL` | Yes in production | Exact approved Render origin for OAuth redirects. |
| `CORS_ALLOWED_ORIGINS` | Yes in production | Comma-separated approved browser origins. |

Discord OAuth has no application secret in Render. Configure Discord’s client credentials in Supabase Auth and set only the exact Render callback URL there. FastAPI stores a short-lived signed PKCE verifier server-side in an HTTP-only cookie and exchanges the authorization code from the callback, so OAuth access tokens never pass through browser JavaScript.

## Incident Response

If a secret is exposed, first disable affected sensitive paths by removing or rotating the relevant Render secret. Rotate the credential at the original provider, revoke affected sessions in Supabase, inspect Render and Supabase logs, and redeploy from a known-good Git revision. Do not attempt to remediate an exposed secret only by deleting a file.

## Known Deployment Preconditions

Google and Discord providers must be configured in Supabase Auth with the exact Render callback origin. Turnstile remains adaptive and is invoked only when the existing Supabase risk decision returns a high or severe state. A fresh Roblox Creator Store key is required for live asset results; no supplied or exposed key is reused.

Supabase's leaked-password protection is configured in the Supabase Dashboard rather than through the database connector. Enable it before accepting production password registrations or password changes.

## Adviser Review

The final Supabase adviser run reports informational RLS entries for internal tables with no client policies. This is intentional: RLS with no policy creates a default-deny boundary for browser roles, while the trusted FastAPI service uses the service role only after it has verified an application session and request controls. The remaining actionable adviser warning is leaked-password protection, which must be enabled in Supabase Auth before the production rollout.

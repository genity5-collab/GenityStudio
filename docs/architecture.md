# New RetroStudio Encoder Architecture

New RetroStudio Encoder is a server-authoritative application. The browser is an untrusted user-interface layer; it can render state and submit requests but cannot decide tokens, permissions, moderation outcomes, provider access, or encoder eligibility.

## Runtime boundary

| Component | Responsibility | Trust level |
|---|---|---|
| Browser client | Responsive UI, Supabase OAuth redirect, safe display state, and requests to the official API | Untrusted |
| Render FastAPI web service | Verifies Supabase JWTs, validates request shape, enforces endpoint limits, invokes private encoder and provider adapters, and returns safe responses | Trusted |
| Supabase Auth | Google and Discord OAuth, user sessions, approved redirect handling, and identity linking | Trusted |
| Supabase Postgres | RLS-protected social data plus private procedures for tokens, ledger entries, risk controls, moderation, audit, and account state | Trusted |
| Private encoder module | Existing CoolFormat-compatible transformation rules and private mappings | Trusted; never bundled in browser assets |
| Cloudflare Turnstile | Adaptive human-verification signal for challenged requests, verified only by the FastAPI service | Trusted signal; never a client-side authorization decision |

Render terminates public TLS and the FastAPI service accepts the forwarded request only on its assigned `PORT`. The browser uses the official HTTPS application origin. Private credentials are deployed as Render secrets and never stored in the repository, browser bundle, API errors, or public configuration.

## Protected request flow

1. The browser signs in with Supabase Auth using Google or Discord and receives the ordinary Supabase session.
2. The browser calls the official FastAPI API over HTTPS with the session bearer token and a validated request body.
3. FastAPI validates the JWT against Supabase, checks strict size/format limits, and invokes private Supabase server procedures for the account, token, risk, replay, and authorization decision.
4. Only when the protected operation is authorized does FastAPI call the private encoder or AI/provider adapter.
5. Supabase atomically records any charge, grant, risk event, or audit event. FastAPI returns only the required result and an authoritative display balance.

## Account-abuse and bot resistance

No single browser attribute proves a person or prevents every fraudulent account. New RetroStudio Encoder instead combines independently enforced signals before allowing a starter token grant or a high-risk operation. A verified and mature Supabase Google or Discord identity, the existing server-managed device-hash claim, idempotency records, short rate windows, token-ledger history, current moderation state, and an internal risk level contribute to a private decision. The protected authorization procedure treats a short burst of at least eight successful uses or three token-denied events in fifteen minutes as a temporary suspicious signal for non-owner accounts. That signal reduces the request ceiling and invokes the challenge path, but it does not permanently label, block, or alter an account balance. Existing users with a legitimate pre-existing credit row remain eligible under the established exception path; the system does not retroactively remove their allocation.

When the private risk decision requires a challenge, the browser may submit a short-lived Turnstile response token with the protected request. FastAPI, not the browser, posts that token to Cloudflare Siteverify with a server-held secret, an idempotency key, the expected action, and the expected application hostname. Siteverify tokens are single-use and expire after five minutes, so a replayed or expired challenge cannot become a reusable approval artifact. [1]

Challenge outcomes are intentionally not retained as raw tokens, raw browser cookies, or a durable fingerprint. The database records only a minimal server-side security event and risk decision necessary for throttling, progressive restrictions, and operator review. Public errors stay generic; they do not expose score thresholds, device matches, challenge secrets, or provider diagnostics.

## Server authority rules

The browser never supplies a trusted user ID, target permission, role, balance, grant amount, transaction type, provider credential, moderation decision, or account status. Server code derives the user from the verified session and reads all protected state through narrow Supabase functions. Ordinary browser roles cannot write ledger, balance, role, subscription, grant, risk, moderation, or audit fields directly.

## Deployment requirements

The Render service runs with Python 3, uses a `requirements.txt` build, starts with `uvicorn`, binds to `0.0.0.0:$PORT`, exposes `/healthz`, and disables interactive API documentation in production. The Render Blueprint declares secret names only; actual values are entered through Render’s protected environment UI.

## References

[1]: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ "Cloudflare Turnstile: Validate the token"

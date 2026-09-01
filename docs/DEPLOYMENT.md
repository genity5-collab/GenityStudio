# Secure Deployment Guide

The production deployment uses one private GitHub repository, a Render static site for the browser interface, a separate Render FastAPI web service, and the existing Supabase project. The browser receives only the responsive user interface. The encoder runtime, provider prompts, provider credentials, service-role access, asset-search credential, token authority, moderation authority, and audit controls remain in trusted services.

## Repository and Render setup

Create a **private** GitHub repository, push this project without any `.env` file, and sync the included `render.yaml` as a Render Blueprint. It creates the static React site and the separate Python web service. The API service configures the Python build, `uvicorn` process, health check, generated internal signing secret, and placeholder secret names. Render supports this FastAPI process pattern and binds the public service to its assigned `PORT`. [1]

| Render variable | Set in Render dashboard | Purpose |
|---|---|---|
| `APP_ENV` | `production` | Disables interactive API documentation and enables production headers. |
| `APP_ALLOWED_ORIGINS` | Official browser origin only | Restricts credentialed CORS requests. |
| `APP_ALLOWED_HOSTS` | Render hostname and final custom domain | Rejects unexpected Host headers. |
| `SUPABASE_URL` | Existing project URL | Server-side session and data access. |
| `SUPABASE_PUBLISHABLE_KEY` | Current public Supabase key | Validates the actual authenticated session with Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | Rotated service-role key | Calls only private Supabase authorization procedures. Never expose it to the browser. |
| `APP_INTERNAL_SIGNING_SECRET` | Render-generated | Reserved for trusted service-to-service signing. |
| `TURNSTILE_SECRET_KEY` | Turnstile secret | Server-side CAPTCHA verification when enabled. |
| `TURNSTILE_EXPECTED_ACTION` | `retrostudio_encoder` | Requires the returned challenge to be scoped to the encoder action. |
| `TURNSTILE_EXPECTED_HOSTNAME` | Final browser hostname | Rejects a valid challenge token issued for another hostname. |
| `AI_PROVIDER_API_KEY` | Server credential | Private AI provider access. |
| `ROBLOX_CREATOR_STORE_READ_KEY` | Server credential | Verified Retrox asset lookup only. |

Render environment values must be entered through the Render service’s Environment page or supplied as Blueprint placeholders; they must not be committed to `render.yaml`, `.env.example`, source code, or browser assets. [2]

Set `VITE_API_BASE_URL` only on the static site to the public **HTTPS** API base URL. This is an ordinary public endpoint address, not a credential. Do not add service-role, provider, Turnstile, or Roblox credentials to the static site.

The Turnstile **site key** is a public browser configuration value and may be supplied to the static site only when the challenge widget is wired. The **secret key** remains in the FastAPI service exclusively. The FastAPI service posts the one-time response token to Siteverify, validates its expected action and final hostname, and never writes the response token to logs or database records. [3]

## Supabase configuration

Enable the approved **Discord** and **Google** providers in Supabase Auth, register only the final production callback URL, and remove any temporary development redirect URLs before launch. Keep the existing RLS, private token device guard, owner allowlist, moderation procedures, and private server settings. Apply the included additive migrations through the connected Supabase management workflow before enabling the FastAPI encoder route.

The service role is for the Render server only. Browser code uses the ordinary signed-in user session. The server validates that session with Supabase before it reads protected state or invokes any private function.

## Launch sequence

First, finish the private encoder parity port and run its catalog regression suite. Next, populate the Render environment values, deploy the private repository, and confirm `GET /healthz` responds successfully over the official HTTPS origin. Then set the final allowed origin and host values, enable Google/Discord redirect URLs, and test a normal user, a blocked user, a rate-limited request, and a replayed request. Do not enable the browser’s Encode action until every check passes.

## Incident handling

If a browser, repository, chat message, or screenshot exposes a credential, treat it as compromised. Rotate the relevant provider secret or Supabase service-role key, replace it in Render, redeploy, review the server audit events, and invalidate or restrict affected sessions as appropriate. Do not attempt to conceal a leaked credential with browser obfuscation.

## References

[1]: https://render.com/docs/deploy-fastapi "Render: Deploy a FastAPI App"
[2]: https://render.com/docs/configure-environment-variables "Render: Environment Variables and Secrets"
[3]: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ "Cloudflare Turnstile: Validate the token"

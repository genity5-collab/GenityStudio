# New RetroStudio Encoder

New RetroStudio Encoder keeps the familiar RetroStudio page layout while serving it through a **Python 3/FastAPI** backend. The browser receives only safe presentation and interaction code. Encoder authorization, token settlement, risk handling, audit logging, and Roblox credentials stay on the server and use the connected Supabase project’s private functions.

| Route | Security role |
|---|---|
| `POST /api/encoder/encode` | Authenticated, CSRF-protected server-side encoder execution with Supabase authorization and finalization. |
| `POST /api/retrox/assets/search` | The only authenticated path that may use the server-only Roblox Creator Store credential. Returns exactly ten usable assets. |
| `GET /auth/login/{google|discord}` | Starts a Supabase-hosted OAuth flow using approved redirect URLs. |
| `POST /auth/password` | Retains password sign-in via server-side Supabase validation and rate limits. |
| `GET /health` | Minimal deployment health response; exposes no secret state. |

## Render

Deploy with the root `render.yaml`, which uses `retrostudio-secure` as its Python 3 service root. Set every required variable from `retrostudio-secure/.env.example` in Render’s encrypted environment settings. Never add a secret to browser code, source control, or the build command.

## Release Validation

Run the following from `retrostudio-secure` before release:

```bash
pytest -q
python scripts/security_audit.py
```

See [`retrostudio-secure/SECURITY.md`](retrostudio-secure/SECURITY.md) for the architecture, connected Supabase controls, incident response, and deployment preconditions.

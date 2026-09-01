# RetroStudio — Secure Luau Encoder & AI

Production-grade Luau-to-CoolFormat encoder with server-authoritative architecture.

## Architecture

- **Backend**: FastAPI (Python) with private encoder, Supabase auth gateway, Cloudflare Turnstile, rate limiting
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui
- **Database**: Supabase (PostgreSQL) with row-level security
- **Auth**: Discord OAuth + Google OAuth (Supabase Auth)
- **AI**: Free AI via Groq (gpt-oss-20b) — 5 credits per 48 hours
- **Deployment**: Render (Python web service + static site)

## Project Structure

```
├── backend/           # FastAPI server
│   ├── app/
│   │   ├── api/       # API routes (encode/decode)
│   │   ├── core/      # Config, errors
│   │   ├── encoder/   # Private CoolFormat encoder (server-only)
│   │   ├── security/  # Auth, Supabase gateway, Turnstile
│   │   └── main.py    # App entry point
│   └── tests/         # Golden parity tests, security tests
├── client/            # React frontend
│   └── src/
│       ├── components/ # UI components (shadcn/ui)
│       ├── lib/        # Secure API client, Supabase client
│       └── pages/     # Home (encoder, AI, social tabs)
├── supabase/          # Database migrations & edge functions
│   ├── functions/     # Free AI edge function (Groq)
│   └── migrations/    # SQL migrations (additive, non-breaking)
├── render.yaml        # Render deployment config
└── package.json       # Frontend build
```

## Security Model

- Encoder logic stays server-side (never exposed to browser)
- Supabase service-role key used only by the backend
- RLS prevents direct table access from the browser
- Token ledger managed via server-only RPC functions
- Cloudflare Turnstile for suspicious-risk verification
- Device binding and replay protection

## Local Development

```bash
# Backend
cd backend
pip install -r requirements.txt
cp .env.example .env  # Fill in your keys
uvicorn app.main:app --reload --port 8000

# Frontend
pnpm install
pnpm dev
```

## Deployment

See `render.yaml` for Render configuration. Set environment variables in Render dashboard.

## Supabase Setup

Apply migrations in order from `supabase/migrations/`. The migrations are additive and will not break existing accounts.

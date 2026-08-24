# RetroStudio Secure (Python + HTML)

After the code-theft incident this version is served by a small FastAPI gateway.

## What changed for security

- HTML is **served by Python**, not a static public file that can be right-click → Save As easily in production.
- Strong security headers: CSP, X-Frame-Options DENY, no-sniff, COOP, CORP, HSTS, no-store cache.
- Rate limiting per IP.
- `SUPABASE_URL` + publishable key come from **Render environment variables** and are injected at serve time when plaintext patterns exist (obfuscated builds keep fragments only).
- **Never** put the service_role key in this repo or in the browser.
- Same product features (Discord OAuth, local accounts, Free AI tokens, CoolFormat encoder, social, chat, themes).
- Uses the **new obfuscated HTML** you provided (not the old static file).

## Deploy on Render

1. Connect this repo (root or set root directory to `retrostudio-secure` if the blueprint is used).
2. Set environment variables (Dashboard → Environment):
   - `SUPABASE_URL` = your project URL (**rotate after the theft**)
   - `SUPABASE_ANON_KEY` = publishable / anon key only
3. Deploy. The service starts with `uvicorn main:app`.

## Supabase hardening you must do (Dashboard + SQL)

### 1. Rotate keys immediately
Project Settings → API → regenerate anon + service_role.  
Update Render env vars. Never commit the new keys.

### 2. Enable Google + Discord (Google first)
Authentication → Providers:
- Enable Google
- Enable Discord
Redirect URL must match your Render URL (and any custom domain).

### 3. Max 1 account per Google identity (delete oldest)
Run in SQL Editor:

```sql
-- Example trigger sketch — adapt to your ACCOUNTS / auth.users mapping
CREATE OR REPLACE FUNCTION public.enforce_one_google_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  google_sub text;
  oldest_id uuid;
BEGIN
  -- extract Google subject from identities if present
  SELECT identity_data->>'sub' INTO google_sub
  FROM auth.identities
  WHERE user_id = NEW.id AND provider = 'google'
  LIMIT 1;

  IF google_sub IS NULL THEN
    RETURN NEW;
  END IF;

  -- find older accounts that share the same Google sub
  SELECT u.id INTO oldest_id
  FROM auth.users u
  JOIN auth.identities i ON i.user_id = u.id
  WHERE i.provider = 'google'
    AND i.identity_data->>'sub' = google_sub
    AND u.id <> NEW.id
  ORDER BY u.created_at ASC
  LIMIT 1;

  IF oldest_id IS NOT NULL THEN
    -- delete the oldest duplicate (cascades depend on your FKs)
    DELETE FROM public."ACCOUNTS" WHERE user_id = oldest_id;
    -- optional: delete auth user (requires service role / careful)
    -- DELETE FROM auth.users WHERE id = oldest_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Attach after you verify the logic on a staging project
-- CREATE TRIGGER trg_one_google
-- AFTER INSERT ON auth.users
-- FOR EACH ROW EXECUTE FUNCTION public.enforce_one_google_account();
```

Test thoroughly on a non-production project first.

### 4. RLS checklist
- Every table that the client touches has RLS **ON**.
- Policies use `(select auth.uid()) = user_id` (or equivalent).
- No `USING (true)` for authenticated data.
- Storage buckets also have policies.
- Edge Functions use the user JWT, never service_role in the client.

### 5. Make the GitHub repo private
Settings → Danger Zone → Change visibility → Private.  
Attackers currently can clone the public repo.

## Local test

```bash
export SUPABASE_URL=https://YOUR_PROJECT.supabase.co
export SUPABASE_ANON_KEY=your_publishable_key
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Open http://127.0.0.1:8000

## Security verification (self-test results)
- Headers present: CSP, X-Frame-Options DENY, nosniff, COOP/CORP, no-store, HSTS on HTTPS.
- `/docs` and OpenAPI disabled.
- Rate limit returns 429 after threshold.
- No service_role anywhere.
- Anon/publishable key is public by design (Supabase); real protection is RLS + rotation after theft.
- Obfuscated HTML fragments of old project ref remain until you rotate keys.

## Important limits
Client-side JavaScript (encoder, UI) can always be extracted by a determined attacker who loads the page.  
The Python layer raises the cost dramatically, hides secrets in env, adds headers + rate limits, and lets you proxy more logic later (e.g. Free AI, account deletion) entirely server-side.

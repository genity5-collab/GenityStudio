-- ═════════════════════════════════════════════════════════════════════════════
-- Enforce 1 account per Discord identity
--
-- Strategy:
--   1. Track the Discord provider identity on first sign-in.
--   2. If a *different* user ID tries to sign in with the same Discord identity,
--      block the new session by raising an exception in a trigger.
--   3. The check runs on auth.identity insert/update (Supabase auth schema).
--   4. Also add a lightweight sentinel in the public schema for visibility.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. Public tracking table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.discord_identity_claims (
    discord_user_id  TEXT PRIMARY KEY,
    supabase_user_id UUID NOT NULL,
    claimed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.discord_identity_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.discord_identity_claims FROM anon, authenticated;

-- Grant service_role full access (backend uses service role)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discord_identity_claims TO service_role;

-- ── 2. Function: claim a Discord identity for a user ─────────────────────────
-- Called by the backend (service_role) after OAuth completes.
CREATE OR REPLACE FUNCTION public.claim_discord_identity(
    p_discord_user_id  TEXT,
    p_supabase_user_id UUID
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.discord_identity_claims (discord_user_id, supabase_user_id)
    VALUES (p_discord_user_id, p_supabase_user_id)
    ON CONFLICT (discord_user_id)
    DO UPDATE
    SET supabase_user_id = EXCLUDED.supabase_user_id,
        claimed_at = now()
    WHERE discord_identity_claims.supabase_user_id = p_supabase_user_id;
    -- If the WHERE clause doesn't match (different user already owns it),
    -- the ON CONFLICT DO NOTHING-equivalent means the row is NOT updated,
    -- keeping the original owner. The caller checks for collision.
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_discord_identity FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_discord_identity TO service_role;

-- ── 3. Function: check if a Discord identity is already claimed ──────────────
-- Returns the supabase_user_id of the existing owner, or NULL if unclaimed.
CREATE OR REPLACE FUNCTION public.lookup_discord_identity(
    p_discord_user_id TEXT
) RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT supabase_user_id FROM public.discord_identity_claims WHERE discord_user_id = p_discord_user_id;
$$;

REVOKE EXECUTE ON FUNCTION public.lookup_discord_identity FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_discord_identity TO service_role;

-- ── 4. Trigger: Block duplicate Discord accounts at the auth level ───────────
-- Fires when a new identity is inserted into auth.identities.
-- If the same provider+identity already exists under a different user, block it.
CREATE OR REPLACE FUNCTION public.block_duplicate_discord_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    existing_user UUID;
BEGIN
    -- Only check Discord identities
    IF NEW.provider <> 'discord' THEN
        RETURN NEW;
    END IF;

    -- Check if this Discord identity ID is already claimed by another user
    SELECT supabase_user_id INTO existing_user
    FROM public.discord_identity_claims
    WHERE discord_user_id = NEW.provider_id;

    IF FOUND AND existing_user <> NEW.user_id THEN
        RAISE EXCEPTION 'This Discord account is already linked to another user.'
            USING ERRCODE = 'unique_violation';
    END IF;

    -- Claim it for this user
    INSERT INTO public.discord_identity_claims (discord_user_id, supabase_user_id)
    VALUES (NEW.provider_id, NEW.user_id)
    ON CONFLICT (discord_user_id)
    DO UPDATE SET supabase_user_id = EXCLUDED.supabase_user_id, claimed_at = now()
    WHERE discord_identity_claims.supabase_user_id = NEW.user_id;

    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.block_duplicate_discord_identity FROM anon, authenticated;

-- Attach trigger to auth.identities (Supabase internal table)
-- Note: This runs on INSERT into auth.identities which happens during OAuth sign-in
DROP TRIGGER IF EXISTS trg_block_duplicate_discord ON auth.identities;
CREATE TRIGGER trg_block_duplicate_discord
    BEFORE INSERT ON auth.identities
    FOR EACH ROW
    EXECUTE FUNCTION public.block_duplicate_discord_identity();

-- ── 5. Also backfill existing Discord identities ─────────────────────────────
INSERT INTO public.discord_identity_claims (discord_user_id, supabase_user_id)
SELECT
    i.provider_id::TEXT,
    i.user_id
FROM auth.identities i
WHERE i.provider = 'discord'
ON CONFLICT (discord_user_id) DO NOTHING;

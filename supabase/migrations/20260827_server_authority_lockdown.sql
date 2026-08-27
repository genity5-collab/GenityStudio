-- New RetroStudio Encoder: keep authority fields and ledger writes server-only.
-- The Python/FastAPI service calls vetted private RPCs using the service-role key.

begin;

-- The former HTML client could read and mutate a full account row. That row
-- contains authority and private settings, so ordinary browser roles no longer
-- receive direct table access.
alter table public."ACCOUNTS" enable row level security;
drop policy if exists accounts_select_own on public."ACCOUNTS";
drop policy if exists accounts_insert_own on public."ACCOUNTS";
drop policy if exists accounts_update_own on public."ACCOUNTS";
drop policy if exists accounts_delete_own on public."ACCOUNTS";
revoke all on table public."ACCOUNTS" from public, anon, authenticated;

-- These tables are append-only/internal authority records. No client policies
-- are created deliberately: RLS therefore denies browser access by default.
revoke all on table public."FREE_AI_CREDITS" from public, anon;
revoke all on table public."RETOSTUDIO_TOKEN_LEDGER" from public, anon, authenticated;
revoke all on table public."RETOSTUDIO_SECURITY_EVENTS" from public, anon, authenticated;
revoke all on table public."RETOSTUDIO_REQUEST_GUARDS" from public, anon, authenticated;
revoke all on table public."RETOSTUDIO_RATE_WINDOWS" from public, anon, authenticated;
revoke all on table public."RETOSTUDIO_RISK_STATE" from public, anon, authenticated;

-- Remove browser execution of authority-changing or authority-revealing RPCs.
revoke all on function public.consume_retrox_tokens(numeric, text) from public, anon, authenticated;
revoke all on function public.get_retrox_tokens(text) from public, anon, authenticated;
revoke all on function public.has_retrox_pro_access() from public, anon, authenticated;
revoke all on function public.retro_admin_ban_user(text, integer, text) from public, anon, authenticated;
revoke all on function public.retro_admin_broadcast(text) from public, anon, authenticated;
revoke all on function public.retro_admin_clear_release_log() from public, anon, authenticated;
revoke all on function public.retro_admin_delete_user(text, text) from public, anon, authenticated;
revoke all on function public.retro_admin_publish_release_log(text, text, text) from public, anon, authenticated;
revoke all on function public.retro_admin_set_runtime_config(text[], text[], text[], text) from public, anon, authenticated;
revoke all on function public.retro_admin_unban_user(text) from public, anon, authenticated;
revoke all on function public.retro_admin_warn_user(text, text) from public, anon, authenticated;

-- These RPCs are called only by the trusted Python service after it validates
-- the user’s signed session and request context. They are never callable by a
-- browser using a publishable key.
revoke all on function public.retrostudio_private_authorize_encoder(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.retrostudio_private_finalize_encoder(uuid, text, text, numeric) from public, anon, authenticated;
revoke all on function public.retrostudio_private_resolve_token_eligibility(uuid, text) from public, anon, authenticated;
grant execute on function public.retrostudio_private_authorize_encoder(uuid, text, text, integer) to service_role;
grant execute on function public.retrostudio_private_finalize_encoder(uuid, text, text, numeric) to service_role;
grant execute on function public.retrostudio_private_resolve_token_eligibility(uuid, text) to service_role;

commit;

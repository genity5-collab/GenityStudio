-- Owner tier: the site owner (RETROX_OWNER_ALLOWLIST) gets a 250-token pool
-- refreshed every 48 hours (2 days), with access to every Galaxy Smartness mode
-- (Fast/Normal/Think/Long/Coder). Everyone else keeps the 25/48h free pool.
-- The charge clamp stays 1..6 and the client never sends a cost.

begin;

-- consume_free_ai_tokens: owner-aware pool (250 vs 25), 48h refresh
create or replace function public.consume_free_ai_tokens(p_count integer default 1)
returns table (tokens_remaining integer, reset_at timestamptz, tokens_charged integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_owner boolean;
  v_pool integer;
  v_tokens integer;
  v_reset_at timestamptz;
  v_charge integer := greatest(1, least(p_count, 6));
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  v_owner := public.retrox_is_owner(v_user_id);
  v_pool := case when v_owner then 250 else 25 end;

  insert into public."FREE_AI_CREDITS" (user_id, credits, reset_at)
  values (v_user_id, v_pool, now() + interval '48 hours')
  on conflict (user_id) do nothing;

  select c.credits, c.reset_at
  into v_tokens, v_reset_at
  from public."FREE_AI_CREDITS" as c
  where c.user_id = v_user_id
  for update;

  if v_reset_at <= now() then
    v_tokens := v_pool;
    v_reset_at := now() + interval '48 hours';
  end if;

  if v_tokens < v_charge then
    -- Do NOT throw: return the true remaining balance so the caller can show
    -- an accurate "you have X, this mode needs Y" message instead of a blind
    -- "exhausted" error. tokens_charged = 0 signals nothing was deducted.
    update public."FREE_AI_CREDITS" as c
    set reset_at = v_reset_at
    where c.user_id = v_user_id;
    return query select v_tokens, v_reset_at, 0;
    return;
  end if;

  v_tokens := v_tokens - v_charge;

  update public."FREE_AI_CREDITS" as c
  set credits = v_tokens,
      reset_at = v_reset_at,
      updated_at = now()
  where c.user_id = v_user_id;

  return query select v_tokens, v_reset_at, v_charge;
end;
$$;

revoke all on function public.consume_free_ai_tokens(integer) from public;
grant execute on function public.consume_free_ai_tokens(integer) to authenticated;

-- peek_free_ai_tokens: same owner-aware pool, read-only
create or replace function public.peek_free_ai_tokens()
returns table (tokens_remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_owner boolean;
  v_pool integer;
  v_tokens integer;
  v_reset_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  v_owner := public.retrox_is_owner(v_user_id);
  v_pool := case when v_owner then 250 else 25 end;

  insert into public."FREE_AI_CREDITS" (user_id, credits, reset_at)
  values (v_user_id, v_pool, now() + interval '48 hours')
  on conflict (user_id) do nothing;

  select c.credits, c.reset_at
  into v_tokens, v_reset_at
  from public."FREE_AI_CREDITS" as c
  where c.user_id = v_user_id;

  if v_reset_at <= now() then
    v_tokens := v_pool;
    v_reset_at := now() + interval '48 hours';
  end if;

  return query select v_tokens, v_reset_at;
end;
$$;

revoke all on function public.peek_free_ai_tokens() from public;
grant execute on function public.peek_free_ai_tokens() to authenticated;

-- get_retrox_tokens (device-bound starter path): align the owner tier with the
-- 250/48h pool instead of the legacy 10000 so every surface agrees on the balance
create or replace function public.get_retrox_tokens(p_device_hash text)
returns table (tokens_remaining numeric, reset_at timestamptz)
language plpgsql
security definer
set search_path = 'public', 'auth'
as $$
declare
  v_user_id uuid := auth.uid();
  v_tokens numeric(7,1);
  v_reset_at timestamptz;
  v_owner boolean;
  v_allowed boolean;
  v_lock timestamptz;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  v_owner := public.retrox_is_owner(v_user_id);
  select starter_allowed, starter_locked_until into v_allowed, v_lock
  from public.retrox_bind_token_device(p_device_hash);

  insert into public."FREE_AI_CREDITS" (user_id, credits, reset_at)
  values (
    v_user_id,
    case when v_owner then 250 when v_allowed then 25 else 0 end,
    case when v_owner or v_allowed then now() + interval '48 hours' else coalesce(v_lock, now() + interval '100 years') end
  )
  on conflict (user_id) do nothing;

  select c.credits, c.reset_at into v_tokens, v_reset_at
  from public."FREE_AI_CREDITS" c where c.user_id = v_user_id for update;

  if not v_owner and v_reset_at <= now() then
    select starter_allowed, starter_locked_until into v_allowed, v_lock
    from public.retrox_bind_token_device(p_device_hash);
    if v_allowed then
      v_tokens := 25;
      v_reset_at := now() + interval '48 hours';
    else
      v_tokens := 0;
      v_reset_at := coalesce(v_lock, now() + interval '100 years');
    end if;
    update public."FREE_AI_CREDITS"
    set credits = v_tokens, reset_at = v_reset_at, updated_at = now()
    where user_id = v_user_id;
  end if;

  return query select v_tokens, v_reset_at;
end;
$$;

revoke all on function public.get_retrox_tokens(text) from public;
grant execute on function public.get_retrox_tokens(text) to authenticated;

-- Welcome the owner tier: top the owner's window up to 250 right now
update public."FREE_AI_CREDITS"
set credits = 250, reset_at = now() + interval '48 hours', updated_at = now()
where user_id in (select user_id from public."RETROX_OWNER_ALLOWLIST");

commit;

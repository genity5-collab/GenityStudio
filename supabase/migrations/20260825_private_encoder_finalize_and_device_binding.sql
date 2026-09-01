begin;

alter table public."RETROSTUDIO_REQUEST_GUARDS"
  add column if not exists device_hash char(64) check (device_hash is null or device_hash ~ '^[a-f0-9]{64}$'),
  add column if not exists authorized_at timestamptz,
  add column if not exists finalized_at timestamptz;

create or replace function public.retrostudio_private_authorize_encoder(
  p_user_id uuid,
  p_device_hash text,
  p_request_id text,
  p_source_characters integer
)
returns table (allowed boolean, decision_code text, tokens_remaining numeric, reset_at timestamptz, risk_level text)
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_inserted integer;
  v_request_count integer;
  v_user_exists boolean;
  v_banned boolean;
  v_risk_level text;
  v_restricted_until timestamptz;
  v_tokens numeric;
  v_reset_at timestamptz;
  v_limit integer;
begin
  if p_device_hash !~ '^[a-f0-9]{64}$'
     or p_request_id !~ '^[A-Za-z0-9_-]{16,128}$'
     or p_source_characters not between 1 and 120000 then
    return query select false, 'INVALID_INPUT', 0::numeric, null::timestamptz, 'normal'::text;
    return;
  end if;

  select exists(select 1 from auth.users u where u.id = p_user_id) into v_user_exists;
  if not v_user_exists then
    return query select false, 'AUTH_REQUIRED', 0::numeric, null::timestamptz, 'normal'::text;
    return;
  end if;

  insert into public."RETROSTUDIO_REQUEST_GUARDS" (user_id, operation, request_id, device_hash)
  values (p_user_id, 'encoder', p_request_id, p_device_hash)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted <> 1 then
    return query select false, 'REPLAY_REJECTED', 0::numeric, null::timestamptz, 'normal'::text;
    return;
  end if;

  insert into public."RETROSTUDIO_RATE_WINDOWS" (user_id, operation, window_started_at, request_count)
  values (p_user_id, 'encoder', date_trunc('minute', now()), 1)
  on conflict (user_id, operation, window_started_at)
  do update set request_count = public."RETROSTUDIO_RATE_WINDOWS".request_count + 1
  returning request_count into v_request_count;

  select exists(
    select 1 from public."RETROSTUDIO_BANS" b
    where b.user_id = p_user_id and b.banned_until > now()
  ) into v_banned;

  select coalesce(r.risk_level, 'normal'), r.restricted_until
  into v_risk_level, v_restricted_until
  from (select 1) as singleton
  left join public."RETROSTUDIO_RISK_STATE" r on r.user_id = p_user_id;

  v_limit := case v_risk_level when 'high' then 2 when 'suspicious' then 4 else 8 end;
  select c.credits, c.reset_at
  into v_tokens, v_reset_at
  from public."FREE_AI_CREDITS" c
  where c.user_id = p_user_id;

  if v_banned then
    return query select false, 'ACCOUNT_RESTRICTED', coalesce(v_tokens, 0), v_reset_at, v_risk_level;
    return;
  end if;
  if v_risk_level = 'severe' or (v_restricted_until is not null and v_restricted_until > now()) then
    return query select false, 'ACCOUNT_REVIEW', coalesce(v_tokens, 0), v_reset_at, v_risk_level;
    return;
  end if;
  if v_request_count > v_limit then
    return query select false, 'RATE_LIMITED', coalesce(v_tokens, 0), v_reset_at, v_risk_level;
    return;
  end if;

  update public."RETROSTUDIO_REQUEST_GUARDS"
  set authorized_at = now()
  where user_id = p_user_id and operation = 'encoder' and request_id = p_request_id;

  return query select true, 'AUTHORIZED', coalesce(v_tokens, 0), v_reset_at, v_risk_level;
end;
$function$;

create or replace function public.retrostudio_private_resolve_token_eligibility(
  p_user_id uuid,
  p_device_hash text
)
returns table (starter_allowed boolean, starter_locked_until timestamptz)
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_owner boolean;
  v_existing_credit boolean;
  v_claim_user uuid;
  v_lock timestamptz;
  v_state text;
  v_account_ready boolean;
  v_created_at timestamptz;
begin
  if p_device_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid device hash';
  end if;

  v_owner := public.retrox_is_owner(p_user_id);
  if v_owner then
    return query select true, null::timestamptz;
    return;
  end if;

  select exists(select 1 from public."FREE_AI_CREDITS" c where c.user_id = p_user_id)
  into v_existing_credit;

  select g.starter_locked_until, g.starter_state
  into v_lock, v_state
  from public."RETROX_TOKEN_ACCOUNT_GUARDS" g
  where g.user_id = p_user_id
  for update;

  if found then
    if v_state = 'pending' and public.retrox_is_mature_verified_account(p_user_id) then
      select c.claimed_user_id into v_claim_user
      from public."RETROX_TOKEN_DEVICE_CLAIMS" c
      where c.device_hash = p_device_hash
      for update;
      if v_claim_user = p_user_id then
        update public."RETROX_TOKEN_ACCOUNT_GUARDS"
        set starter_locked_until = null, starter_state = 'allowed', updated_at = now()
        where user_id = p_user_id;
        v_lock := null;
        v_state := 'allowed';
      else
        update public."RETROX_TOKEN_ACCOUNT_GUARDS"
        set starter_locked_until = now() + interval '100 years', starter_state = 'device_block', updated_at = now()
        where user_id = p_user_id;
        v_lock := now() + interval '100 years';
        v_state := 'device_block';
      end if;
    elsif v_state = 'pending' and (v_lock is null or v_lock <= now()) then
      v_lock := now() + interval '1 hour';
      update public."RETROX_TOKEN_ACCOUNT_GUARDS"
      set starter_locked_until = v_lock, updated_at = now()
      where user_id = p_user_id;
    end if;
    return query select v_state = 'allowed', v_lock;
    return;
  end if;

  if v_existing_credit then
    insert into public."RETROX_TOKEN_ACCOUNT_GUARDS" (user_id, device_hash, starter_locked_until, starter_state)
    values (p_user_id, p_device_hash, null, 'allowed');
    insert into public."RETROX_TOKEN_DEVICE_CLAIMS" (device_hash, claimed_user_id)
    values (p_device_hash, p_user_id)
    on conflict (device_hash) do update set last_seen_at = now();
    return query select true, null::timestamptz;
    return;
  end if;

  select u.created_at into v_created_at from auth.users u where u.id = p_user_id;
  v_account_ready := public.retrox_is_mature_verified_account(p_user_id);
  select c.claimed_user_id into v_claim_user
  from public."RETROX_TOKEN_DEVICE_CLAIMS" c
  where c.device_hash = p_device_hash
  for update;

  if not found then
    insert into public."RETROX_TOKEN_DEVICE_CLAIMS" (device_hash, claimed_user_id)
    values (p_device_hash, p_user_id);
    v_claim_user := p_user_id;
  else
    update public."RETROX_TOKEN_DEVICE_CLAIMS"
    set last_seen_at = now()
    where device_hash = p_device_hash;
  end if;

  if not v_account_ready then
    v_state := 'pending';
    v_lock := greatest(coalesce(v_created_at, now()) + interval '12 hours', now() + interval '1 minute');
  elsif v_claim_user <> p_user_id then
    v_state := 'device_block';
    v_lock := now() + interval '100 years';
  else
    v_state := 'allowed';
    v_lock := null;
  end if;

  insert into public."RETROX_TOKEN_ACCOUNT_GUARDS" (user_id, device_hash, starter_locked_until, starter_state)
  values (p_user_id, p_device_hash, v_lock, v_state);

  return query select v_state = 'allowed', v_lock;
end;
$function$;

create or replace function public.retrostudio_private_finalize_encoder(
  p_user_id uuid,
  p_device_hash text,
  p_request_id text,
  p_token_cost numeric
)
returns table (finalized boolean, decision_code text, tokens_remaining numeric, reset_at timestamptz)
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_cost numeric(4,1) := round(p_token_cost::numeric, 1);
  v_existing_balance numeric;
  v_authorized_at timestamptz;
  v_finalized_at timestamptz;
  v_guard_device_hash text;
  v_owner boolean;
  v_allowed boolean;
  v_lock timestamptz;
  v_tokens numeric(7,1);
  v_reset_at timestamptz;
  v_had_credit boolean;
  v_previous_tokens numeric(7,1);
begin
  if p_device_hash !~ '^[a-f0-9]{64}$'
     or p_request_id !~ '^[A-Za-z0-9_-]{16,128}$'
     or v_cost not in (0.5, 1, 2, 3, 4) then
    return query select false, 'INVALID_INPUT', 0::numeric, null::timestamptz;
    return;
  end if;

  select l.balance_after into v_existing_balance
  from public."RETROSTUDIO_TOKEN_LEDGER" l
  where l.user_id = p_user_id and l.request_id = p_request_id;
  if found then
    select c.reset_at into v_reset_at from public."FREE_AI_CREDITS" c where c.user_id = p_user_id;
    return query select true, 'FINALIZED', v_existing_balance, v_reset_at;
    return;
  end if;

  select g.authorized_at, g.finalized_at, g.device_hash
  into v_authorized_at, v_finalized_at, v_guard_device_hash
  from public."RETROSTUDIO_REQUEST_GUARDS" g
  where g.user_id = p_user_id and g.operation = 'encoder' and g.request_id = p_request_id
  for update;
  if not found or v_authorized_at is null or v_guard_device_hash is distinct from p_device_hash then
    return query select false, 'NOT_AUTHORIZED', 0::numeric, null::timestamptz;
    return;
  end if;
  if v_finalized_at is not null then
    return query select false, 'FINALIZATION_INCONSISTENT', 0::numeric, null::timestamptz;
    return;
  end if;

  v_owner := public.retrox_is_owner(p_user_id);
  select exists(select 1 from public."FREE_AI_CREDITS" c where c.user_id = p_user_id)
  into v_had_credit;
  select starter_allowed, starter_locked_until
  into v_allowed, v_lock
  from public.retrostudio_private_resolve_token_eligibility(p_user_id, p_device_hash);

  if not v_had_credit then
    insert into public."FREE_AI_CREDITS" (user_id, credits, reset_at)
    values (
      p_user_id,
      case when v_owner then 10000 else case when v_allowed then 15 else 0 end end,
      case when v_owner or v_allowed then now() + interval '48 hours' else coalesce(v_lock, now() + interval '100 years') end
    );
    if v_owner or v_allowed then
      insert into public."RETROSTUDIO_TOKEN_LEDGER" (user_id, amount, balance_after, entry_type, detail)
      values (
        p_user_id,
        case when v_owner then 10000 else 15 end,
        case when v_owner then 10000 else 15 end,
        'starter_grant',
        jsonb_build_object('operation', 'encoder', 'source', 'server_authority')
      );
    end if;
  end if;

  select c.credits, c.reset_at
  into v_tokens, v_reset_at
  from public."FREE_AI_CREDITS" c
  where c.user_id = p_user_id
  for update;

  if not v_owner and v_reset_at <= now() then
    select starter_allowed, starter_locked_until
    into v_allowed, v_lock
    from public.retrostudio_private_resolve_token_eligibility(p_user_id, p_device_hash);
    if v_allowed then
      v_previous_tokens := v_tokens;
      v_tokens := 15;
      v_reset_at := now() + interval '48 hours';
      if v_tokens <> v_previous_tokens then
        insert into public."RETROSTUDIO_TOKEN_LEDGER" (user_id, amount, balance_after, entry_type, detail)
        values (
          p_user_id,
          v_tokens - v_previous_tokens,
          v_tokens,
          'reset',
          jsonb_build_object('operation', 'encoder', 'source', 'server_authority')
        );
      end if;
    else
      v_tokens := 0;
      v_reset_at := coalesce(v_lock, now() + interval '100 years');
    end if;
  end if;

  if v_tokens < v_cost then
    update public."FREE_AI_CREDITS"
    set credits = v_tokens, reset_at = v_reset_at, updated_at = now()
    where user_id = p_user_id;
    update public."RETROSTUDIO_REQUEST_GUARDS"
    set finalized_at = now()
    where user_id = p_user_id and operation = 'encoder' and request_id = p_request_id;
    insert into public."RETROSTUDIO_SECURITY_EVENTS" (subject_user_id, event_type, request_id, device_hash, detail)
    values (
      p_user_id,
      'encoder_token_denied',
      p_request_id,
      p_device_hash,
      jsonb_build_object('cost', v_cost, 'risk_checked', true)
    );
    return query select false, case when v_allowed then 'INSUFFICIENT_TOKENS' else 'ACCOUNT_REVIEW' end, v_tokens, v_reset_at;
    return;
  end if;

  v_tokens := v_tokens - v_cost;
  update public."FREE_AI_CREDITS"
  set credits = v_tokens, reset_at = v_reset_at, updated_at = now()
  where user_id = p_user_id;

  insert into public."RETROSTUDIO_TOKEN_LEDGER" (user_id, amount, balance_after, entry_type, request_id, detail)
  values (
    p_user_id,
    -v_cost,
    v_tokens,
    'usage',
    p_request_id,
    jsonb_build_object('operation', 'encoder', 'source', 'server_authority')
  );

  update public."RETROSTUDIO_REQUEST_GUARDS"
  set finalized_at = now()
  where user_id = p_user_id and operation = 'encoder' and request_id = p_request_id;

  insert into public."RETROSTUDIO_SECURITY_EVENTS" (subject_user_id, event_type, request_id, device_hash, detail)
  values (
    p_user_id,
    'encoder_usage_recorded',
    p_request_id,
    p_device_hash,
    jsonb_build_object('cost', v_cost, 'risk_checked', true)
  );

  return query select true, 'FINALIZED', v_tokens, v_reset_at;
end;
$function$;

revoke all on function public.retrostudio_private_authorize_encoder(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.retrostudio_private_resolve_token_eligibility(uuid, text) from public, anon, authenticated;
revoke all on function public.retrostudio_private_finalize_encoder(uuid, text, text, numeric) from public, anon, authenticated;
grant execute on function public.retrostudio_private_authorize_encoder(uuid, text, text, integer) to service_role;
grant execute on function public.retrostudio_private_resolve_token_eligibility(uuid, text) to service_role;
grant execute on function public.retrostudio_private_finalize_encoder(uuid, text, text, numeric) to service_role;

commit;

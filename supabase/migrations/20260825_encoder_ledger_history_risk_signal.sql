begin;

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
  v_owner boolean;
  v_recent_successes integer;
  v_recent_denials integer;
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

  -- Ledger and denial history are private signals, not browser-provided claims.
  -- The rolling window is deliberately temporary: it triggers an adaptive challenge
  -- without permanently escalating a legitimate user for a short burst of work.
  v_owner := public.retrox_is_owner(p_user_id);
  if not v_owner and v_risk_level = 'normal' then
    select count(*) into v_recent_successes
    from public."RETROSTUDIO_TOKEN_LEDGER" l
    where l.user_id = p_user_id
      and l.entry_type = 'usage'
      and l.created_at >= now() - interval '15 minutes';
    select count(*) into v_recent_denials
    from public."RETROSTUDIO_SECURITY_EVENTS" e
    where e.subject_user_id = p_user_id
      and e.event_type = 'encoder_token_denied'
      and e.created_at >= now() - interval '15 minutes';
    if v_recent_successes >= 8 or v_recent_denials >= 3 then
      v_risk_level := 'suspicious';
    end if;
  end if;

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

revoke all on function public.retrostudio_private_authorize_encoder(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.retrostudio_private_authorize_encoder(uuid, text, text, integer) to service_role;

commit;

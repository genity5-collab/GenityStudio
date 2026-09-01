-- This single-statement SQL function is kept private to service_role. It is
-- intentionally structured without browser grants and returns a safe decision
-- code for the FastAPI service to translate into a user-facing error.
create or replace function public.retrostudio_private_authorize_encoder(
  p_user_id uuid,
  p_device_hash text,
  p_request_id text,
  p_source_characters integer
)
returns table (allowed boolean, decision_code text, tokens_remaining numeric, reset_at timestamptz, risk_level text)
language sql
security definer
set search_path = public, auth
as $function$
with input as (
  select p_user_id as user_id, p_device_hash as device_hash, p_request_id as request_id,
         p_source_characters as source_characters, date_trunc('minute', now()) as window_started_at
), request_guard as (
  insert into public."RETROSTUDIO_REQUEST_GUARDS" (user_id, operation, request_id)
  select user_id, 'encoder', request_id from input
  on conflict do nothing
  returning 1 as inserted
), rate_window as (
  insert into public."RETROSTUDIO_RATE_WINDOWS" (user_id, operation, window_started_at, request_count)
  select user_id, 'encoder', window_started_at, 1 from input
  on conflict (user_id, operation, window_started_at)
  do update set request_count = "RETROSTUDIO_RATE_WINDOWS".request_count + 1
  returning request_count
), current_state as (
  select
    exists (select 1 from auth.users u join input i on i.user_id = u.id) as user_exists,
    exists (select 1 from request_guard) as first_request,
    (select request_count from rate_window) as request_count,
    exists (
      select 1 from public."RETROSTUDIO_BANS" b join input i on i.user_id = b.user_id
      where b.banned_until > now()
    ) as banned,
    coalesce((select r.risk_level from public."RETROSTUDIO_RISK_STATE" r join input i on i.user_id = r.user_id), 'normal') as risk_level,
    (select r.restricted_until from public."RETROSTUDIO_RISK_STATE" r join input i on i.user_id = r.user_id) as restricted_until,
    (select c.credits from public."FREE_AI_CREDITS" c join input i on i.user_id = c.user_id) as credits,
    (select c.reset_at from public."FREE_AI_CREDITS" c join input i on i.user_id = c.user_id) as reset_at,
    (select device_hash ~ '^[a-f0-9]{64}$' from input) as valid_device,
    (select request_id ~ '^[A-Za-z0-9_-]{16,128}$' from input) as valid_request,
    (select source_characters between 1 and 120000 from input) as valid_size
)
select
  user_exists and first_request and valid_device and valid_request and valid_size
    and not banned and (restricted_until is null or restricted_until <= now()) and risk_level <> 'severe'
    and request_count <= case when risk_level = 'high' then 2 when risk_level = 'suspicious' then 4 else 8 end,
  case
    when not user_exists then 'AUTH_REQUIRED'
    when not valid_device or not valid_request or not valid_size then 'INVALID_INPUT'
    when not first_request then 'REPLAY_REJECTED'
    when banned then 'ACCOUNT_RESTRICTED'
    when risk_level = 'severe' or (restricted_until is not null and restricted_until > now()) then 'ACCOUNT_REVIEW'
    when request_count > case when risk_level = 'high' then 2 when risk_level = 'suspicious' then 4 else 8 end then 'RATE_LIMITED'
    else 'AUTHORIZED'
  end,
  coalesce(credits, 0), reset_at, risk_level
from current_state
$function$;

revoke all on function public.retrostudio_private_authorize_encoder(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.retrostudio_private_authorize_encoder(uuid, text, text, integer) to service_role;

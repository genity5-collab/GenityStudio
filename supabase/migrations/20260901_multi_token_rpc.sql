-- Multi-token deduction RPC for Retrox deep research (live catalog search).
-- A normal Retrox prompt costs 1 token; a deep-research prompt that triggers
-- live Roblox catalog search costs 2 tokens (more compute, more API calls).
-- The server decides the cost — the client never sets it.

begin;

create or replace function public.consume_free_ai_tokens(p_count integer default 1)
returns table (tokens_remaining integer, reset_at timestamptz, tokens_charged integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_tokens integer;
  v_reset_at timestamptz;
  v_charge integer := greatest(1, least(p_count, 3));  -- clamp 1..3
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  insert into public."FREE_AI_CREDITS" (user_id, credits, reset_at)
  values (v_user_id, 5, now() + interval '48 hours')
  on conflict (user_id) do nothing;

  select c.credits, c.reset_at
  into v_tokens, v_reset_at
  from public."FREE_AI_CREDITS" as c
  where c.user_id = v_user_id
  for update;

  if v_reset_at <= now() then
    v_tokens := 5;
    v_reset_at := now() + interval '48 hours';
  end if;

  if v_tokens < v_charge then
    raise exception 'Free AI tokens are exhausted';
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

commit;

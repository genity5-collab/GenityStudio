-- RetroStudio Free AI token RPC repair.
-- Apply this after 20260821_social_chat_and_free_ai.sql.
-- The public UI calls these units "tokens"; the stored column remains credits
-- so existing allocated balances are preserved without data loss.

begin;

create or replace function public.consume_free_ai_token()
returns table (tokens_remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_tokens integer;
  v_reset_at timestamptz;
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

  if v_tokens <= 0 then
    raise exception 'Free AI tokens are exhausted';
  end if;

  v_tokens := v_tokens - 1;
  update public."FREE_AI_CREDITS" as c
  set credits = v_tokens,
      reset_at = v_reset_at,
      updated_at = now()
  where c.user_id = v_user_id;

  return query select v_tokens, v_reset_at;
end;
$$;

create or replace function public.get_free_ai_tokens()
returns table (tokens_remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_tokens integer;
  v_reset_at timestamptz;
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
    update public."FREE_AI_CREDITS" as c
    set credits = v_tokens,
        reset_at = v_reset_at,
        updated_at = now()
    where c.user_id = v_user_id;
  end if;

  return query select v_tokens, v_reset_at;
end;
$$;

revoke all on function public.consume_free_ai_token() from public;
revoke all on function public.get_free_ai_tokens() from public;
grant execute on function public.consume_free_ai_token() to authenticated;
grant execute on function public.get_free_ai_tokens() to authenticated;

commit;

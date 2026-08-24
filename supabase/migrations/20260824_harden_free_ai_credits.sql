-- Drastic hardening of in-app currency (Free AI / Retrox tokens).
-- Clients must never INSERT/UPDATE/DELETE FREE_AI_CREDITS directly.
-- Only security-definer RPCs may change balances. Auth required for every call.

begin;

-- Ensure table exists with safe bounds (idempotent with prior migrations).
create table if not exists public."FREE_AI_CREDITS" (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credits integer not null default 5 check (credits between 0 and 5),
  reset_at timestamptz not null default (now() + interval '48 hours'),
  updated_at timestamptz not null default now()
);

-- Force the check constraint even if an older table lacked it.
alter table public."FREE_AI_CREDITS"
  drop constraint if exists "FREE_AI_CREDITS_credits_check";
alter table public."FREE_AI_CREDITS"
  add constraint "FREE_AI_CREDITS_credits_check" check (credits between 0 and 5);

alter table public."FREE_AI_CREDITS" enable row level security;

-- Drop any permissive write policies that may have been added by hand.
drop policy if exists "retrostudio_free_credit_read" on public."FREE_AI_CREDITS";
drop policy if exists "retrostudio_free_credit_insert" on public."FREE_AI_CREDITS";
drop policy if exists "retrostudio_free_credit_update" on public."FREE_AI_CREDITS";
drop policy if exists "retrostudio_free_credit_delete" on public."FREE_AI_CREDITS";
drop policy if exists "Users can update own credits" on public."FREE_AI_CREDITS";
drop policy if exists "Users can insert own credits" on public."FREE_AI_CREDITS";
drop policy if exists "Enable all for authenticated" on public."FREE_AI_CREDITS";

-- Read-only for the owner. No INSERT / UPDATE / DELETE policies for clients.
create policy "retrostudio_free_credit_read"
on public."FREE_AI_CREDITS"
for select
to authenticated
using (auth.uid() = user_id);

-- Explicitly revoke table privileges that PostgREST would otherwise expose.
revoke all on table public."FREE_AI_CREDITS" from public;
revoke all on table public."FREE_AI_CREDITS" from anon;
revoke insert, update, delete, truncate, references, trigger on table public."FREE_AI_CREDITS" from authenticated;
grant select on table public."FREE_AI_CREDITS" to authenticated;

-- Harden consume / get RPCs (token naming used by the edge function + UI).
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

-- Keep legacy names working but identical.
create or replace function public.consume_free_ai_credit()
returns table (credits_remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  select * into r from public.consume_free_ai_token();
  return query select r.tokens_remaining, r.reset_at;
end;
$$;

create or replace function public.get_free_ai_credits()
returns table (credits_remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  select * into r from public.get_free_ai_tokens();
  return query select r.tokens_remaining, r.reset_at;
end;
$$;

-- No public / anon execution. Authenticated only.
revoke all on function public.consume_free_ai_token() from public, anon;
revoke all on function public.get_free_ai_tokens() from public, anon;
revoke all on function public.consume_free_ai_credit() from public, anon;
revoke all on function public.get_free_ai_credits() from public, anon;

grant execute on function public.consume_free_ai_token() to authenticated;
grant execute on function public.get_free_ai_tokens() to authenticated;
grant execute on function public.consume_free_ai_credit() to authenticated;
grant execute on function public.get_free_ai_credits() to authenticated;

-- Optional audit trail (append-only from definer functions later if needed).
create table if not exists public."FREE_AI_CREDIT_AUDIT" (
  id bigserial primary key,
  user_id uuid not null,
  action text not null check (action in ('consume', 'reset', 'grant')),
  delta integer not null,
  balance_after integer not null,
  created_at timestamptz not null default now()
);
alter table public."FREE_AI_CREDIT_AUDIT" enable row level security;
drop policy if exists "retrostudio_credit_audit_read" on public."FREE_AI_CREDIT_AUDIT";
create policy "retrostudio_credit_audit_read"
on public."FREE_AI_CREDIT_AUDIT"
for select to authenticated
using (auth.uid() = user_id);
revoke all on table public."FREE_AI_CREDIT_AUDIT" from public, anon;
revoke insert, update, delete, truncate on table public."FREE_AI_CREDIT_AUDIT" from authenticated;
grant select on table public."FREE_AI_CREDIT_AUDIT" to authenticated;

commit;

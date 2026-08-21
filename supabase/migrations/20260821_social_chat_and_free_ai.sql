-- RetroStudio social/chat access and server-authoritative Free AI credits.
-- Apply in the Supabase SQL editor or through your normal migration workflow.
-- This migration intentionally uses quoted uppercase names because the existing app uses
-- FRIENDSHIPS, CHAT_MESSAGES, NOTIFICATIONS, and ACCOUNTS as quoted identifiers.

begin;

-- SOCIAL AND CHAT ROW-LEVEL SECURITY
alter table public."FRIENDSHIPS" enable row level security;
alter table public."CHAT_MESSAGES" enable row level security;
alter table public."NOTIFICATIONS" enable row level security;

-- Replace only the policies owned by RetroStudio. Existing unrelated policies remain untouched.
drop policy if exists "retrostudio_friends_select" on public."FRIENDSHIPS";
drop policy if exists "retrostudio_friends_insert" on public."FRIENDSHIPS";
drop policy if exists "retrostudio_friends_accept" on public."FRIENDSHIPS";
drop policy if exists "retrostudio_friends_delete" on public."FRIENDSHIPS";

create policy "retrostudio_friends_select"
on public."FRIENDSHIPS" for select to authenticated
using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "retrostudio_friends_insert"
on public."FRIENDSHIPS" for insert to authenticated
with check (
  auth.uid() = requester_id
  and requester_id <> addressee_id
  and status = 'pending'
);

create policy "retrostudio_friends_accept"
on public."FRIENDSHIPS" for update to authenticated
using (auth.uid() = addressee_id)
with check (
  auth.uid() = addressee_id
  and status = 'accepted'
);

create policy "retrostudio_friends_delete"
on public."FRIENDSHIPS" for delete to authenticated
using (auth.uid() = requester_id or auth.uid() = addressee_id);

drop policy if exists "retrostudio_chat_select" on public."CHAT_MESSAGES";
drop policy if exists "retrostudio_chat_insert" on public."CHAT_MESSAGES";
drop policy if exists "retrostudio_chat_mark_read" on public."CHAT_MESSAGES";

create policy "retrostudio_chat_select"
on public."CHAT_MESSAGES" for select to authenticated
using (auth.uid() = sender_id or auth.uid() = receiver_id);

create policy "retrostudio_chat_insert"
on public."CHAT_MESSAGES" for insert to authenticated
with check (
  auth.uid() = sender_id
  and sender_id <> receiver_id
  and char_length(content) between 1 and 500
);

create policy "retrostudio_chat_mark_read"
on public."CHAT_MESSAGES" for update to authenticated
using (auth.uid() = receiver_id)
with check (auth.uid() = receiver_id);

drop policy if exists "retrostudio_notifications_select" on public."NOTIFICATIONS";
drop policy if exists "retrostudio_notifications_update" on public."NOTIFICATIONS";

create policy "retrostudio_notifications_select"
on public."NOTIFICATIONS" for select to authenticated
using (auth.uid() = user_id);

create policy "retrostudio_notifications_update"
on public."NOTIFICATIONS" for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- FREE AI: five server-side credits every 48 hours.
create table if not exists public."FREE_AI_CREDITS" (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credits integer not null default 5 check (credits between 0 and 5),
  reset_at timestamptz not null default (now() + interval '48 hours'),
  updated_at timestamptz not null default now()
);

alter table public."FREE_AI_CREDITS" enable row level security;
drop policy if exists "retrostudio_free_credit_read" on public."FREE_AI_CREDITS";
create policy "retrostudio_free_credit_read"
on public."FREE_AI_CREDITS" for select to authenticated
using (auth.uid() = user_id);

-- Keeps allocation and deduction atomic. Only the server-side Free AI endpoint should call this.
create or replace function public.consume_free_ai_credit()
returns table (credits_remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_credits integer;
  next_reset timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  insert into public."FREE_AI_CREDITS" (user_id, credits, reset_at)
  values (auth.uid(), 5, now() + interval '48 hours')
  on conflict (user_id) do nothing;

  select credits, reset_at
  into current_credits, next_reset
  from public."FREE_AI_CREDITS"
  where user_id = auth.uid()
  for update;

  if next_reset <= now() then
    current_credits := 5;
    next_reset := now() + interval '48 hours';
  end if;

  if current_credits <= 0 then
    raise exception 'Free AI credits are exhausted';
  end if;

  current_credits := current_credits - 1;
  update public."FREE_AI_CREDITS"
  set credits = current_credits,
      reset_at = next_reset,
      updated_at = now()
  where user_id = auth.uid();

  return query select current_credits, next_reset;
end;
$$;

create or replace function public.get_free_ai_credits()
returns table (credits_remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_credits integer;
  next_reset timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  insert into public."FREE_AI_CREDITS" (user_id, credits, reset_at)
  values (auth.uid(), 5, now() + interval '48 hours')
  on conflict (user_id) do nothing;

  select credits, reset_at
  into current_credits, next_reset
  from public."FREE_AI_CREDITS"
  where user_id = auth.uid()
  for update;

  if next_reset <= now() then
    current_credits := 5;
    next_reset := now() + interval '48 hours';
    update public."FREE_AI_CREDITS"
    set credits = current_credits,
        reset_at = next_reset,
        updated_at = now()
    where user_id = auth.uid();
  end if;

  return query select current_credits, next_reset;
end;
$$;

revoke all on function public.consume_free_ai_credit() from public;
revoke all on function public.get_free_ai_credits() from public;
grant execute on function public.consume_free_ai_credit() to authenticated;
grant execute on function public.get_free_ai_credits() to authenticated;

commit;

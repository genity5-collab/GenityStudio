begin;

create table if not exists public."RETROSTUDIO_SECURITY_EVENTS" (
  id bigint generated always as identity primary key,
  subject_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type ~ '^[a-z0-9_]{3,80}$'),
  request_id text check (request_id is null or request_id ~ '^[A-Za-z0-9_-]{16,128}$'),
  device_hash char(64) check (device_hash is null or device_hash ~ '^[a-f0-9]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists retrostudio_security_events_subject_created_idx
  on public."RETROSTUDIO_SECURITY_EVENTS" (subject_user_id, created_at desc);

create table if not exists public."RETROSTUDIO_REQUEST_GUARDS" (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null check (operation in ('encoder')),
  request_id text not null check (request_id ~ '^[A-Za-z0-9_-]{16,128}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, operation, request_id)
);

create table if not exists public."RETROSTUDIO_RATE_WINDOWS" (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null check (operation in ('encoder')),
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0 and request_count <= 10000),
  primary key (user_id, operation, window_started_at)
);

create table if not exists public."RETROSTUDIO_RISK_STATE" (
  user_id uuid primary key references auth.users(id) on delete cascade,
  risk_level text not null default 'normal' check (risk_level in ('normal', 'suspicious', 'high', 'severe')),
  risk_score integer not null default 0 check (risk_score between 0 and 100),
  restricted_until timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public."RETROSTUDIO_TOKEN_LEDGER" (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(7,1) not null check (amount <> 0 and amount between -10000 and 10000),
  balance_after numeric(7,1) not null check (balance_after between 0 and 10000),
  entry_type text not null check (entry_type in ('starter_grant', 'reset', 'usage', 'admin_adjustment', 'subscription_grant', 'revocation')),
  request_id text check (request_id is null or request_id ~ '^[A-Za-z0-9_-]{16,128}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, request_id)
);

create index if not exists retrostudio_token_ledger_user_created_idx
  on public."RETROSTUDIO_TOKEN_LEDGER" (user_id, created_at desc);

alter table public."RETROSTUDIO_SECURITY_EVENTS" enable row level security;
alter table public."RETROSTUDIO_REQUEST_GUARDS" enable row level security;
alter table public."RETROSTUDIO_RATE_WINDOWS" enable row level security;
alter table public."RETROSTUDIO_RISK_STATE" enable row level security;
alter table public."RETROSTUDIO_TOKEN_LEDGER" enable row level security;
alter table public."RETROSTUDIO_SECURITY_EVENTS" force row level security;
alter table public."RETROSTUDIO_REQUEST_GUARDS" force row level security;
alter table public."RETROSTUDIO_RATE_WINDOWS" force row level security;
alter table public."RETROSTUDIO_RISK_STATE" force row level security;
alter table public."RETROSTUDIO_TOKEN_LEDGER" force row level security;

revoke all on table public."RETROSTUDIO_SECURITY_EVENTS" from public, anon, authenticated;
revoke all on table public."RETROSTUDIO_REQUEST_GUARDS" from public, anon, authenticated;
revoke all on table public."RETROSTUDIO_RATE_WINDOWS" from public, anon, authenticated;
revoke all on table public."RETROSTUDIO_RISK_STATE" from public, anon, authenticated;
revoke all on table public."RETROSTUDIO_TOKEN_LEDGER" from public, anon, authenticated;
grant select, insert, update, delete on table public."RETROSTUDIO_SECURITY_EVENTS" to service_role;
grant select, insert, update, delete on table public."RETROSTUDIO_REQUEST_GUARDS" to service_role;
grant select, insert, update, delete on table public."RETROSTUDIO_RATE_WINDOWS" to service_role;
grant select, insert, update, delete on table public."RETROSTUDIO_RISK_STATE" to service_role;
grant select, insert, update, delete on table public."RETROSTUDIO_TOKEN_LEDGER" to service_role;
grant usage, select on all sequences in schema public to service_role;

commit;

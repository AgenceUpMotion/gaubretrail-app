-- Execute with `supabase db push` or paste into the Supabase SQL editor.
-- The application accesses these tables only from its Next.js server using the
-- service-role secret. RLS and explicit grants deny direct browser access.

create table if not exists public.gaubretrail_state (
  id smallint primary key check (id = 1),
  revision bigint not null check (revision >= 1),
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.gaubretrail_previous_state (
  id smallint primary key check (id = 1),
  revision bigint not null check (revision >= 1),
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.gaubretrail_sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  credential_hash text not null check (credential_hash ~ '^[a-f0-9]{64}$'),
  expires bigint not null
);

create index if not exists gaubretrail_sessions_expires_idx on public.gaubretrail_sessions (expires);

create table if not exists public.gaubretrail_login_limits (
  id_key text primary key,
  attempts integer not null check (attempts > 0),
  expires bigint not null
);

create index if not exists gaubretrail_login_limits_expires_idx on public.gaubretrail_login_limits (expires);

alter table public.gaubretrail_state enable row level security;
alter table public.gaubretrail_previous_state enable row level security;
alter table public.gaubretrail_sessions enable row level security;
alter table public.gaubretrail_login_limits enable row level security;

revoke all on table public.gaubretrail_state, public.gaubretrail_previous_state,
  public.gaubretrail_sessions, public.gaubretrail_login_limits from anon, authenticated;

create or replace function public.save_gaubretrail_state(expected_revision bigint, next_payload jsonb)
returns bigint
language plpgsql
set search_path = public
as $$
declare current_state public.gaubretrail_state%rowtype;
begin
  select * into current_state from public.gaubretrail_state where id = 1 for update;
  if not found then
    raise exception 'GaubreTrail state has not been initialized' using errcode = 'P0001';
  end if;
  if current_state.revision <> expected_revision then
    raise exception 'GaubreTrail state revision conflict' using errcode = 'P0001';
  end if;

  insert into public.gaubretrail_previous_state (id, revision, payload, updated_at)
  values (1, current_state.revision, current_state.payload, now())
  on conflict (id) do update set revision = excluded.revision, payload = excluded.payload, updated_at = excluded.updated_at;

  update public.gaubretrail_state
  set revision = current_state.revision + 1, payload = next_payload, updated_at = now()
  where id = 1;
  return current_state.revision + 1;
end;
$$;

create or replace function public.consume_gaubretrail_login_attempt(attempt_key text)
returns integer
language plpgsql
set search_path = public
as $$
declare next_attempts integer;
declare expiry bigint := floor(extract(epoch from now()) * 1000)::bigint + 15 * 60 * 1000;
begin
  delete from public.gaubretrail_login_limits
  where expires <= floor(extract(epoch from now()) * 1000)::bigint;

  insert into public.gaubretrail_login_limits (id_key, attempts, expires)
  values (attempt_key, 1, expiry)
  on conflict (id_key) do update
    set attempts = public.gaubretrail_login_limits.attempts + 1,
        expires = excluded.expires
  returning attempts into next_attempts;
  return next_attempts;
end;
$$;

revoke all on function public.save_gaubretrail_state(bigint, jsonb),
  public.consume_gaubretrail_login_attempt(text) from public;
grant execute on function public.save_gaubretrail_state(bigint, jsonb),
  public.consume_gaubretrail_login_attempt(text) to service_role;

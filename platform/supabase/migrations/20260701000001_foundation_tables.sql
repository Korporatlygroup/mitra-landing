-- Phase 1 foundation: schemas, enums and tables.
-- All tables are RLS-enabled in 20260701000005_rls_and_grants.sql (deny by default).

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Never hand out privileges implicitly: every grant in this project is explicit.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema private revoke execute on functions from public, anon, authenticated, service_role;

create type public.org_type as enum ('business', 'buyer', 'partner', 'mitra');
create type public.org_status as enum ('active', 'suspended');
create type public.member_role as enum (
  'owner', 'manager', 'staff', 'viewer',
  'admin_review', 'admin_content', 'admin_support', 'admin_ops', 'admin_super'
);
create type public.member_status as enum ('active', 'removed');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 120),
  language text not null default 'en' check (language in ('en', 'ta')),
  created_at timestamptz not null default now()
);

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  type public.org_type not null,
  name text not null check (char_length(name) between 2 and 160),
  status public.org_status not null default 'active',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
-- Exactly one MITRA administration organisation may exist.
create unique index organisations_one_mitra on public.organisations ((true)) where type = 'mitra';

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  status public.member_status not null default 'active',
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  unique (org_id, user_id)
);
create index memberships_user_active on public.memberships (user_id) where status = 'active';

-- Static, seeded; the application can only read it. Mirrors src/lib/permissions.ts.
create table public.role_permissions (
  role public.member_role not null,
  permission text not null,
  primary key (role, permission)
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  email extensions.citext not null check (char_length(email::text) <= 254),
  role public.member_role not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index invitations_one_pending on public.invitations (org_id, email)
  where accepted_at is null and revoked_at is null;

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  purpose text not null check (char_length(purpose) <= 60),
  version text not null check (char_length(version) <= 40),
  granted_at timestamptz not null default now(),
  withdrawn_at timestamptz
);
create index consents_user on public.consents (user_id);

-- Append-only. No FK on actor/org so history survives erasure/deletion (anonymise instead).
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_user_id uuid,
  actor_org_id uuid,
  org_id uuid,
  action text not null check (char_length(action) <= 80),
  entity_type text,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  source text not null default 'db' check (source in ('db', 'app-server', 'bootstrap', 'system'))
);
create index audit_log_org_at on public.audit_log (org_id, at desc);
create index audit_log_actor_at on public.audit_log (actor_user_id, at desc);

create table public.rate_limit_events (
  id bigint generated always as identity primary key,
  key text not null,
  at timestamptz not null default now()
);
create index rate_limit_events_key_at on public.rate_limit_events (key, at desc);

-- One-row state for the first-administrator bootstrap (single use).
create table private.bootstrap_state (
  singleton boolean primary key default true check (singleton),
  completed_at timestamptz,
  completed_user_id uuid
);
insert into private.bootstrap_state (singleton) values (true);

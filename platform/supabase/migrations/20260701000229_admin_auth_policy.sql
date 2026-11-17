-- Administrator authentication policy as an explicit, audited switch.
-- Until now every administrator role needed an MFA (aal2) session, hard-coded in private.requires_mfa. The product owner has accepted password-only
-- administrator sign-in for the production project. Rather than removing the rule for every environment, this makes it one row of policy:
-- the default stays "required" (so a new or test database keeps the strict rule), and an operator can switch it per project with an audit entry.
-- Authorisation itself is unchanged: roles, RLS, has_permission, conflict-of-interest checks, audit log and rate limits all still apply.
-- MFA for owners of partner organisations is not affected.

create table private.auth_policy (
  key text primary key check (key in ('admin_mfa_required')),
  enabled boolean not null,
  reason text check (char_length(reason) <= 500),
  changed_at timestamptz not null default now()
);
alter table private.auth_policy enable row level security;
insert into private.auth_policy (key, enabled, reason) values ('admin_mfa_required', true, 'default: strict');

-- Same signature as before, now reading the policy (stable instead of immutable).
create or replace function private.requires_mfa(p_role public.member_role, p_type public.org_type)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (private.is_admin_role(p_role) and coalesce((select p.enabled from private.auth_policy p where p.key = 'admin_mfa_required'), true))
      or (p_type = 'partner' and p_role = 'owner')
$$;

-- The application reads the policy through this function so the page gate and the database always agree. Fails closed when absent.
create function public.admin_mfa_required()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select coalesce((select p.enabled from private.auth_policy p where p.key = 'admin_mfa_required'), true) $$;
revoke all on function public.admin_mfa_required() from public, anon;
grant execute on function public.admin_mfa_required() to authenticated;

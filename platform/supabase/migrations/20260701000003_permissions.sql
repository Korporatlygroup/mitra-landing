-- Permission model: fixed role templates (seeded) + membership-scoped checks used by RLS and RPCs.
-- Org roles: owner > manager > staff > viewer. Admin roles exist only in the single `mitra` organisation.

insert into public.role_permissions (role, permission) values
  -- Organisation roles
  ('owner', 'org:manage'), ('owner', 'member:invite'), ('owner', 'member:remove'),
  ('owner', 'member:set_role'), ('owner', 'audit:read'),
  ('manager', 'member:invite'), ('manager', 'member:remove'), ('manager', 'member:set_role'),
  -- MITRA administration roles (MFA / aal2 enforced in has_permission)
  ('admin_super', 'admin:users'), ('admin_super', 'audit:read'), ('admin_super', 'org:manage'),
  ('admin_ops', 'audit:read'),
  -- Declared now, used by later phases
  ('admin_super', 'verification:review'), ('admin_super', 'programme:publish'),
  ('admin_super', 'case:reply'), ('admin_super', 'report:view'),
  ('admin_review', 'verification:review'),
  ('admin_content', 'programme:publish'),
  ('admin_support', 'case:reply'),
  ('admin_ops', 'report:view');

create function private.role_rank(p_role public.member_role)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_role when 'owner' then 4 when 'manager' then 3 when 'staff' then 2 when 'viewer' then 1 else 0 end
$$;

create function private.is_admin_role(p_role public.member_role)
returns boolean
language sql
immutable
set search_path = ''
as $$ select p_role::text like 'admin\_%' $$;

-- MFA (aal2) is required for every admin role and for owners of partner organisations.
create function private.requires_mfa(p_role public.member_role, p_type public.org_type)
returns boolean
language sql
immutable
set search_path = ''
as $$ select private.is_admin_role(p_role) or (p_type = 'partner' and p_role = 'owner') $$;

create function private.current_aal()
returns text
language sql
stable
set search_path = ''
as $$ select coalesce(auth.jwt() ->> 'aal', 'aal1') $$;

create function private.is_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active'
  )
$$;

create function private.has_permission(p_org uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.organisations o on o.id = m.org_id
    join public.role_permissions rp on rp.role = m.role and rp.permission = p_permission
    where m.org_id = p_org
      and m.user_id = auth.uid()
      and m.status = 'active'
      and o.status = 'active'
      and (not private.requires_mfa(m.role, o.type) or private.current_aal() = 'aal2')
  )
$$;

-- Platform-wide permission = permission held in the MITRA organisation.
create function private.has_platform_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organisations o
    where o.type = 'mitra' and private.has_permission(o.id, p_permission)
  )
$$;

create function private.shares_org(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships a
    join public.memberships b on b.org_id = a.org_id
    where a.user_id = auth.uid() and a.status = 'active'
      and b.user_id = p_user and b.status = 'active'
  )
$$;

-- Who may manage members of an org: org permission for normal orgs, admin:users for the MITRA org.
create function private.can_manage_members(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select o.type from public.organisations o where o.id = p_org) = 'mitra'
      then private.has_permission(p_org, 'admin:users')
    else private.has_permission(p_org, 'member:invite')
      or private.has_permission(p_org, 'member:remove')
      or private.has_permission(p_org, 'member:set_role')
  end
$$;

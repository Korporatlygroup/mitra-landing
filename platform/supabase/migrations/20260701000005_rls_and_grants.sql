-- Row Level Security and explicit grants. Deny by default; no application role can write identity tables directly.

alter table public.profiles enable row level security;
alter table public.organisations enable row level security;
alter table public.memberships enable row level security;
alter table public.role_permissions enable row level security;
alter table public.invitations enable row level security;
alter table public.consents enable row level security;
alter table public.audit_log enable row level security;
alter table public.rate_limit_events enable row level security;
alter table private.bootstrap_state enable row level security;

-- Start from nothing, then grant exactly what is needed.
revoke all on all tables in schema public from public, anon, authenticated, service_role;
revoke all on all sequences in schema public from public, anon, authenticated, service_role;
revoke all on all functions in schema public from public, anon, authenticated, service_role;
revoke all on all tables in schema private from public, anon, authenticated, service_role;
revoke all on all functions in schema private from public, anon, authenticated;

-- profiles: own row and people who share an organisation; users may edit only their own name/language.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_org(id));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
grant select on public.profiles to authenticated;
grant update (display_name, language) on public.profiles to authenticated;

-- organisations: members can read their organisations. Writes only via RPCs.
create policy organisations_select on public.organisations for select to authenticated
  using (private.is_member(id));
grant select on public.organisations to authenticated;

-- memberships: members see active colleagues. A removed member sees nothing (immediate loss of access). Writes only via RPCs.
create policy memberships_select on public.memberships for select to authenticated
  using (private.is_member(org_id) and (status = 'active' or user_id = (select auth.uid())));
grant select on public.memberships to authenticated;

-- role_permissions: readable reference data.
create policy role_permissions_select on public.role_permissions for select to authenticated using (true);
grant select on public.role_permissions to authenticated;

-- invitations: managers of the org only; the token hash is never readable.
create policy invitations_select on public.invitations for select to authenticated
  using (private.can_manage_members(org_id));
grant select (id, org_id, email, role, expires_at, accepted_at, revoked_at, invited_by, created_at)
  on public.invitations to authenticated;

-- consents: own rows, read-only (withdraw via RPC; granted at sign-up by trigger).
create policy consents_select_own on public.consents for select to authenticated
  using (user_id = (select auth.uid()));
grant select on public.consents to authenticated;

-- audit_log: org owners read their org's rows; MITRA admins with audit:read read everything.
-- No INSERT/UPDATE/DELETE/TRUNCATE privilege for ANY API role: only SECURITY DEFINER code writes.
create policy audit_log_select on public.audit_log for select to authenticated
  using (
    (org_id is not null and private.has_permission(org_id, 'audit:read'))
    or private.has_platform_permission('audit:read')
  );
grant select on public.audit_log to authenticated;

-- RPC surface
grant execute on function
  public.create_org(public.org_type, text),
  public.rename_org(uuid, text),
  public.create_invitation(uuid, text, public.member_role),
  public.accept_invitation(text),
  public.revoke_invitation(uuid),
  public.remove_member(uuid, uuid),
  public.set_member_role(uuid, uuid, public.member_role),
  public.withdraw_consent(uuid)
  to authenticated;

-- Trusted server only (service role key is never shipped to browsers).
grant execute on function
  public.service_record_auth_event(uuid, text, jsonb),
  public.bootstrap_first_admin(text)
  to service_role;

-- Permission helpers used inside RLS policies and RPCs (re-granted after the blanket revoke above).
grant execute on function
  private.invalid_invitation(),
  private.is_member(uuid), private.has_permission(uuid, text), private.has_platform_permission(text),
  private.shares_org(uuid), private.can_manage_members(uuid), private.current_aal(),
  private.requires_mfa(public.member_role, public.org_type), private.is_admin_role(public.member_role),
  private.role_rank(public.member_role)
  to authenticated;

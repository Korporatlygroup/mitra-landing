-- Branding: the operator organisation is called INOK, not MITRA (MITRA is a separate government programme; the platform must not
-- present itself as, or as run by, that body). Only the display name changes. The organisation type value 'mitra' is an internal
-- identifier used by RLS and permission checks and stays as it is. The first-administrator bootstrap creates the organisation
-- under the new name; the body below is identical to the one in 20260701000004 apart from that literal.
update public.organisations set name = 'INOK Administration' where type = 'mitra' and name = 'MITRA Administration';

create or replace function public.bootstrap_first_admin(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state private.bootstrap_state;
  v_user uuid;
  v_org uuid;
begin
  select * into v_state from private.bootstrap_state for update;
  if v_state.completed_at is not null
     or exists (select 1 from public.memberships m where m.role = 'admin_super') then
    perform private.raise_error('conflict', 'already_bootstrapped');
  end if;

  select u.id into v_user from auth.users u
  where lower(u.email) = lower(btrim(coalesce(p_email, '')))
    and u.email_confirmed_at is not null and u.deleted_at is null
    and (u.banned_until is null or u.banned_until < now());
  if v_user is null then perform private.raise_error('not_found', 'user_not_found_or_unconfirmed'); end if;

  select o.id into v_org from public.organisations o where o.type = 'mitra';
  if v_org is null then
    insert into public.organisations (type, name, created_by) values ('mitra', 'INOK Administration', v_user)
    returning id into v_org;
  end if;
  insert into public.memberships (org_id, user_id, role) values (v_org, v_user, 'admin_super')
  on conflict (org_id, user_id) do update set role = 'admin_super', status = 'active', removed_at = null;

  update private.bootstrap_state set completed_at = now(), completed_user_id = v_user where singleton;
  insert into public.audit_log (actor_user_id, org_id, action, entity_type, entity_id, details, source)
  values (null, v_org, 'bootstrap.first_admin', 'user', v_user::text, jsonb_build_object('user_id', v_user), 'bootstrap');
  return v_user;
end;
$$;

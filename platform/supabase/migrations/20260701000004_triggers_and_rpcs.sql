-- Integrity triggers, audit triggers and the RPC surface.
-- Application roles have NO direct write access to identity tables (see 000005); every mutation goes through
-- the functions below, which run in the same transaction as their audit rows.

------------------------------------------------------------------------------------------------
-- New auth user -> profile (+ consents recorded at sign-up)
------------------------------------------------------------------------------------------------
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purpose text;
  v_version text;
begin
  insert into public.profiles (id, display_name, language)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 120),
    case when new.raw_user_meta_data ->> 'language' = 'ta' then 'ta' else 'en' end
  )
  on conflict (id) do nothing;

  foreach v_purpose in array array['terms', 'privacy'] loop
    v_version := new.raw_user_meta_data -> 'consents' ->> v_purpose;
    if v_version is not null and v_version ~ '^[0-9A-Za-z._-]{1,40}$' then
      insert into public.consents (user_id, purpose, version) values (new.id, v_purpose, v_version);
    end if;
  end loop;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

------------------------------------------------------------------------------------------------
-- Integrity triggers
------------------------------------------------------------------------------------------------
create function private.organisations_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.type <> old.type or (new.created_by is distinct from old.created_by and new.created_by is not null) then
    perform private.raise_error('invalid', 'immutable_columns');
  end if;
  if new.type = 'mitra' and new.status <> 'active' then
    perform private.raise_error('invalid', 'mitra_org_cannot_be_suspended');
  end if;
  return new;
end;
$$;
create trigger organisations_integrity before update on public.organisations
  for each row execute function private.organisations_integrity();

create function private.memberships_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.org_type;
begin
  select o.type into v_type from public.organisations o where o.id = new.org_id;
  -- Admin roles live only in the MITRA organisation, and the MITRA organisation only has admin roles.
  if (v_type = 'mitra') <> private.is_admin_role(new.role) then
    perform private.raise_error('invalid', 'role_not_allowed_for_org_type');
  end if;

  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id or new.user_id <> old.user_id then
      perform private.raise_error('invalid', 'immutable_columns');
    end if;
    -- The last owner (or last admin_super) can never be removed or demoted.
    if old.status = 'active' and old.role in ('owner', 'admin_super')
       and (new.status <> 'active' or new.role <> old.role) then
      if not exists (
        select 1 from public.memberships m
        where m.org_id = old.org_id and m.role = old.role and m.status = 'active' and m.id <> old.id
      ) then
        perform private.raise_error('conflict', 'last_owner');
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger memberships_integrity before insert or update on public.memberships
  for each row execute function private.memberships_integrity();

------------------------------------------------------------------------------------------------
-- Audit triggers (defence in depth: fire whatever code path changed the row)
------------------------------------------------------------------------------------------------
create function private.audit_organisations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_audit('org.created', new.id, 'organisation', new.id::text,
      jsonb_build_object('type', new.type, 'name', new.name));
  else
    if new.name <> old.name then
      perform private.write_audit('org.renamed', new.id, 'organisation', new.id::text,
        jsonb_build_object('from', old.name, 'to', new.name));
    end if;
    if new.status <> old.status then
      perform private.write_audit('org.status_changed', new.id, 'organisation', new.id::text,
        jsonb_build_object('from', old.status, 'to', new.status));
    end if;
  end if;
  return null;
end;
$$;
create trigger audit_organisations after insert or update on public.organisations
  for each row execute function private.audit_organisations();

create function private.audit_memberships()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_audit('membership.added', new.org_id, 'membership', new.id::text,
      jsonb_build_object('user_id', new.user_id, 'role', new.role));
  else
    if new.role <> old.role then
      perform private.write_audit('membership.role_changed', new.org_id, 'membership', new.id::text,
        jsonb_build_object('user_id', new.user_id, 'from', old.role, 'to', new.role));
    end if;
    if old.status = 'active' and new.status = 'removed' then
      perform private.write_audit('membership.removed', new.org_id, 'membership', new.id::text,
        jsonb_build_object('user_id', new.user_id, 'role', old.role));
    elsif old.status = 'removed' and new.status = 'active' then
      perform private.write_audit('membership.reactivated', new.org_id, 'membership', new.id::text,
        jsonb_build_object('user_id', new.user_id, 'role', new.role));
    end if;
  end if;
  return null;
end;
$$;
create trigger audit_memberships after insert or update on public.memberships
  for each row execute function private.audit_memberships();

create function private.audit_invitations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_audit('invitation.created', new.org_id, 'invitation', new.id::text,
      jsonb_build_object('email', new.email::text, 'role', new.role));
  else
    if old.accepted_at is null and new.accepted_at is not null then
      perform private.write_audit('invitation.accepted', new.org_id, 'invitation', new.id::text,
        jsonb_build_object('email', new.email::text, 'role', new.role, 'accepted_by', new.accepted_by));
    end if;
    if old.revoked_at is null and new.revoked_at is not null then
      perform private.write_audit('invitation.revoked', new.org_id, 'invitation', new.id::text,
        jsonb_build_object('email', new.email::text, 'role', new.role));
    end if;
  end if;
  return null;
end;
$$;
create trigger audit_invitations after insert or update on public.invitations
  for each row execute function private.audit_invitations();

create function private.audit_consents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_audit('consent.granted', null, 'consent', new.id::text,
      jsonb_build_object('user_id', new.user_id, 'purpose', new.purpose, 'version', new.version));
  elsif old.withdrawn_at is null and new.withdrawn_at is not null then
    perform private.write_audit('consent.withdrawn', null, 'consent', new.id::text,
      jsonb_build_object('user_id', new.user_id, 'purpose', new.purpose, 'version', new.version));
  end if;
  return null;
end;
$$;
create trigger audit_consents after insert or update on public.consents
  for each row execute function private.audit_consents();

------------------------------------------------------------------------------------------------
-- RPCs (authenticated)
------------------------------------------------------------------------------------------------
create function public.create_org(p_type public.org_type, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_org uuid;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if p_type not in ('business', 'buyer', 'partner') then
    perform private.raise_error('invalid', 'invalid_org_type');
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 160 then
    perform private.raise_error('invalid', 'invalid_name');
  end if;
  perform private.check_rate_limit('create_org:' || v_user, 10, interval '1 day');
  if (select count(*) from public.organisations o where o.created_by = v_user) >= 10 then
    perform private.raise_error('conflict', 'org_limit_reached');
  end if;
  insert into public.organisations (type, name, created_by) values (p_type, v_name, v_user) returning id into v_org;
  insert into public.memberships (org_id, user_id, role) values (v_org, v_user, 'owner');
  return v_org;
end;
$$;

create function public.rename_org(p_org uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_org, 'org:manage') then perform private.raise_error('forbidden'); end if;
  if char_length(v_name) < 2 or char_length(v_name) > 160 then
    perform private.raise_error('invalid', 'invalid_name');
  end if;
  update public.organisations set name = v_name where id = p_org;
end;
$$;

create function public.create_invitation(p_org uuid, p_email text, p_role public.member_role)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_actor_role public.member_role;
  v_type public.org_type;
  v_token text;
  v_id uuid;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  select m.role, o.type into v_actor_role, v_type
  from public.memberships m join public.organisations o on o.id = m.org_id
  where m.org_id = p_org and m.user_id = v_user and m.status = 'active';
  if v_actor_role is null then perform private.raise_error('forbidden'); end if;

  if v_type = 'mitra' then
    if not private.has_permission(p_org, 'admin:users') then perform private.raise_error('forbidden'); end if;
    if not private.is_admin_role(p_role) then perform private.raise_error('invalid', 'invalid_role'); end if;
  else
    if not private.has_permission(p_org, 'member:invite') then perform private.raise_error('forbidden'); end if;
    if private.is_admin_role(p_role) then perform private.raise_error('invalid', 'invalid_role'); end if;
    -- Never grant above your own role.
    if private.role_rank(p_role) > private.role_rank(v_actor_role) then
      perform private.raise_error('forbidden', 'cannot_grant_above_own_role');
    end if;
  end if;

  if char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    perform private.raise_error('invalid', 'invalid_email');
  end if;
  perform private.check_rate_limit('invite:' || v_user, 20, interval '1 hour');

  if exists (
    select 1 from auth.users u join public.memberships m on m.user_id = u.id
    where lower(u.email) = v_email and m.org_id = p_org and m.status = 'active'
  ) then
    perform private.raise_error('conflict', 'already_member');
  end if;

  update public.invitations set revoked_at = now()
  where org_id = p_org and email = v_email::extensions.citext and accepted_at is null and revoked_at is null;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.invitations (org_id, email, role, token_hash, expires_at, invited_by)
  values (p_org, v_email, p_role, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '7 days', v_user)
  returning id into v_id;

  return jsonb_build_object('invitation_id', v_id, 'token', v_token);
end;
$$;

-- Failed attempts must be counted: an exception would roll back the rate-limit row, so invalid cases RETURN a
-- 404 body ({code:'PT404', message:'invalid_invitation'}) and set PostgREST's response.status instead of raising.
create function private.invalid_invitation()
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('response.status', '404', true);
  return jsonb_build_object('code', 'PT404', 'message', 'invalid_invitation');
end;
$$;

create function public.accept_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_inv public.invitations;
  v_existing public.memberships;
  v_org_status public.org_status;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  perform private.check_rate_limit('accept:' || v_user, 10, interval '1 hour');

  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return private.invalid_invitation();
  end if;
  select * into v_inv from public.invitations i
  where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;

  -- One generic error for unknown / expired / used / revoked / wrong-account, so tokens reveal nothing.
  if v_inv.id is null or v_inv.accepted_at is not null or v_inv.revoked_at is not null
     or v_inv.expires_at < now() or lower(v_inv.email::text) <> v_email
     or not exists (select 1 from auth.users u where u.id = v_user and u.email_confirmed_at is not null) then
    return private.invalid_invitation();
  end if;
  select o.status into v_org_status from public.organisations o where o.id = v_inv.org_id;
  if v_org_status is distinct from 'active' then
    return private.invalid_invitation();
  end if;

  select * into v_existing from public.memberships m where m.org_id = v_inv.org_id and m.user_id = v_user;
  if v_existing.id is not null and v_existing.status = 'active' then
    perform private.raise_error('conflict', 'already_member');
  elsif v_existing.id is not null then
    update public.memberships set role = v_inv.role, status = 'active', removed_at = null where id = v_existing.id;
  else
    insert into public.memberships (org_id, user_id, role) values (v_inv.org_id, v_user, v_inv.role);
  end if;

  update public.invitations set accepted_at = now(), accepted_by = v_user where id = v_inv.id;
  return jsonb_build_object('org_id', v_inv.org_id, 'role', v_inv.role);
end;
$$;

create function public.revoke_invitation(p_invitation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations;
  v_type public.org_type;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into v_inv from public.invitations i where i.id = p_invitation for update;
  if v_inv.id is null then perform private.raise_error('not_found'); end if;
  select o.type into v_type from public.organisations o where o.id = v_inv.org_id;
  if not private.has_permission(v_inv.org_id, case when v_type = 'mitra' then 'admin:users' else 'member:invite' end) then
    perform private.raise_error('forbidden');
  end if;
  if v_inv.accepted_at is not null or v_inv.revoked_at is not null then
    perform private.raise_error('conflict', 'invitation_not_pending');
  end if;
  update public.invitations set revoked_at = now() where id = v_inv.id;
end;
$$;

create function public.remove_member(p_org uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role public.member_role;
  v_target public.memberships;
  v_type public.org_type;
begin
  if v_actor is null then perform private.raise_error('unauthenticated'); end if;
  select m.role, o.type into v_actor_role, v_type
  from public.memberships m join public.organisations o on o.id = m.org_id
  where m.org_id = p_org and m.user_id = v_actor and m.status = 'active';
  if v_actor_role is null then perform private.raise_error('forbidden'); end if;

  select * into v_target from public.memberships m where m.org_id = p_org and m.user_id = p_user and m.status = 'active' for update;
  if v_target.id is null then perform private.raise_error('not_found'); end if;

  if p_user <> v_actor then
    if not private.has_permission(p_org, case when v_type = 'mitra' then 'admin:users' else 'member:remove' end) then
      perform private.raise_error('forbidden');
    end if;
    if v_type <> 'mitra' and v_actor_role <> 'owner'
       and private.role_rank(v_target.role) >= private.role_rank(v_actor_role) then
      perform private.raise_error('forbidden', 'target_outranks_actor');
    end if;
  end if;

  update public.memberships set status = 'removed', removed_at = now() where id = v_target.id;
end;
$$;

create function public.set_member_role(p_org uuid, p_user uuid, p_role public.member_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role public.member_role;
  v_target public.memberships;
  v_type public.org_type;
begin
  if v_actor is null then perform private.raise_error('unauthenticated'); end if;
  if p_user = v_actor then perform private.raise_error('forbidden', 'cannot_change_own_role'); end if;
  select m.role, o.type into v_actor_role, v_type
  from public.memberships m join public.organisations o on o.id = m.org_id
  where m.org_id = p_org and m.user_id = v_actor and m.status = 'active';
  if v_actor_role is null then perform private.raise_error('forbidden'); end if;
  if not private.has_permission(p_org, case when v_type = 'mitra' then 'admin:users' else 'member:set_role' end) then
    perform private.raise_error('forbidden');
  end if;

  select * into v_target from public.memberships m where m.org_id = p_org and m.user_id = p_user and m.status = 'active' for update;
  if v_target.id is null then perform private.raise_error('not_found'); end if;

  if v_type = 'mitra' then
    if not private.is_admin_role(p_role) then perform private.raise_error('invalid', 'invalid_role'); end if;
  else
    if private.is_admin_role(p_role) then perform private.raise_error('invalid', 'invalid_role'); end if;
    if private.role_rank(p_role) > private.role_rank(v_actor_role) then
      perform private.raise_error('forbidden', 'cannot_grant_above_own_role');
    end if;
    if v_actor_role <> 'owner' and private.role_rank(v_target.role) >= private.role_rank(v_actor_role) then
      perform private.raise_error('forbidden', 'target_outranks_actor');
    end if;
  end if;

  update public.memberships set role = p_role where id = v_target.id;
end;
$$;

create function public.withdraw_consent(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  update public.consents set withdrawn_at = now()
  where id = p_id and user_id = auth.uid() and withdrawn_at is null;
  if not found then perform private.raise_error('not_found'); end if;
end;
$$;

------------------------------------------------------------------------------------------------
-- Service-role-only functions (server-side trusted code; never callable from a browser session)
------------------------------------------------------------------------------------------------
-- Auth lifecycle events, recorded by the server after it has verified the session itself.
create function public.service_record_auth_event(p_user uuid, p_action text, p_details jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_action not in ('auth.signup', 'auth.login', 'auth.logout', 'auth.mfa_enrolled', 'auth.mfa_verified', 'auth.password_changed') then
    perform private.raise_error('invalid', 'unknown_action');
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then
    perform private.raise_error('not_found', 'unknown_user');
  end if;
  if length(coalesce(p_details, '{}'::jsonb)::text) > 2000 then
    perform private.raise_error('invalid', 'details_too_large');
  end if;
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, details, source)
  values (p_user, p_action, 'user', p_user::text, coalesce(p_details, '{}'::jsonb), 'app-server');
end;
$$;

-- First-administrator bootstrap: single use, service role only, requires an existing confirmed user.
create function public.bootstrap_first_admin(p_email text)
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
    insert into public.organisations (type, name, created_by) values ('mitra', 'MITRA Administration', v_user)
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

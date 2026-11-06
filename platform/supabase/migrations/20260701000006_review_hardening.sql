-- Phase 1 independent-review hardening (findings H1, H2, M1-M5, L2, L4).
-- Forward-only: replaces function bodies and adds triggers; no data changes.

------------------------------------------------------------------------------------------------
-- Audit helper with an explicit actor (trusted DB code only; never callable by API roles)
------------------------------------------------------------------------------------------------
create function private.write_audit_as(
  p_actor uuid, p_action text, p_org uuid, p_entity_type text, p_entity_id text, p_details jsonb, p_source text default 'db'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (actor_user_id, actor_org_id, org_id, action, entity_type, entity_id, details, source)
  values (p_actor, null, p_org, p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb), p_source);
end;
$$;

------------------------------------------------------------------------------------------------
-- H1: serialise the last-owner / last-admin_super check; M4: guard and audit row deletion
------------------------------------------------------------------------------------------------
create or replace function private.memberships_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.org_type;
begin
  select o.type into v_type from public.organisations o where o.id = new.org_id;
  if (v_type = 'mitra') <> private.is_admin_role(new.role) then
    perform private.raise_error('invalid', 'role_not_allowed_for_org_type');
  end if;

  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id or new.user_id <> old.user_id then
      perform private.raise_error('invalid', 'immutable_columns');
    end if;
    if old.status = 'active' and old.role in ('owner', 'admin_super')
       and (new.status <> 'active' or new.role <> old.role) then
      -- Concurrent demotions of two different owners would each see the other still active; serialise per org.
      perform pg_advisory_xact_lock(hashtext('last_holder:' || old.org_id::text));
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

create function private.memberships_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Skipped when the whole organisation is being deleted (cascade): the org row is already gone.
  if old.status = 'active' and exists (select 1 from public.organisations o where o.id = old.org_id) then
    if old.role = 'admin_super' then
      perform pg_advisory_xact_lock(hashtext('last_holder:' || old.org_id::text));
      if not exists (
        select 1 from public.memberships m
        where m.org_id = old.org_id and m.role = 'admin_super' and m.status = 'active' and m.id <> old.id
      ) then
        perform private.raise_error('conflict', 'last_owner');
      end if;
    end if;
    perform private.write_audit_as(auth.uid(), 'membership.deleted', old.org_id, 'membership', old.id::text,
      jsonb_build_object('user_id', old.user_id, 'role', old.role));
  end if;
  return old;
end;
$$;
create trigger memberships_before_delete before delete on public.memberships
  for each row execute function private.memberships_before_delete();

------------------------------------------------------------------------------------------------
-- L4: banned / deleted users lose permissions immediately (not only when the JWT expires)
------------------------------------------------------------------------------------------------
create or replace function private.has_permission(p_org uuid, p_permission text)
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
    join auth.users u on u.id = m.user_id and u.deleted_at is null and (u.banned_until is null or u.banned_until < now())
    where m.org_id = p_org
      and m.user_id = auth.uid()
      and m.status = 'active'
      and o.status = 'active'
      and (not private.requires_mfa(m.role, o.type) or private.current_aal() = 'aal2')
  )
$$;

------------------------------------------------------------------------------------------------
-- H2: authentication events are derived inside the database, not trusted from the application
------------------------------------------------------------------------------------------------
create function private.audit_auth_sessions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_audit_as(new.user_id, 'auth.login', null, 'user', new.user_id::text,
      jsonb_build_object('aal', new.aal::text));
  elsif old.aal is distinct from new.aal and new.aal::text = 'aal2' then
    perform private.write_audit_as(new.user_id, 'auth.mfa_verified', null, 'user', new.user_id::text, '{}'::jsonb);
  end if;
  return null;
end;
$$;
create trigger audit_auth_sessions after insert or update of aal on auth.sessions
  for each row execute function private.audit_auth_sessions();

create function private.audit_mfa_factors()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status::text <> 'verified' and new.status::text = 'verified' then
    perform private.write_audit_as(new.user_id, 'auth.mfa_enrolled', null, 'user', new.user_id::text,
      jsonb_build_object('factor_type', new.factor_type::text));
  elsif tg_op = 'DELETE' and old.status::text = 'verified' then
    perform private.write_audit_as(old.user_id, 'auth.mfa_unenrolled', null, 'user', old.user_id::text, '{}'::jsonb);
  end if;
  return null;
end;
$$;
create trigger audit_mfa_factors after update of status or delete on auth.mfa_factors
  for each row execute function private.audit_mfa_factors();

-- The application may now only record the events the database cannot observe itself.
create or replace function public.service_record_auth_event(p_user uuid, p_action text, p_details jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_action not in ('auth.logout', 'auth.password_changed') then
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

------------------------------------------------------------------------------------------------
-- M1: consent is recorded only for the current published version and is required before use
------------------------------------------------------------------------------------------------
create function private.current_consent_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '2026-07'::text $$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purpose text;
begin
  insert into public.profiles (id, display_name, language)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 120),
    case when new.raw_user_meta_data ->> 'language' = 'ta' then 'ta' else 'en' end
  )
  on conflict (id) do nothing;

  foreach v_purpose in array array['terms', 'privacy'] loop
    if new.raw_user_meta_data -> 'consents' ->> v_purpose = private.current_consent_version() then
      insert into public.consents (user_id, purpose, version) values (new.id, v_purpose, private.current_consent_version());
    end if;
  end loop;

  perform private.write_audit_as(new.id, 'auth.signup', null, 'user', new.id::text, '{}'::jsonb);
  return new;
end;
$$;

create function private.require_consent()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (
    select count(distinct c.purpose) from public.consents c
    where c.user_id = auth.uid() and c.withdrawn_at is null
      and c.purpose in ('terms', 'privacy') and c.version = private.current_consent_version()
  ) < 2 then
    perform private.raise_error('forbidden', 'consent_required');
  end if;
end;
$$;

create function public.grant_consent(p_purpose text, p_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if p_purpose not in ('terms', 'privacy') or p_version is distinct from private.current_consent_version() then
    perform private.raise_error('invalid', 'invalid_consent');
  end if;
  perform private.check_rate_limit('consent:' || auth.uid(), 20, interval '1 hour');
  if not exists (
    select 1 from public.consents c
    where c.user_id = auth.uid() and c.purpose = p_purpose and c.version = p_version and c.withdrawn_at is null
  ) then
    insert into public.consents (user_id, purpose, version) values (auth.uid(), p_purpose, p_version);
  end if;
end;
$$;

------------------------------------------------------------------------------------------------
-- RPC updates: consent gate (M1), inviter still entitled (M2), tighter email + send caps (M5), DB email (L2)
------------------------------------------------------------------------------------------------
create or replace function public.create_org(p_type public.org_type, p_name text)
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
  perform private.require_consent();
  if p_type not in ('business', 'buyer', 'partner') then
    perform private.raise_error('invalid', 'invalid_org_type');
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 160 or v_name ~ '[[:cntrl:]]' then
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

create or replace function public.create_invitation(p_org uuid, p_email text, p_role public.member_role)
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
    if private.role_rank(p_role) > private.role_rank(v_actor_role) then
      perform private.raise_error('forbidden', 'cannot_grant_above_own_role');
    end if;
  end if;

  -- Single plain address only: no commas, spaces, quotes or angle brackets.
  if char_length(v_email) > 254 or v_email !~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$' then
    perform private.raise_error('invalid', 'invalid_email');
  end if;
  perform private.check_rate_limit('invite:' || v_user, 20, interval '1 hour');
  perform private.check_rate_limit('invite_org:' || p_org, 50, interval '1 day');
  perform private.check_rate_limit('invite_to:' || encode(extensions.digest(v_email, 'sha256'), 'hex'), 3, interval '1 day');

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

create or replace function public.accept_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_inv public.invitations;
  v_existing public.memberships;
  v_org_status public.org_status;
  v_inviter_role public.member_role;
  v_org_type public.org_type;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  perform private.require_consent();
  perform private.check_rate_limit('accept:' || v_user, 10, interval '1 hour');

  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return private.invalid_invitation();
  end if;
  select * into v_inv from public.invitations i
  where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;

  -- The address on the account itself (not a possibly stale JWT claim) must match and be confirmed.
  select lower(u.email) into v_email from auth.users u
  where u.id = v_user and u.email_confirmed_at is not null and u.deleted_at is null;

  if v_inv.id is null or v_inv.accepted_at is not null or v_inv.revoked_at is not null
     or v_inv.expires_at < now() or v_email is null or lower(v_inv.email::text) <> v_email then
    return private.invalid_invitation();
  end if;
  select o.status, o.type into v_org_status, v_org_type from public.organisations o where o.id = v_inv.org_id;
  if v_org_status is distinct from 'active' then
    return private.invalid_invitation();
  end if;

  -- The inviter must still hold the authority they used (removed or demoted inviters void pending invitations).
  select m.role into v_inviter_role from public.memberships m
  where m.org_id = v_inv.org_id and m.user_id = v_inv.invited_by and m.status = 'active';
  if v_inviter_role is null
     or (v_org_type = 'mitra' and v_inviter_role <> 'admin_super')
     or (v_org_type <> 'mitra' and (
          v_inviter_role not in ('owner', 'manager')
          or private.role_rank(v_inv.role) > private.role_rank(v_inviter_role))) then
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

------------------------------------------------------------------------------------------------
-- M3: account-keyed throttle for login and MFA attempts (trusted server only)
------------------------------------------------------------------------------------------------
-- Returns false when the key has exceeded the limit. Never raises, so the attempt row always commits.
create function public.service_auth_attempt(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_key is null or char_length(p_key) not between 3 and 200
     or p_max not between 1 and 1000 or p_window_seconds not between 1 and 86400 then
    perform private.raise_error('invalid', 'invalid_throttle');
  end if;
  select count(*) into v_count from public.rate_limit_events
  where key = p_key and at > now() - make_interval(secs => p_window_seconds);
  insert into public.rate_limit_events (key) values (p_key);
  return v_count < p_max;
end;
$$;

------------------------------------------------------------------------------------------------
-- Grants (default privileges deny everything, so every new function is granted explicitly)
------------------------------------------------------------------------------------------------
-- PostgreSQL grants EXECUTE to PUBLIC on new functions unless revoked: do it explicitly for everything added here.
revoke all on function
  private.write_audit_as(uuid, text, uuid, text, text, jsonb, text),
  private.memberships_before_delete(),
  private.audit_auth_sessions(),
  private.audit_mfa_factors(),
  private.current_consent_version(),
  private.require_consent(),
  public.grant_consent(text, text),
  public.service_auth_attempt(text, integer, integer)
  from public, anon, authenticated, service_role;

grant execute on function public.grant_consent(text, text) to authenticated;
grant execute on function public.service_auth_attempt(text, integer, integer) to service_role;
grant execute on function private.current_consent_version() to authenticated;

------------------------------------------------------------------------------------------------
-- Review follow-ups D4 / D5: banned or deleted users also lose READ access; rename_org rejects control characters
------------------------------------------------------------------------------------------------
create or replace function private.is_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    join auth.users u on u.id = m.user_id and u.deleted_at is null and (u.banned_until is null or u.banned_until < now())
    where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active'
  )
$$;

create or replace function private.shares_org(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships a
    join auth.users u on u.id = a.user_id and u.deleted_at is null and (u.banned_until is null or u.banned_until < now())
    join public.memberships b on b.org_id = a.org_id
    where a.user_id = auth.uid() and a.status = 'active'
      and b.user_id = p_user and b.status = 'active'
  )
$$;

create or replace function public.rename_org(p_org uuid, p_name text)
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
  if char_length(v_name) < 2 or char_length(v_name) > 160 or v_name ~ '[[:cntrl:]]' then
    perform private.raise_error('invalid', 'invalid_name');
  end if;
  update public.organisations set name = v_name where id = p_org;
end;
$$;

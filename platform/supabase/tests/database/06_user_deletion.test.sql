-- Everything below runs inside one transaction that is rolled back: no data survives the test file.
-- Synthetic users only (@example.test). Helper schema "tt" lives only for this transaction.
begin;
create extension if not exists pgtap with schema extensions;

create schema tt;
grant usage on schema tt to public;

create table tt.u (name text primary key, id uuid not null default gen_random_uuid(), email text not null);
grant select on tt.u to public;

create function tt.mkuser(p_name text, p_confirmed boolean default true, p_consent boolean default true) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_email text := p_name || '@example.test';
begin
  insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_id, 'authenticated', 'authenticated', v_email, case when p_confirmed then now() end, '{}'::jsonb,
    case when p_consent then '{"consents":{"terms":"2026-07","privacy":"2026-07"}}'::jsonb else '{}'::jsonb end, now(), now());
  insert into tt.u (name, id, email) values (p_name, v_id, v_email);
  return v_id;
end $$;

create function tt.uid(p_name text) returns uuid language sql stable as $$ select id from tt.u where name = p_name $$;

-- Become an authenticated API user with a given aal (same GUCs PostgREST sets).
create function tt.act(p_name text, p_aal text default 'aal1') returns void
language plpgsql as $$
declare v tt.u;
begin
  reset role;
  select * into v from tt.u where name = p_name;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v.id, 'role', 'authenticated', 'email', v.email, 'aal', p_aal)::text, true);
  set local role authenticated;
end $$;

create function tt.anon() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
end $$;

create function tt.svc() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
end $$;

create function tt.pg() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Setup helpers (run as postgres).
create function tt.fresh_mitra() returns void language plpgsql as $$
begin
  perform tt.pg();
  delete from public.organisations where type = 'mitra';
  update private.bootstrap_state set completed_at = null, completed_user_id = null;
end $$;

create function tt.mkorg(p_type public.org_type, p_name text, p_owner text, p_role public.member_role default 'owner')
returns uuid language plpgsql as $$
declare v_org uuid;
begin
  perform tt.pg();
  insert into public.organisations (type, name, created_by) values (p_type, p_name, tt.uid(p_owner)) returning id into v_org;
  insert into public.memberships (org_id, user_id, role) values (v_org, tt.uid(p_owner), p_role);
  return v_org;
end $$;

create function tt.addm(p_org uuid, p_user text, p_role public.member_role) returns void language plpgsql as $$
begin
  perform tt.pg();
  insert into public.memberships (org_id, user_id, role) values (p_org, tt.uid(p_user), p_role);
end $$;

-- Org ids by label, usable from any role inside SQL strings.
create table tt.o (label text primary key, id uuid not null);
grant select on tt.o to public;
create function tt.oid(p_label text) returns uuid language sql stable as $$ select id from tt.o where label = p_label $$;
create function tt.reg(p_label text, p_id uuid) returns uuid language plpgsql as $$
begin
  insert into tt.o (label, id) values (p_label, p_id);
  return p_id;
end $$;

select plan(6);

create table tt.tok (label text primary key, token text not null);
grant select, insert on tt.tok to public;
create function tt.tk(p_label text) returns text language sql stable as $$ select token from tt.tok where label = p_label $$;
select tt.mkuser(n) from unnest(array['tt_creator','tt_coowner','tt_inviter','tt_invited']) n;
select tt.reg('A', tt.mkorg('business', 'Erasure Org', 'tt_creator'));
select tt.addm(tt.oid('A'), 'tt_coowner', 'owner');

-- Account deletion / erasure of an organisation's creator must work: organisations.created_by is ON DELETE SET NULL,
-- but the organisations_integrity trigger rejects every change to created_by (including to NULL).
select lives_ok($$ delete from auth.users where id = tt.uid('tt_creator') $$,
  'D3 deleting the auth user who created an organisation must succeed (created_by is set to NULL by the FK action)');
select is((select created_by from public.organisations where id = tt.oid('A')), null,
  'D3 after user deletion the organisation keeps existing with created_by NULL');
select is((select count(*)::int from public.memberships where user_id = tt.uid('tt_creator')), 0,
  'D3 the deleted user''s memberships are gone');

-- other FK actions to auth.users work (invited_by / accepted_by are SET NULL on invitations)
select tt.act('tt_coowner');
insert into tt.tok select 'x', (public.create_invitation(tt.oid('A'), 'tt_invited@example.test', 'viewer') ->> 'token');
select tt.act('tt_invited');
select public.accept_invitation(tt.tk('x'));
select tt.pg();
select lives_ok($$ delete from auth.users where id = tt.uid('tt_invited') $$, 'S9.1 deleting an invited/accepting user works (invitations.accepted_by set null)');
select lives_ok($$ delete from auth.users where id = tt.uid('tt_coowner') $$, 'S9.2 deleting the last owner user removes the user and membership (cascade)');
select is((select count(*)::int from public.audit_log where org_id = tt.oid('A')) > 0, true, 'S9.3 audit history survives user deletion');

select * from finish();
rollback;

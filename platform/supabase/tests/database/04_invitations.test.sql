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

select plan(40);

create table tt.tok (label text primary key, token text not null);
grant select, insert on tt.tok to public;
create function tt.tk(p_label text) returns text language sql stable as $$ select token from tt.tok where label = p_label $$;

select tt.fresh_mitra();
select tt.mkuser(n) from unnest(array['tt_owner','tt_invitee','tt_other','tt_exp','tt_rev','tt_susp','tt_rl','tt_reinv','tt_member']) n;
select tt.mkuser('tt_unconf', false);
select tt.reg('A', tt.mkorg('business', 'Invite Org A', 'tt_owner'));
select tt.addm(tt.oid('A'), 'tt_member', 'viewer');

-- ---------------------------------- creation and storage ----------------------------------
select tt.act('tt_owner');
insert into tt.tok select 'inv', (public.create_invitation(tt.oid('A'), 'TT_Invitee@Example.Test', 'staff') ->> 'token');
select tt.pg();
select matches(tt.tk('inv'), '^[0-9a-f]{64}$', 'S5.1 token is 64 hex chars (256 bits)');
select is((select count(*)::int from public.invitations where token_hash = tt.tk('inv')), 0, 'S5.2 the raw token is not equal to any stored token_hash');
select is((select token_hash from public.invitations where email = 'tt_invitee@example.test'),
  encode(extensions.digest(tt.tk('inv'), 'sha256'), 'hex'), 'S5.3 token_hash is the SHA-256 of the token');
select is((select count(*)::int from public.invitations i where i::text like '%' || tt.tk('inv') || '%'), 0,
  'S5.4 the raw token appears in no column of the invitations table');
select is((select count(*)::int from public.audit_log a where a::text like '%' || tt.tk('inv') || '%'), 0,
  'S5.5 the raw token appears nowhere in audit_log');
select is((select email::text from public.invitations where token_hash = encode(extensions.digest(tt.tk('inv'), 'sha256'), 'hex')),
  'tt_invitee@example.test', 'S5.6 invitation email is normalised to lower case');

select tt.act('tt_owner');
select throws_ok($$ select token_hash from public.invitations $$, '42501', null, 'S5.7 org owner cannot select token_hash');
select throws_ok($$ select * from public.invitations $$, '42501', null, 'S5.8 select * on invitations fails for authenticated (token_hash is not granted)');
select lives_ok($$ select id, email, role, expires_at from public.invitations $$, 'S5.9 non-secret invitation columns are readable by the org owner');
select throws_ok($$ select public.create_invitation(tt.oid('A'), 'tt_member@example.test', 'viewer') $$, 'PT409', 'already_member', 'S5.10 inviting an existing member => already_member');
select throws_ok($$ select public.create_invitation(tt.oid('A'), 'not-an-email', 'viewer') $$, 'PT422', 'invalid_email', 'S5.11 malformed email rejected');

-- ----------------------------------- failure modes (all generic) -----------------------------------
select tt.act('tt_other');
select is(public.accept_invitation(tt.tk('inv')), '{"code":"PT404","message":"invalid_invitation"}'::jsonb, 'S5.12 email-bound: another user with a different email gets generic invalid_invitation');
select is(public.accept_invitation(null), '{"code":"PT404","message":"invalid_invitation"}'::jsonb, 'S5.13 NULL token => invalid_invitation');
select is(public.accept_invitation('not-a-token'), '{"code":"PT404","message":"invalid_invitation"}'::jsonb, 'S5.14 malformed token => invalid_invitation');
select is(public.accept_invitation(repeat('0', 64)), '{"code":"PT404","message":"invalid_invitation"}'::jsonb, 'S5.15 well-formed but unknown token => invalid_invitation');
select is(public.accept_invitation(upper(tt.tk('inv'))), '{"code":"PT404","message":"invalid_invitation"}'::jsonb, 'S5.16 upper-case variant of a real token => invalid_invitation');
select is(public.accept_invitation(tt.tk('inv') || ' '), '{"code":"PT404","message":"invalid_invitation"}'::jsonb, 'S5.17 token with trailing space => invalid_invitation');

-- expired
select tt.act('tt_owner');
insert into tt.tok select 'exp', (public.create_invitation(tt.oid('A'), 'tt_exp@example.test', 'viewer') ->> 'token');
select tt.pg();
update public.invitations set expires_at = now() - interval '1 second' where email = 'tt_exp@example.test';
select tt.act('tt_exp');
select is(public.accept_invitation(tt.tk('exp')), '{"code":"PT404","message":"invalid_invitation"}'::jsonb, 'S5.18 expired token fails with the same generic error');

-- revoked
select tt.act('tt_owner');
insert into tt.tok select 'rev', (public.create_invitation(tt.oid('A'), 'tt_rev@example.test', 'viewer') ->> 'token');
select lives_ok($$ select public.revoke_invitation((select id from public.invitations where email = 'tt_rev@example.test' and revoked_at is null)) $$, 'S5.19 owner revokes a pending invitation');
select throws_ok($$ select public.revoke_invitation((select id from public.invitations where email = 'tt_rev@example.test')) $$, 'PT409', 'invitation_not_pending', 'S5.20 revoking twice => invitation_not_pending');
select tt.act('tt_rev');
select is(public.accept_invitation(tt.tk('rev')), '{"code":"PT404","message":"invalid_invitation"}'::jsonb, 'S5.21 revoked token fails with the same generic error');

-- unconfirmed email
select tt.act('tt_owner');
insert into tt.tok select 'unconf', (public.create_invitation(tt.oid('A'), 'tt_unconf@example.test', 'viewer') ->> 'token');
select tt.act('tt_unconf');
select is(public.accept_invitation(tt.tk('unconf')), '{"code":"PT404","message":"invalid_invitation"}'::jsonb, 'S5.22 user whose email is not confirmed cannot accept (generic error)');

-- suspended organisation
select tt.act('tt_owner');
insert into tt.tok select 'susp', (public.create_invitation(tt.oid('A'), 'tt_susp@example.test', 'viewer') ->> 'token');
select tt.pg();
update public.organisations set status = 'suspended' where id = tt.oid('A');
select tt.act('tt_susp');
select is(public.accept_invitation(tt.tk('susp')), '{"code":"PT404","message":"invalid_invitation"}'::jsonb, 'S5.23 invitation into a suspended organisation fails generically');
select tt.pg();
update public.organisations set status = 'active' where id = tt.oid('A');

-- anon
select tt.anon();
select throws_ok($$ select public.accept_invitation(tt.tk('inv')) $$, '42501', null, 'S5.24 anon cannot call accept_invitation');

-- ----------------------------------- success and single use -----------------------------------
select tt.act('tt_invitee');
select is((public.accept_invitation(tt.tk('inv')) ->> 'role'), 'staff', 'S5.25 the invited user accepts and receives the invited role');
select is((select count(*)::int from public.organisations where id = tt.oid('A')), 1, 'S5.26 right after accepting, the new member sees the organisation');
select is(public.accept_invitation(tt.tk('inv')), '{"code":"PT404","message":"invalid_invitation"}'::jsonb, 'S5.27 single use: the same token cannot be accepted twice');
select tt.pg();
select is((select role::text from public.memberships where org_id = tt.oid('A') and user_id = tt.uid('tt_invitee')), 'staff', 'S5.28 membership exists with the invited role');
select isnt((select accepted_at from public.invitations where email = 'tt_invitee@example.test'), null, 'S5.29 invitation marked accepted');
select is((select accepted_by from public.invitations where email = 'tt_invitee@example.test'), tt.uid('tt_invitee'), 'S5.30 accepted_by is the verified caller');

-- re-invite replaces the previous pending invitation (old token dies)
select tt.act('tt_owner');
insert into tt.tok select 'reinv1', (public.create_invitation(tt.oid('A'), 'tt_reinv@example.test', 'viewer') ->> 'token');
insert into tt.tok select 'reinv2', (public.create_invitation(tt.oid('A'), 'tt_reinv@example.test', 'staff') ->> 'token');
select tt.act('tt_reinv');
select is(public.accept_invitation(tt.tk('reinv1')), '{"code":"PT404","message":"invalid_invitation"}'::jsonb, 'S5.31 a superseded invitation token no longer works');
select is((public.accept_invitation(tt.tk('reinv2')) ->> 'role'), 'staff', 'S5.32 the newest invitation token works');

-- invitee cannot become admin by accepting an admin invitation addressed to someone else
select tt.pg();
select tt.mkuser('tt_adm');
select tt.reg('M', tt.mkorg('mitra', 'Invite MITRA', 'tt_adm', 'admin_super'));
select tt.act('tt_adm', 'aal2');
insert into tt.tok select 'admtok', (public.create_invitation(tt.oid('M'), 'tt_target@example.test', 'admin_ops') ->> 'token');
select tt.act('tt_other');
select is(public.accept_invitation(tt.tk('admtok')), '{"code":"PT404","message":"invalid_invitation"}'::jsonb, 'S5.33 a normal user cannot accept an admin invitation addressed to another email');
select tt.act('tt_adm', 'aal1');
select throws_ok($$ select public.create_invitation(tt.oid('M'), 'tt_target2@example.test', 'admin_ops') $$, 'PT403', null, 'S5.34 creating an admin invitation at aal1 is denied');
select tt.pg();
select is((select count(*)::int from public.invitations where accepted_at is not null and accepted_by is not null and email in ('tt_exp@example.test','tt_rev@example.test','tt_unconf@example.test','tt_susp@example.test')), 0, 'S5.34b failed accepts (expired, revoked, unconfirmed, suspended org) changed no invitation (accepted_at stays NULL)');
select is((select count(*)::int from public.memberships where user_id in (tt.uid('tt_exp'), tt.uid('tt_rev'), tt.uid('tt_unconf'), tt.uid('tt_susp'), tt.uid('tt_reinv')) and org_id = tt.oid('A') and role = 'viewer' and user_id <> tt.uid('tt_reinv')), 0, 'S5.34c failed accepts created no membership');
select is((select count(*)::int from public.memberships where user_id = tt.uid('tt_other')), 0, 'S5.35 tt_other holds no membership after all attempts');

-- ----------------------------------- rate limit -----------------------------------
-- 10 successful accepts in an hour are allowed, the 11th is PT429. (Each org has a pre-seeded invitation with a known token.)
select tt.pg();
create function tt.seed_rl() returns void language plpgsql as $$
declare v_org uuid; v_i int;
begin
  for v_i in 1..11 loop
    v_org := tt.mkorg('business', 'RL Org ' || v_i, 'tt_owner');
    insert into public.invitations (org_id, email, role, token_hash, expires_at, invited_by)
    values (v_org, 'tt_rl@example.test', 'viewer', encode(extensions.digest(lpad(v_i::text, 64, '0'), 'sha256'), 'hex'), now() + interval '1 day', tt.uid('tt_owner'));
  end loop;
end $$;
select tt.seed_rl();
select tt.act('tt_rl');
select lives_ok($$ select public.accept_invitation(lpad(g::text, 64, '0')) from generate_series(1, 10) g $$, 'S5.36 ten valid accept attempts in an hour succeed');
select throws_ok($$ select public.accept_invitation(lpad('11', 64, '0')) $$, 'PT429', null, 'S5.37 the 11th accept attempt in an hour => PT429');

-- Failed attempts must count too, otherwise the limiter does not slow token guessing.
select tt.pg();
delete from public.rate_limit_events;
create function tt.guess(p_n int) returns text language plpgsql as $$
declare v_i int; v_last text := 'none';
begin
  for v_i in 1..p_n loop
    begin
      perform public.accept_invitation(repeat('a', 63) || to_hex(v_i % 16));
    exception when others then
      v_last := sqlstate;
    end;
  end loop;
  return v_last;
end $$;
select tt.act('tt_other');
select is(tt.guess(11), 'PT429',
  'S5.38 failed (invalid-token) accept attempts count toward the rate limit: the 11th bad guess in an hour => PT429');

select tt.pg();
select * from finish();
rollback;

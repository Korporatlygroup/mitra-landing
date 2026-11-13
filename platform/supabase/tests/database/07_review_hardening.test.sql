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

select plan(84);

create table tt.tok (label text primary key, token text not null);
grant select, insert on tt.tok to public;
create function tt.tk(p_label text) returns text language sql stable as $$ select token from tt.tok where label = p_label $$;

-- Act as a user whose JWT email claim differs from the account email (stale / forged claim).
create function tt.act_claims(p_name text, p_email_claim text, p_aal text default 'aal1') returns void language plpgsql as $$
declare v tt.u;
begin
  reset role;
  select * into v from tt.u where name = p_name;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v.id, 'role', 'authenticated', 'email', p_email_claim, 'aal', p_aal)::text, true);
  set local role authenticated;
end $$;

select tt.fresh_mitra();
select tt.mkuser(n) from unnest(array[
  'tt_o','tt_m','tt_m2','tt_i1','tt_i2','tt_i3','tt_s1','tt_s2','tt_a1','tt_a2','tt_nc','tt_ban','tt_del','tt_att','tt_vic',
  'tt_sole','tt_x1','tt_inv_ok','tt_cap1']) n;
select tt.mkuser('tt_nocons', true, false);
select tt.reg('A', tt.mkorg('business', 'Hardening Org A', 'tt_o'));
select tt.addm(tt.oid('A'), 'tt_m', 'manager');
select tt.addm(tt.oid('A'), 'tt_m2', 'manager');
select tt.reg('M', tt.mkorg('mitra', 'Hardening MITRA', 'tt_s1', 'admin_super'));
select tt.addm(tt.oid('M'), 'tt_s2', 'admin_super');

-- ============================ M1: consent gate ============================
select tt.act('tt_nocons');
select throws_ok($$ select public.create_org('business', 'Needs Consent Org') $$, 'PT403', 'consent_required', 'M1.1 create_org without current consents => PT403 consent_required');
select tt.act('tt_o');
insert into tt.tok select 'nocons', (public.create_invitation(tt.oid('A'), 'tt_nocons@example.test', 'viewer') ->> 'token');
select tt.act('tt_nocons');
select throws_ok($$ select public.accept_invitation(tt.tk('nocons')) $$, 'PT403', 'consent_required', 'M1.2 accept_invitation without current consents => PT403 consent_required');
select throws_ok($$ select public.grant_consent('terms', '1999-01') $$, 'PT422', 'invalid_consent', 'M1.3 grant_consent rejects an outdated version');
select throws_ok($$ select public.grant_consent('marketing', '2026-07') $$, 'PT422', 'invalid_consent', 'M1.4 grant_consent rejects an unknown purpose');
select lives_ok($$ select public.grant_consent('terms', '2026-07') $$, 'M1.5 grant_consent(terms, current) works');
select lives_ok($$ select public.grant_consent('terms', '2026-07') $$, 'M1.6 grant_consent is idempotent (no error on repeat)');
select throws_ok($$ select public.create_org('business', 'Half Consent Org') $$, 'PT403', 'consent_required', 'M1.7 terms alone are not enough: privacy is also required');
select lives_ok($$ select public.grant_consent('privacy', '2026-07') $$, 'M1.8 grant_consent(privacy, current) works');
select is((select count(*)::int from public.consents where user_id = tt.uid('tt_nocons') and purpose = 'terms'), 1, 'M1.9 repeated grant_consent created exactly one terms row');
select lives_ok($$ select public.create_org('business', 'Consented Org') $$, 'M1.10 after granting both current consents create_org works');
select lives_ok($$ select public.accept_invitation(tt.tk('nocons')) $$, 'M1.11 and accept_invitation works');
select tt.pg();
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values (gen_random_uuid(), 'authenticated', 'authenticated', 'tt_bogus@example.test', now(),
  '{"consents":{"terms":"1999-01","privacy":"1999-01"}}'::jsonb, now(), now());
select is((select count(*)::int from public.consents c join auth.users u on u.id = c.user_id where u.email = 'tt_bogus@example.test'), 0, 'M1.12 sign-up with a bogus consent version records no consent row');
select is((select count(*)::int from public.consents c where c.user_id = tt.uid('tt_o') and c.version = '2026-07'), 2, 'M1.13 sign-up with the current version records both consent rows');
select tt.act('tt_o');
select lives_ok($$ select public.withdraw_consent((select id from public.consents where user_id = tt.uid('tt_o') and purpose = 'terms')) $$, 'M1.14 user withdraws terms consent');
select throws_ok($$ select public.create_org('business', 'After Withdrawal') $$, 'PT403', 'consent_required', 'M1.15 a withdrawn consent blocks create_org again');
select tt.pg();
update public.consents set withdrawn_at = null where user_id = tt.uid('tt_o');

-- ============================ M2: inviter must still be entitled ============================
select tt.act('tt_m');
insert into tt.tok select 'i1', (public.create_invitation(tt.oid('A'), 'tt_i1@example.test', 'viewer') ->> 'token');
select tt.act('tt_m2');
insert into tt.tok select 'i2', (public.create_invitation(tt.oid('A'), 'tt_i2@example.test', 'viewer') ->> 'token');
select tt.act('tt_o');
insert into tt.tok select 'i3', (public.create_invitation(tt.oid('A'), 'tt_i3@example.test', 'viewer') ->> 'token');
select tt.pg();
update public.memberships set status = 'removed', removed_at = now() where org_id = tt.oid('A') and user_id = tt.uid('tt_m');
update public.memberships set role = 'staff' where org_id = tt.oid('A') and user_id = tt.uid('tt_m2');
select tt.act('tt_i1');
select is(public.accept_invitation(tt.tk('i1')), '{"code":"PT404","message":"invalid_invitation"}'::jsonb, 'M2.1 invitation from a REMOVED inviter is invalid (generic body)');
select tt.act('tt_i2');
select is(public.accept_invitation(tt.tk('i2')), '{"code":"PT404","message":"invalid_invitation"}'::jsonb, 'M2.2 invitation from an inviter DEMOTED below manager is invalid');
select tt.act('tt_i3');
select is(public.accept_invitation(tt.tk('i3')) ->> 'role', 'viewer', 'M2.3 control: an invitation from a still-entitled owner is accepted');
select tt.pg();
select is((select count(*)::int from public.memberships where user_id in (tt.uid('tt_i1'), tt.uid('tt_i2'))), 0, 'M2.4 the invitees of removed/demoted inviters got no membership');
select is((select count(*)::int from public.invitations where email in ('tt_i1@example.test', 'tt_i2@example.test') and accepted_at is not null), 0, 'M2.5 and those invitations were not marked accepted');

select tt.act('tt_s1', 'aal2');
insert into tt.tok select 'a1', (public.create_invitation(tt.oid('M'), 'tt_a1@example.test', 'admin_review') ->> 'token');
select tt.act('tt_s2', 'aal2');
insert into tt.tok select 'a2', (public.create_invitation(tt.oid('M'), 'tt_a2@example.test', 'admin_content') ->> 'token');
select tt.pg();
update public.memberships set role = 'admin_ops' where org_id = tt.oid('M') and user_id = tt.uid('tt_s1');
select tt.act('tt_a1');
select is(public.accept_invitation(tt.tk('a1')), '{"code":"PT404","message":"invalid_invitation"}'::jsonb, 'M2.6 mitra invitation from an inviter who is no longer admin_super is invalid');
select tt.act('tt_a2');
select is(public.accept_invitation(tt.tk('a2')) ->> 'role', 'admin_content', 'M2.7 control: mitra invitation from a current admin_super is accepted');
select tt.pg();
select is((select count(*)::int from public.memberships where user_id = tt.uid('tt_a1')), 0, 'M2.8 no admin membership was created for the voided mitra invitation');

-- ============================ L2: acceptance uses auth.users.email ============================
select tt.act('tt_o');
insert into tt.tok select 'att', (public.create_invitation(tt.oid('A'), 'tt_vic@example.test', 'viewer') ->> 'token');
-- the attacker's account is tt_att@example.test but the (forged / stale) JWT claim says the victim's address
select tt.act_claims('tt_att', 'tt_vic@example.test');
select is(public.accept_invitation(tt.tk('att')), '{"code":"PT404","message":"invalid_invitation"}'::jsonb, 'L2.1 a JWT email claim equal to the invitation address does not help if the account email differs');
-- the real invitee holds a JWT whose claim is stale/different, but the account email matches
select tt.act_claims('tt_vic', 'old-address@example.test');
select is(public.accept_invitation(tt.tk('att')) ->> 'role', 'viewer', 'L2.2 the account email decides: the real invitee succeeds even with a different email claim');

-- ============================ L4: banned / soft-deleted users ============================
select tt.act('tt_o', 'aal2');
select is(private.has_permission(tt.oid('A'), 'org:manage'), true, 'L4.1 control: active owner has permission');
select tt.pg();
update auth.users set banned_until = now() + interval '1 day' where id = tt.uid('tt_o');
select tt.act('tt_o', 'aal2');
select is(private.has_permission(tt.oid('A'), 'org:manage'), false, 'L4.2 banned user: has_permission false immediately with a still-valid JWT');
select throws_ok($$ select public.rename_org(tt.oid('A'), 'Banned Rename') $$, 'PT403', null, 'L4.3 banned user: RPCs fail with PT403');
select is((select count(*)::int from public.organisations), 0, 'L4.4 DEFECT D4: banned user reads no organisations through RLS');
select tt.pg();
update auth.users set banned_until = now() - interval '1 minute' where id = tt.uid('tt_o');
select tt.act('tt_o', 'aal2');
select is(private.has_permission(tt.oid('A'), 'org:manage'), true, 'L4.5 an expired ban restores access');
select tt.pg();
update auth.users set deleted_at = now() where id = tt.uid('tt_o');
select tt.act('tt_o', 'aal2');
select is(private.has_permission(tt.oid('A'), 'org:manage'), false, 'L4.6 soft-deleted user: has_permission false immediately');
select is((select count(*)::int from public.organisations), 0, 'L4.7 DEFECT D4: soft-deleted user reads no organisations through RLS');
select tt.pg();
update auth.users set deleted_at = null where id = tt.uid('tt_o');

-- ============================ M3: service_auth_attempt ============================
select tt.svc();
select is((select public.service_auth_attempt('login:tt_throttle@example.test', 3, 60)), true, 'M3.1 attempt 1 allowed');
select is((select public.service_auth_attempt('login:tt_throttle@example.test', 3, 60)), true, 'M3.2 attempt 2 allowed');
select is((select public.service_auth_attempt('login:tt_throttle@example.test', 3, 60)), true, 'M3.3 attempt 3 allowed');
select is((select public.service_auth_attempt('login:tt_throttle@example.test', 3, 60)), false, 'M3.4 attempt 4 refused (returns false, does not raise)');
select is((select public.service_auth_attempt('login:tt_throttle@example.test', 3, 60)), false, 'M3.5 attempt 5 still refused');
select is((select public.service_auth_attempt('login:tt_other@example.test', 3, 60)), true, 'M3.6 the limit is per key');
select tt.pg();
select is((select count(*)::int from public.rate_limit_events where key = 'login:tt_throttle@example.test'), 5, 'M3.7 every attempt row (including refused ones) was recorded');
select tt.svc();
select throws_ok($$ select public.service_auth_attempt('a', 3, 60) $$, 'PT422', 'invalid_throttle', 'M3.8 key too short rejected');
select throws_ok($$ select public.service_auth_attempt(null, 3, 60) $$, 'PT422', 'invalid_throttle', 'M3.9 NULL key rejected');
select throws_ok($$ select public.service_auth_attempt('login:x@example.test', 0, 60) $$, 'PT422', 'invalid_throttle', 'M3.10 max 0 rejected');
select throws_ok($$ select public.service_auth_attempt('login:x@example.test', 3, 0) $$, 'PT422', 'invalid_throttle', 'M3.11 window 0 rejected');
select throws_ok($$ select public.service_auth_attempt('login:x@example.test', 3, 999999) $$, 'PT422', 'invalid_throttle', 'M3.12 oversize window rejected');
select tt.act('tt_x1');
select throws_ok($$ select public.service_auth_attempt('login:x@example.test', 3, 60) $$, '42501', null, 'M3.13 authenticated cannot call service_auth_attempt');
select tt.anon();
select throws_ok($$ select public.service_auth_attempt('login:x@example.test', 3, 60) $$, '42501', null, 'M3.14 anon cannot call service_auth_attempt');

-- ============================ M5: invitation input and send caps ============================
select tt.act('tt_o');
select throws_ok($$ select public.create_invitation(tt.oid('A'), 'a@example.test,b@example.test', 'viewer') $$, 'PT422', 'invalid_email', 'M5.1 comma-separated list rejected');
select throws_ok($$ select public.create_invitation(tt.oid('A'), 'a b@example.test', 'viewer') $$, 'PT422', 'invalid_email', 'M5.2 space rejected');
select throws_ok($$ select public.create_invitation(tt.oid('A'), '<a@example.test>', 'viewer') $$, 'PT422', 'invalid_email', 'M5.3 angle brackets rejected');
select throws_ok($$ select public.create_invitation(tt.oid('A'), '"a"@example.test', 'viewer') $$, 'PT422', 'invalid_email', 'M5.4 quotes rejected');
select throws_ok($$ select public.create_invitation(tt.oid('A'), E'a@example.test\nBcc: x@example.test', 'viewer') $$, 'PT422', 'invalid_email', 'M5.5 header-injection newline rejected');
select throws_ok($$ select public.create_invitation(tt.oid('A'), 'a@b', 'viewer') $$, 'PT422', 'invalid_email', 'M5.6 address without a dotted domain rejected');
select lives_ok($$ select public.create_invitation(tt.oid('A'), 'tt_cap_rcpt@example.test', 'viewer') $$, 'M5.7 recipient invite 1/3');
select lives_ok($$ select public.create_invitation(tt.oid('A'), 'TT_cap_rcpt@example.test', 'viewer') $$, 'M5.8 recipient invite 2/3 (case-insensitive address)');
select lives_ok($$ select public.create_invitation(tt.oid('A'), 'tt_cap_rcpt@example.test', 'staff') $$, 'M5.9 recipient invite 3/3');
select throws_ok($$ select public.create_invitation(tt.oid('A'), 'tt_cap_rcpt@example.test', 'viewer') $$, 'PT429', null, 'M5.10 4th invitation to the same recipient in a day => PT429');
select tt.pg();
insert into public.rate_limit_events (key) select 'invite_org:' || tt.oid('A') from generate_series(1, 50);
select tt.act('tt_o');
select throws_ok($$ select public.create_invitation(tt.oid('A'), 'tt_cap_org@example.test', 'viewer') $$, 'PT429', null, 'M5.11 per-organisation cap of 50 invitations a day => PT429');
select throws_ok($$ select public.create_org('business', E'Bad\x01Name') $$, 'PT422', 'invalid_name', 'M5.12 org name with a control character rejected');
select throws_ok($$ select public.create_org('business', E'Bad\nName') $$, 'PT422', 'invalid_name', 'M5.13 org name with a newline rejected');
select throws_ok($$ select public.create_org('business', E'Bad\tName') $$, 'PT422', 'invalid_name', 'M5.14 org name with a tab rejected');
select throws_ok($$ select public.rename_org(tt.oid('A'), E'Rename\x07') $$, 'PT422', 'invalid_name', 'M5.15 DEFECT D5: rename_org with a control character rejected');

-- ============================ H2: auth events come from DB triggers ============================
select tt.pg();
select is((select count(*)::int from public.audit_log where action = 'auth.signup' and actor_user_id = tt.uid('tt_x1')), 1, 'H2.1 creating a user writes auth.signup (actor = the new user)');
insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (gen_random_uuid(), tt.uid('tt_x1'), now(), now(), 'aal1');
select is((select count(*)::int from public.audit_log where action = 'auth.login' and actor_user_id = tt.uid('tt_x1') and source = 'db'), 1, 'H2.2 a new auth session writes auth.login for that user, with no application call');
update auth.sessions set aal = 'aal2' where user_id = tt.uid('tt_x1');
select is((select count(*)::int from public.audit_log where action = 'auth.mfa_verified' and actor_user_id = tt.uid('tt_x1')), 1, 'H2.3 an aal1 -> aal2 session upgrade writes auth.mfa_verified');
update auth.sessions set updated_at = now() where user_id = tt.uid('tt_x1');
select is((select count(*)::int from public.audit_log where action in ('auth.login', 'auth.mfa_verified') and actor_user_id = tt.uid('tt_x1')), 2, 'H2.4 other session updates write nothing');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  values (gen_random_uuid(), tt.uid('tt_x1'), 'tt-f1', 'totp', 'unverified', now(), now());
select is((select count(*)::int from public.audit_log where action = 'auth.mfa_enrolled' and actor_user_id = tt.uid('tt_x1')), 0, 'H2.5 an unverified factor writes nothing');
update auth.mfa_factors set status = 'verified' where user_id = tt.uid('tt_x1');
select is((select count(*)::int from public.audit_log where action = 'auth.mfa_enrolled' and actor_user_id = tt.uid('tt_x1')), 1, 'H2.6 verifying a factor writes auth.mfa_enrolled');
delete from auth.mfa_factors where user_id = tt.uid('tt_x1');
select is((select count(*)::int from public.audit_log where action = 'auth.mfa_unenrolled' and actor_user_id = tt.uid('tt_x1')), 1, 'H2.7 removing a verified factor writes auth.mfa_unenrolled');
select tt.svc();
select throws_ok($$ select public.service_record_auth_event(tt.uid('tt_x1'), 'auth.login') $$, 'PT422', 'unknown_action', 'H2.8 the application can no longer record auth.login');
select throws_ok($$ select public.service_record_auth_event(tt.uid('tt_x1'), 'auth.mfa_verified') $$, 'PT422', 'unknown_action', 'H2.9 nor auth.mfa_verified');
select throws_ok($$ select public.service_record_auth_event(tt.uid('tt_x1'), 'auth.mfa_enrolled') $$, 'PT422', 'unknown_action', 'H2.10 nor auth.mfa_enrolled');
select throws_ok($$ select public.service_record_auth_event(tt.uid('tt_x1'), 'auth.signup') $$, 'PT422', 'unknown_action', 'H2.11 nor auth.signup');
select lives_ok($$ select public.service_record_auth_event(tt.uid('tt_x1'), 'auth.password_changed') $$, 'H2.12 auth.password_changed is still accepted');
select lives_ok($$ select public.service_record_auth_event(tt.uid('tt_x1'), 'auth.logout') $$, 'H2.13 auth.logout is still accepted');

-- ============================ M4: deletion guards and audit ============================
select tt.pg();
select throws_ok($$ delete from auth.users where id = tt.uid('tt_s2') $$, 'PT409', 'last_owner', 'M4.1 deleting the auth user of the LAST admin_super is blocked');
select is((select count(*)::int from public.memberships where user_id = tt.uid('tt_s2') and status = 'active'), 1, 'M4.2 the admin_super membership is intact after the blocked deletion');
select throws_ok($$ delete from public.memberships where org_id = tt.oid('M') and user_id = tt.uid('tt_s2') $$, 'PT409', 'last_owner', 'M4.3 direct DELETE of the last admin_super membership is blocked too');
update public.memberships set role = 'admin_super' where org_id = tt.oid('M') and user_id = tt.uid('tt_s1');
select lives_ok($$ delete from auth.users where id = tt.uid('tt_s2') $$, 'M4.4 with a second admin_super present the first can be deleted');
select tt.reg('S', tt.mkorg('business', 'Sole Owner Org', 'tt_sole'));
select lives_ok($$ delete from auth.users where id = tt.uid('tt_sole') $$, 'M4.5 deleting the sole owner of an ordinary organisation succeeds');
select is((select count(*)::int from public.audit_log where action = 'membership.deleted' and org_id = tt.oid('S') and actor_user_id is null and not (details ? 'user_id')), 1, 'M4.6 the deletion retained a redacted membership.deleted audit row');
select is((select count(*)::int from public.organisations where id = tt.oid('S')), 1, 'M4.7 the organisation survives (ownerless) after its sole owner is deleted');
select tt.reg('C', tt.mkorg('business', 'Cascade Org', 'tt_del'));
select tt.addm(tt.oid('C'), 'tt_cap1', 'manager');
select lives_ok($$ delete from public.organisations where id = tt.oid('C') $$, 'M4.8 deleting a whole organisation still cascades');
select is((select count(*)::int from public.memberships where org_id = tt.oid('C')), 0, 'M4.9 memberships of the deleted organisation are gone');
select is((select count(*)::int from public.audit_log where action = 'membership.deleted' and org_id = tt.oid('C')), 0, 'M4.10 an organisation cascade does not write per-member membership.deleted rows');

select tt.pg();
select * from finish();
rollback;

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

select plan(96);

select tt.fresh_mitra();
select tt.mkuser(n) from unnest(array[
  'tt_a_owner','tt_a_manager','tt_a_staff','tt_a_viewer','tt_a_owner2','tt_b_owner','tt_b_manager','tt_outsider',
  'tt_adm_super','tt_adm_super2','tt_cap']) n;
select tt.reg('A', tt.mkorg('business', 'Iso Org A', 'tt_a_owner'));
select tt.addm(tt.oid('A'), 'tt_a_manager', 'manager');
select tt.addm(tt.oid('A'), 'tt_a_staff', 'staff');
select tt.addm(tt.oid('A'), 'tt_a_viewer', 'viewer');
select tt.reg('B', tt.mkorg('business', 'Iso Org B', 'tt_b_owner'));
select tt.addm(tt.oid('B'), 'tt_b_manager', 'manager');
select tt.reg('M', tt.mkorg('mitra', 'Iso MITRA', 'tt_adm_super', 'admin_super'));

select tt.act('tt_b_owner');
select public.create_invitation(tt.oid('B'), 'tt_inv_b@example.test', 'viewer');
select tt.pg();
select tt.reg('invB', (select id from public.invitations where org_id = tt.oid('B') limit 1));

-- ================= S2: tenant isolation (user in org A vs org B) =================
select tt.act('tt_a_owner');
select is((select count(*)::int from public.organisations where id = tt.oid('B')), 0, 'S2.1 org A owner cannot select org B from organisations');
select is((select count(*)::int from public.organisations where id = tt.oid('A')), 1, 'S2.2 org A owner can select own organisation');
select is((select count(*)::int from public.memberships where org_id = tt.oid('B')), 0, 'S2.3 cannot select org B memberships');
select is((select count(*)::int from public.invitations where org_id = tt.oid('B')), 0, 'S2.4 cannot select org B invitations');
select is((select count(*)::int from public.audit_log where org_id = tt.oid('B')), 0, 'S2.5 cannot select org B audit_log rows');
select is((select count(*)::int from public.profiles where id = tt.uid('tt_b_owner')), 0, 'S2.6 cannot select profile of a user who shares no org');
select throws_ok($$ insert into public.memberships (org_id, user_id, role) values (tt.oid('B'), tt.uid('tt_a_owner'), 'owner') $$, '42501', null,
  'S2.7 cannot INSERT a membership into org B');
select throws_ok($$ insert into public.invitations (org_id, email, role, token_hash, expires_at) values (tt.oid('B'), 'x@example.test', 'owner', 'h', now() + interval '1 day') $$, '42501', null,
  'S2.8 cannot INSERT an invitation into org B');
select throws_ok($$ update public.organisations set name = 'pwned' where id = tt.oid('B') $$, '42501', null, 'S2.9 cannot UPDATE org B');
select throws_ok($$ delete from public.memberships where org_id = tt.oid('B') $$, '42501', null, 'S2.10 cannot DELETE org B memberships');
select throws_ok($$ delete from public.audit_log where org_id = tt.oid('B') $$, '42501', null, 'S2.11 cannot DELETE org B audit rows');
select throws_ok($$ select public.create_invitation(tt.oid('B'), 'x@example.test', 'viewer') $$, 'PT403', null, 'S2.12 create_invitation against org B => PT403');
select throws_ok($$ select public.remove_member(tt.oid('B'), tt.uid('tt_b_manager')) $$, 'PT403', null, 'S2.13 remove_member against org B => PT403');
select throws_ok($$ select public.set_member_role(tt.oid('B'), tt.uid('tt_b_manager'), 'viewer') $$, 'PT403', null, 'S2.14 set_member_role against org B => PT403');
select throws_ok($$ select public.revoke_invitation(tt.oid('invB')) $$, 'PT403', null, 'S2.15 revoke_invitation of an org B invitation => PT403');
select throws_ok($$ select public.rename_org(tt.oid('B'), 'Pwned Name') $$, 'PT403', null, 'S2.16 rename_org against org B => PT403');
select throws_ok($$ select public.rename_org(gen_random_uuid(), 'Ghost Org') $$, 'PT403', null,
  'S2.17 rename_org on a non-existent org gives the same PT403 as a foreign org (no existence oracle)');
select throws_ok($$ select public.revoke_invitation(gen_random_uuid()) $$, 'PT404', null, 'S2.18 revoke_invitation of unknown id => PT404');
select throws_ok($$ select public.remove_member(tt.oid('A'), tt.uid('tt_b_owner')) $$, 'PT404', null,
  'S2.19 forged user id: removing a user who is not in org A (own org) => PT404');
select tt.pg();
select is((select name from public.organisations where id = tt.oid('B')), 'Iso Org B', 'S2.20 org B is unchanged after all attempts');
select is((select count(*)::int from public.memberships where org_id = tt.oid('B') and status = 'active'), 2, 'S2.21 org B memberships unchanged');

-- outsider with no membership
select tt.act('tt_outsider');
select throws_ok($$ select public.create_invitation(tt.oid('A'), 'x@example.test', 'viewer') $$, 'PT403', null, 'S2.22 non-member cannot invite into A');
select throws_ok($$ select public.remove_member(tt.oid('A'), tt.uid('tt_a_viewer')) $$, 'PT403', null, 'S2.23 non-member cannot remove from A');
select throws_ok($$ select public.rename_org(tt.oid('A'), 'Hijack') $$, 'PT403', null, 'S2.24 non-member cannot rename A');

-- ===================== S3: removal is immediate =====================
select tt.act('tt_a_staff');
select is((select count(*)::int from public.organisations where id = tt.oid('A')), 1, 'S3.1 before removal the staff member sees org A');
select lives_ok($$ select public.remove_member(tt.oid('A'), tt.uid('tt_a_staff')) $$, 'S3.2 staff member removes themself (allowed)');
select is((select count(*)::int from public.organisations), 0, 'S3.3 next statement, same session: organisations select returns nothing');
select is((select count(*)::int from public.memberships where org_id = tt.oid('A') and user_id <> tt.uid('tt_a_staff')), 0, 'S3.4 next statement: colleagues are invisible');
select is(private.is_member(tt.oid('A')), false, 'S3.5 next statement: is_member false');
select throws_ok($$ select public.create_invitation(tt.oid('A'), 'x@example.test', 'viewer') $$, 'PT403', null, 'S3.6 next statement: RPC fails with PT403');

select tt.act('tt_a_viewer');
select is((select count(*)::int from public.organisations where id = tt.oid('A')), 1, 'S3.7 viewer sees org A');
select tt.act('tt_a_manager');
select lives_ok($$ select public.remove_member(tt.oid('A'), tt.uid('tt_a_viewer')) $$, 'S3.8 manager removes the viewer');
select tt.act('tt_a_viewer');
select is((select count(*)::int from public.organisations), 0, 'S3.9 removed by someone else: the removed user''s very next statement returns nothing');
select throws_ok($$ select public.rename_org(tt.oid('A'), 'Still Here') $$, 'PT403', null, 'S3.10 removed user RPC fails immediately');

-- ================= S4: privilege escalation =================
select tt.act('tt_a_manager');
select throws_ok($$ select public.set_member_role(tt.oid('A'), tt.uid('tt_a_manager'), 'owner') $$, 'PT403', 'cannot_change_own_role', 'S4.1 self role change (promotion) rejected');
select throws_ok($$ select public.set_member_role(tt.oid('A'), tt.uid('tt_a_manager'), 'viewer') $$, 'PT403', 'cannot_change_own_role', 'S4.2 self role change (demotion) rejected');
select throws_ok($$ select public.create_invitation(tt.oid('A'), 'tt_up1@example.test', 'owner') $$, 'PT403', 'cannot_grant_above_own_role', 'S4.3 manager inviting an owner rejected');
select lives_ok($$ select public.create_invitation(tt.oid('A'), 'tt_up2@example.test', 'manager') $$, 'S4.4 manager inviting a manager (same rank) is allowed');
select throws_ok($$ select public.create_invitation(tt.oid('A'), 'tt_up3@example.test', 'admin_super') $$, 'PT422', 'invalid_role', 'S4.5 admin role invitation in a non-mitra org rejected');
select throws_ok($$ select public.remove_member(tt.oid('A'), tt.uid('tt_a_owner')) $$, 'PT403', 'target_outranks_actor', 'S4.6 manager cannot remove an owner');
select throws_ok($$ select public.set_member_role(tt.oid('A'), tt.uid('tt_a_owner'), 'viewer') $$, 'PT403', 'target_outranks_actor', 'S4.7 manager cannot demote an owner');
select tt.pg();
select tt.addm(tt.oid('A'), 'tt_outsider', 'staff');
select tt.act('tt_a_manager');
select throws_ok($$ select public.set_member_role(tt.oid('A'), tt.uid('tt_outsider'), 'owner') $$, 'PT403', 'cannot_grant_above_own_role', 'S4.8 manager cannot promote staff to owner');
select lives_ok($$ select public.set_member_role(tt.oid('A'), tt.uid('tt_outsider'), 'manager') $$, 'S4.9 manager can promote staff to manager (own rank)');
select throws_ok($$ select public.remove_member(tt.oid('A'), tt.uid('tt_outsider')) $$, 'PT403', 'target_outranks_actor', 'S4.10 manager cannot remove an equal-rank manager');

select tt.pg();
select tt.addm(tt.oid('A'), 'tt_a_owner2', 'staff');
select tt.act('tt_a_owner2');
select throws_ok($$ select public.create_invitation(tt.oid('A'), 'tt_up4@example.test', 'viewer') $$, 'PT403', null, 'S4.11 staff cannot invite anyone (even a viewer)');
select throws_ok($$ select public.remove_member(tt.oid('A'), tt.uid('tt_a_manager')) $$, 'PT403', null, 'S4.12 staff cannot remove members');
select throws_ok($$ select public.set_member_role(tt.oid('A'), tt.uid('tt_a_manager'), 'viewer') $$, 'PT403', null, 'S4.13 staff cannot change roles');
select throws_ok($$ select public.rename_org(tt.oid('A'), 'Staff Rename') $$, 'PT403', null, 'S4.14 staff cannot rename the organisation');
select is((select count(*)::int from public.invitations), 0, 'S4.15 staff cannot read invitations');
select is((select count(*)::int from public.audit_log), 0, 'S4.16 staff cannot read audit_log');

-- admin / mitra role rules (admin at aal2)
select tt.act('tt_adm_super', 'aal2');
select throws_ok($$ select public.create_invitation(tt.oid('M'), 'tt_adm1@example.test', 'manager') $$, 'PT422', 'invalid_role', 'S4.17 non-admin role invitation in the mitra org rejected');
select lives_ok($$ select public.create_invitation(tt.oid('M'), 'tt_adm2@example.test', 'admin_review') $$, 'S4.18 admin role invitation in the mitra org by admin_super at aal2 allowed');
select tt.act('tt_adm_super', 'aal1');
select throws_ok($$ select public.create_invitation(tt.oid('M'), 'tt_adm3@example.test', 'admin_review') $$, 'PT403', null, 'S4.19 same call at aal1 rejected (MFA)');
select tt.pg();
select tt.mkuser('tt_extra');
select throws_ok($$ insert into public.memberships (org_id, user_id, role) values (tt.oid('A'), tt.uid('tt_extra'), 'admin_ops') $$, 'PT422', 'role_not_allowed_for_org_type', 'S4.20 (trigger) admin role membership in a non-mitra org rejected');
select throws_ok($$ insert into public.memberships (org_id, user_id, role) values (tt.oid('M'), tt.uid('tt_extra'), 'viewer') $$, 'PT422', 'role_not_allowed_for_org_type', 'S4.21 (trigger) non-admin role membership in the mitra org rejected');
select throws_ok($$ insert into public.organisations (type, name) values ('mitra', 'Second MITRA') $$, '23505', null, 'S4.22 a second mitra organisation is rejected (unique index)');
select throws_ok($$ update public.organisations set type = 'business' where id = tt.oid('M') $$, 'PT422', 'immutable_columns', 'S4.23 organisation type is immutable');
select throws_ok($$ update public.organisations set status = 'suspended' where id = tt.oid('M') $$, 'PT422', 'mitra_org_cannot_be_suspended', 'S4.24 mitra organisation cannot be suspended');
select throws_ok($$ update public.memberships set org_id = tt.oid('B') where org_id = tt.oid('A') and user_id = tt.uid('tt_a_owner') $$, 'PT422', 'immutable_columns', 'S4.25 membership org_id is immutable');

-- direct DML by authenticated and anon is rejected
select tt.act('tt_a_owner', 'aal2');
select throws_ok($$ insert into public.memberships (org_id, user_id, role) values (tt.oid('A'), tt.uid('tt_extra'), 'viewer') $$, '42501', null, 'S4.26 authenticated INSERT memberships denied');
select throws_ok($$ update public.memberships set role = 'owner' where user_id = tt.uid('tt_a_manager') $$, '42501', null, 'S4.27 authenticated UPDATE memberships denied (role escalation)');
select throws_ok($$ delete from public.memberships where user_id = tt.uid('tt_a_manager') $$, '42501', null, 'S4.28 authenticated DELETE memberships denied');
select throws_ok($$ insert into public.organisations (type, name) values ('business', 'Direct Org') $$, '42501', null, 'S4.29 authenticated INSERT organisations denied');
select throws_ok($$ update public.organisations set status = 'active', name = 'x' where id = tt.oid('A') $$, '42501', null, 'S4.30 authenticated UPDATE organisations denied');
select throws_ok($$ delete from public.organisations where id = tt.oid('A') $$, '42501', null, 'S4.31 authenticated DELETE organisations denied');
select throws_ok($$ insert into public.invitations (org_id, email, role, token_hash, expires_at) values (tt.oid('A'), 'z@example.test', 'owner', 'h', now() + interval '1 day') $$, '42501', null, 'S4.32 authenticated INSERT invitations denied');
select throws_ok($$ update public.invitations set role = 'owner' $$, '42501', null, 'S4.33 authenticated UPDATE invitations denied');
select throws_ok($$ delete from public.invitations $$, '42501', null, 'S4.34 authenticated DELETE invitations denied');
select throws_ok($$ insert into public.role_permissions (role, permission) values ('viewer', 'org:manage') $$, '42501', null, 'S4.35 authenticated INSERT role_permissions denied');
select throws_ok($$ update public.role_permissions set permission = 'org:manage' where role = 'viewer' $$, '42501', null, 'S4.36 authenticated UPDATE role_permissions denied');
select throws_ok($$ delete from public.role_permissions $$, '42501', null, 'S4.37 authenticated DELETE role_permissions denied');
select throws_ok($$ insert into public.consents (user_id, purpose, version) values (tt.uid('tt_a_owner'), 'terms', 'x') $$, '42501', null, 'S4.38 authenticated cannot INSERT consents directly');
update public.profiles set display_name = 'hax' where id = tt.uid('tt_a_manager');
select tt.pg();
select is((select display_name from public.profiles where id = tt.uid('tt_a_manager')), '', 'S4.39 updating another user''s profile (colleague) has no effect');
select tt.act('tt_a_owner', 'aal2');

select tt.anon();
select throws_ok($$ insert into public.memberships (org_id, user_id, role) values (tt.oid('A'), tt.uid('tt_extra'), 'owner') $$, '42501', null, 'S4.40 anon INSERT memberships denied');
select throws_ok($$ update public.memberships set role = 'owner' $$, '42501', null, 'S4.41 anon UPDATE memberships denied');
select throws_ok($$ delete from public.organisations $$, '42501', null, 'S4.42 anon DELETE organisations denied');
select throws_ok($$ insert into public.invitations (org_id, email, role, token_hash, expires_at) values (tt.oid('A'), 'z@example.test', 'owner', 'h', now()) $$, '42501', null, 'S4.43 anon INSERT invitations denied');
select throws_ok($$ update public.role_permissions set permission = 'x' $$, '42501', null, 'S4.44 anon UPDATE role_permissions denied');

-- ============ org creation rules, cap, last-owner protection ============
select tt.act('tt_cap');
select throws_ok($$ select public.create_org('mitra', 'Fake Admin Org') $$, 'PT422', 'invalid_org_type', 'S4.45 create_org rejects type mitra');
select throws_ok($$ select public.create_org('business', 'x') $$, 'PT422', 'invalid_name', 'S4.46 create_org rejects a 1-char name');
select lives_ok($$ select public.create_org('buyer', 'Cap Org 1') $$, 'S4.47 create_org buyer works');
select is((select count(*)::int from public.memberships where user_id = tt.uid('tt_cap') and role = 'owner'), 1, 'S4.48 creator becomes owner of the new organisation');
select tt.pg();
insert into public.organisations (type, name, created_by) select 'business', 'Cap Fill ' || g, tt.uid('tt_cap') from generate_series(1, 9) g;
select tt.act('tt_cap');
select throws_ok($$ select public.create_org('business', 'Cap Org 11') $$, 'PT409', 'org_limit_reached', 'S4.49 10-org cap enforced (11th organisation rejected)');
select tt.pg();
delete from public.organisations where created_by = tt.uid('tt_cap');
delete from public.rate_limit_events;
select tt.act('tt_cap');
select lives_ok($$ select public.create_org('business', 'Cap B ' || g) from generate_series(1, 10) g $$, 'S4.50 up to 10 create_org calls in a day succeed');
select throws_ok($$ select public.create_org('business', 'Cap B 11') $$, 'PT429', null, 'S4.51 11th create_org call in a day is rate limited (PT429)');

select tt.pg();
update public.memberships set role = 'owner' where org_id = tt.oid('A') and user_id = tt.uid('tt_a_manager');
update public.memberships set status = 'removed' where org_id = tt.oid('A') and user_id = tt.uid('tt_a_manager');
-- A now: a_owner (owner) only; extra members staff.
select throws_ok($$ update public.memberships set status = 'removed' where org_id = tt.oid('A') and user_id = tt.uid('tt_a_owner') $$, 'PT409', 'last_owner', 'S4.52 last owner cannot be removed (trigger)');
select throws_ok($$ update public.memberships set role = 'manager' where org_id = tt.oid('A') and user_id = tt.uid('tt_a_owner') $$, 'PT409', 'last_owner', 'S4.53 last owner cannot be demoted (trigger)');
select tt.act('tt_a_owner');
select throws_ok($$ select public.remove_member(tt.oid('A'), tt.uid('tt_a_owner')) $$, 'PT409', 'last_owner', 'S4.54 last owner cannot remove themself via RPC');
select tt.pg();
select tt.addm(tt.oid('B'), 'tt_extra', 'owner');
select tt.act('tt_b_owner');
select lives_ok($$ select public.set_member_role(tt.oid('B'), tt.uid('tt_extra'), 'manager') $$, 'S4.55 with a second owner present, an owner can be demoted by the other owner');
select tt.act('tt_b_owner');
select throws_ok($$ select public.remove_member(tt.oid('B'), tt.uid('tt_b_owner')) $$, 'PT409', 'last_owner', 'S4.56 after demotion the remaining owner is the last owner again and is protected');
select tt.pg();
update public.memberships set role = 'owner' where org_id = tt.oid('B') and user_id = tt.uid('tt_extra');
select tt.act('tt_b_owner');
select lives_ok($$ select public.remove_member(tt.oid('B'), tt.uid('tt_b_owner')) $$, 'S4.57 an owner can leave once another owner exists');

-- last admin_super
select tt.pg();
select tt.addm(tt.oid('M'), 'tt_adm_super2', 'admin_ops');
select throws_ok($$ update public.memberships set status = 'removed' where org_id = tt.oid('M') and user_id = tt.uid('tt_adm_super') $$, 'PT409', 'last_owner', 'S4.58 last admin_super cannot be removed');
select throws_ok($$ update public.memberships set role = 'admin_ops' where org_id = tt.oid('M') and user_id = tt.uid('tt_adm_super') $$, 'PT409', 'last_owner', 'S4.59 last admin_super cannot be demoted');
select tt.act('tt_adm_super', 'aal2');
select lives_ok($$ select public.set_member_role(tt.oid('M'), tt.uid('tt_adm_super2'), 'admin_super') $$, 'S4.60 admin_super promotes a second admin_super');
select tt.act('tt_adm_super2', 'aal2');
select lives_ok($$ select public.remove_member(tt.oid('M'), tt.uid('tt_adm_super')) $$, 'S4.61 once a second admin_super exists the first can be removed');
select throws_ok($$ select public.remove_member(tt.oid('M'), tt.uid('tt_adm_super2')) $$, 'PT409', 'last_owner', 'S4.62 and the remaining admin_super is protected');

select tt.pg();
select * from finish();
rollback;

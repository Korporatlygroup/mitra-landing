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

select plan(69);

create table tt.ids (label text primary key, id uuid);
grant select, insert on tt.ids to public;
create table tt.tok (label text primary key, token text not null);
grant select, insert on tt.tok to public;
create function tt.tk(p_label text) returns text language sql stable as $$ select token from tt.tok where label = p_label $$;

select tt.fresh_mitra();
select tt.mkuser(n) from unnest(array['tt_o','tt_inv','tt_s','tt_o2','tt_super','tt_ops','tt_review','tt_mgr','tt_boot','tt_boot2','tt_banned']) n;
select tt.mkuser('tt_unconf', false);
select tt.reg('B', tt.mkorg('business', 'Audit Org B', 'tt_o2'));
select tt.reg('M', tt.mkorg('mitra', 'Audit MITRA', 'tt_super', 'admin_super'));
select tt.addm(tt.oid('M'), 'tt_ops', 'admin_ops');
select tt.addm(tt.oid('M'), 'tt_review', 'admin_review');

-- ===== rows produced through the real RPC surface; actor must come from the JWT =====
select tt.act('tt_o');
insert into tt.ids select 'A', public.create_org('business', 'Audit Org A');
insert into tt.tok select 'i1', (public.create_invitation((select id from tt.ids where label = 'A'), 'tt_inv@example.test', 'manager') ->> 'token');
select public.rename_org((select id from tt.ids where label = 'A'), 'Audit Org A Renamed');
select tt.act('tt_inv');
select public.accept_invitation(tt.tk('i1'));
select tt.act('tt_o');
select public.create_invitation((select id from tt.ids where label = 'A'), 'tt_s@example.test', 'staff');
select public.revoke_invitation((select id from public.invitations where email = 'tt_s@example.test'));
select public.set_member_role((select id from tt.ids where label = 'A'), tt.uid('tt_inv'), 'staff');
select public.remove_member((select id from tt.ids where label = 'A'), tt.uid('tt_inv'));
select tt.pg();

create function tt.aid() returns uuid language sql stable as $$ select id from tt.ids where label = 'A' $$;
grant execute on function tt.aid() to public;

select is((select actor_user_id from public.audit_log where action = 'org.created' and org_id = tt.aid()), tt.uid('tt_o'), 'S8.1 org.created audit row has actor = the calling user (from JWT)');
select is((select actor_user_id from public.audit_log where action = 'membership.added' and org_id = tt.aid() and details ->> 'role' = 'owner'), tt.uid('tt_o'), 'S8.2 membership.added (owner) audit row actor = creator');
select is((select source from public.audit_log where action = 'org.created' and org_id = tt.aid()), 'db', 'S8.3 RPC-driven audit rows have source db');
select is((select actor_user_id from public.audit_log where action = 'org.renamed' and org_id = tt.aid()), tt.uid('tt_o'), 'S8.4 org.renamed actor = owner');
select is((select details ->> 'to' from public.audit_log where action = 'org.renamed' and org_id = tt.aid()), 'Audit Org A Renamed', 'S8.5 org.renamed carries the new name');
select is((select actor_user_id from public.audit_log where action = 'invitation.created' and org_id = tt.aid() and details ->> 'email' = 'tt_inv@example.test'), tt.uid('tt_o'), 'S8.6 invitation.created actor = inviter');
select is((select actor_user_id from public.audit_log where action = 'invitation.accepted' and org_id = tt.aid()), tt.uid('tt_inv'), 'S8.7 invitation.accepted actor = the accepting user (not the inviter)');
select is((select actor_org_id from public.audit_log where action = 'invitation.accepted' and org_id = tt.aid()), tt.aid(), 'S8.8 invitation.accepted records actor_org_id');
select is((select actor_user_id from public.audit_log where action = 'invitation.revoked' and org_id = tt.aid()), tt.uid('tt_o'), 'S8.9 invitation.revoked actor = owner');
select is((select actor_user_id from public.audit_log where action = 'membership.role_changed' and org_id = tt.aid()), tt.uid('tt_o'), 'S8.10 membership.role_changed actor = owner');
select is((select details ->> 'user_id' from public.audit_log where action = 'membership.role_changed' and org_id = tt.aid()), tt.uid('tt_inv')::text, 'S8.11 role_changed details name the target user, actor stays the caller');
select is((select details ->> 'to' from public.audit_log where action = 'membership.role_changed' and org_id = tt.aid()), 'staff', 'S8.12 role_changed records new role');
select is((select actor_user_id from public.audit_log where action = 'membership.removed' and org_id = tt.aid()), tt.uid('tt_o'), 'S8.13 membership.removed actor = owner');
select is((select count(*)::int from public.audit_log where org_id = tt.aid() and action like 'membership.%' and actor_user_id is null), 0, 'S8.14 no membership audit row for org A lacks an actor');

-- consents (sign-up trigger + withdraw RPC)
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values (gen_random_uuid(), 'authenticated', 'authenticated', 'tt_signup@example.test', now(),
  '{"display_name":"Sign Up","language":"ta","consents":{"terms":"2026-07","privacy":"1999-01"}}'::jsonb, now(), now());
select is((select language from public.profiles p join auth.users u on u.id = p.id where u.email = 'tt_signup@example.test'), 'ta', 'S8.15 sign-up trigger creates a profile with the chosen language');
select is((select count(*)::int from public.consents c join auth.users u on u.id = c.user_id where u.email = 'tt_signup@example.test'), 1, 'S8.16 only the well-formed consent version is recorded (malformed version ignored)');
select is((select count(*)::int from public.audit_log where action = 'consent.granted' and details ->> 'user_id' = (select id::text from auth.users where email = 'tt_signup@example.test')), 1, 'S8.17 consent.granted audit row written');
select tt.pg();
insert into tt.ids select 'signup', id from auth.users where email = 'tt_signup@example.test';
insert into tt.ids select 'consent', c.id from public.consents c where c.user_id = (select id from tt.ids where label = 'signup');
-- act as the signup user (not in tt.u): build claims by hand
select set_config('request.jwt.claims', json_build_object('sub', (select id from tt.ids where label = 'signup'), 'role', 'authenticated', 'email', 'tt_signup@example.test', 'aal', 'aal1')::text, true);
set local role authenticated;
select lives_ok($$ select public.withdraw_consent((select id from tt.ids where label = 'consent')) $$, 'S8.18 user withdraws own consent via RPC');
select tt.pg();
select is((select actor_user_id from public.audit_log where action = 'consent.withdrawn'), (select id from tt.ids where label = 'signup'), 'S8.19 consent.withdrawn audit row actor = the user');
select tt.act('tt_o');
select throws_ok($$ select public.withdraw_consent((select id from tt.ids where label = 'consent')) $$, 'PT404', null, 'S8.20 a different user cannot withdraw someone else''s consent');

-- ===== immutability =====
select tt.pg();
select throws_ok($$ update public.audit_log set action = 'tampered' $$, '42501', 'audit_log is append-only', 'S8.21 postgres (table owner) UPDATE blocked by trigger');
select throws_ok($$ delete from public.audit_log $$, '42501', 'audit_log is append-only', 'S8.22 postgres DELETE blocked by trigger');
select throws_ok($$ truncate public.audit_log $$, '42501', 'audit_log is append-only', 'S8.23 postgres TRUNCATE blocked by trigger');
select tt.act('tt_o2', 'aal2');
select throws_ok($$ update public.audit_log set action = 'tampered' $$, '42501', null, 'S8.24 authenticated UPDATE denied');
select throws_ok($$ delete from public.audit_log $$, '42501', null, 'S8.25 authenticated DELETE denied');
select throws_ok($$ truncate public.audit_log $$, '42501', null, 'S8.26 authenticated TRUNCATE denied');
select throws_ok($$ insert into public.audit_log (action) values ('forged') $$, '42501', null, 'S8.27 authenticated INSERT denied');
select tt.anon();
select throws_ok($$ update public.audit_log set action = 'tampered' $$, '42501', null, 'S8.28 anon UPDATE denied');
select throws_ok($$ delete from public.audit_log $$, '42501', null, 'S8.29 anon DELETE denied');
select throws_ok($$ truncate public.audit_log $$, '42501', null, 'S8.30 anon TRUNCATE denied');
select throws_ok($$ insert into public.audit_log (action) values ('forged') $$, '42501', null, 'S8.31 anon INSERT denied');
select tt.svc();
select throws_ok($$ update public.audit_log set action = 'tampered' $$, '42501', null, 'S8.32 service_role UPDATE denied');
select throws_ok($$ delete from public.audit_log $$, '42501', null, 'S8.33 service_role DELETE denied');
select throws_ok($$ truncate public.audit_log $$, '42501', null, 'S8.34 service_role TRUNCATE denied');
select throws_ok($$ insert into public.audit_log (action) values ('forged') $$, '42501', null, 'S8.35 service_role INSERT denied');

-- ===== service_record_auth_event =====
select tt.svc();
select lives_ok($$ select public.service_record_auth_event(tt.uid('tt_o'), 'auth.logout', '{"ip_hint":"test"}'::jsonb) $$, 'S8.36 service_role records a valid app-observed auth event (auth.logout)');
select throws_ok($$ select public.service_record_auth_event(tt.uid('tt_o'), 'org.created') $$, 'PT422', 'unknown_action', 'S8.37 unknown/other-domain action rejected');
select throws_ok($$ select public.service_record_auth_event(tt.uid('tt_o'), 'auth.login') $$, 'PT422', 'unknown_action', 'S8.38 auth.login can no longer be asserted by the application (DB trigger owns it)');
select throws_ok($$ select public.service_record_auth_event(gen_random_uuid(), 'auth.logout') $$, 'PT404', 'unknown_user', 'S8.39 unknown user rejected');
select throws_ok($$ select public.service_record_auth_event(tt.uid('tt_o'), 'auth.logout', jsonb_build_object('x', repeat('a', 3000))) $$, 'PT422', 'details_too_large', 'S8.40 oversize details rejected');
select tt.pg();
select is((select source from public.audit_log where action = 'auth.logout' and actor_user_id = tt.uid('tt_o')), 'app-server', 'S8.41 auth.logout event has source app-server');
select is((select count(*)::int from public.audit_log where action = 'auth.logout' and actor_user_id = tt.uid('tt_o')), 1, 'S8.42 exactly one auth.logout row (rejected calls wrote nothing)');
select tt.act('tt_o');
select throws_ok($$ select public.service_record_auth_event(tt.uid('tt_o'), 'auth.logout') $$, '42501', null, 'S8.43 authenticated cannot call service_record_auth_event');
select tt.anon();
select throws_ok($$ select public.service_record_auth_event(tt.uid('tt_o'), 'auth.logout') $$, '42501', null, 'S8.44 anon cannot call service_record_auth_event');

-- ===== audit visibility =====
select tt.act('tt_o');
select ok((select count(*) from public.audit_log) > 0, 'S8.45 org A owner sees audit rows');
select is((select count(*)::int from public.audit_log where org_id is distinct from tt.aid()), 0, 'S8.46 org A owner sees only org A rows (no other org, no org-less rows)');
select tt.act('tt_o2');
select is((select count(*)::int from public.audit_log where org_id = tt.aid()), 0, 'S8.47 org B owner sees no org A rows');
select tt.act('tt_ops', 'aal1');
select is((select count(*)::int from public.audit_log), 0, 'S8.48 admin_ops at aal1 sees no audit rows');
select tt.act('tt_ops', 'aal2');
select ok((select count(distinct org_id) from public.audit_log where org_id in (tt.aid(), tt.oid('B'), tt.oid('M'))) = 3, 'S8.49 admin_ops at aal2 sees audit rows of every organisation');
select ok((select count(*) from public.audit_log where org_id is null) > 0, 'S8.50 admin_ops at aal2 also sees org-less rows (consents/auth events)');
select tt.act('tt_super', 'aal2');
select ok((select count(distinct org_id) from public.audit_log where org_id in (tt.aid(), tt.oid('B'), tt.oid('M'))) = 3, 'S8.51 admin_super at aal2 sees all audit rows');
select tt.act('tt_review', 'aal2');
select is((select count(*)::int from public.audit_log), 0, 'S8.52 admin_review sees no audit rows even at aal2');
select tt.pg();
select tt.addm(tt.aid(), 'tt_mgr', 'manager');
select tt.addm(tt.aid(), 'tt_s', 'viewer');
select tt.act('tt_mgr', 'aal2');
select is((select count(*)::int from public.audit_log), 0, 'S8.53 manager sees no audit rows');
select tt.act('tt_s', 'aal2');
select is((select count(*)::int from public.audit_log), 0, 'S8.54 viewer sees no audit rows');

-- ===== bootstrap_first_admin =====
select tt.fresh_mitra();
select tt.svc();
select throws_ok($$ select public.bootstrap_first_admin('tt_unconf@example.test') $$, 'PT404', 'user_not_found_or_unconfirmed', 'S8.55 bootstrap fails for an unconfirmed user');
select throws_ok($$ select public.bootstrap_first_admin('nobody@example.test') $$, 'PT404', 'user_not_found_or_unconfirmed', 'S8.56 bootstrap fails for an unknown user');
select throws_ok($$ select public.bootstrap_first_admin(null) $$, 'PT404', 'user_not_found_or_unconfirmed', 'S8.57 bootstrap fails for a NULL email');
select tt.pg();
update auth.users set banned_until = now() + interval '1 day' where email = 'tt_banned@example.test';
select tt.svc();
select throws_ok($$ select public.bootstrap_first_admin('tt_banned@example.test') $$, 'PT404', 'user_not_found_or_unconfirmed', 'S8.58 bootstrap fails for a banned user');
select tt.act('tt_boot');
select throws_ok($$ select public.bootstrap_first_admin('tt_boot@example.test') $$, '42501', null, 'S8.59 authenticated cannot call bootstrap_first_admin');
select tt.anon();
select throws_ok($$ select public.bootstrap_first_admin('tt_boot@example.test') $$, '42501', null, 'S8.60 anon cannot call bootstrap_first_admin');
select tt.pg();
select is((select count(*)::int from public.organisations where type = 'mitra'), 0, 'S8.61 failed bootstraps created nothing');
select tt.svc();
select is(public.bootstrap_first_admin('TT_Boot@Example.Test'), tt.uid('tt_boot'), 'S8.62 bootstrap succeeds once for a confirmed user (case-insensitive email) and returns the user id');
select tt.pg();
select is((select m.role::text from public.memberships m join public.organisations o on o.id = m.org_id where o.type = 'mitra' and m.user_id = tt.uid('tt_boot')), 'admin_super', 'S8.63 bootstrap created the mitra org with an admin_super membership');
select is((select count(*)::int from public.audit_log where action = 'bootstrap.first_admin' and source = 'bootstrap' and details ->> 'user_id' = tt.uid('tt_boot')::text), 1, 'S8.64 bootstrap wrote one audit row with source bootstrap');
select isnt((select completed_at from private.bootstrap_state), null, 'S8.65 bootstrap_state marked completed');
select tt.svc();
select throws_ok($$ select public.bootstrap_first_admin('tt_boot2@example.test') $$, 'PT409', 'already_bootstrapped', 'S8.66 second bootstrap fails (already_bootstrapped)');
select tt.pg();
update private.bootstrap_state set completed_at = null, completed_user_id = null;
select tt.svc();
select throws_ok($$ select public.bootstrap_first_admin('tt_boot2@example.test') $$, 'PT409', 'already_bootstrapped', 'S8.67 even with the state flag cleared, an existing admin_super still blocks bootstrap');
select tt.pg();
select is((select count(*)::int from public.memberships where role = 'admin_super'), 1, 'S8.68 still exactly one admin_super');
select tt.act('tt_boot2', 'aal2');
select throws_ok($$ select public.create_invitation((select id from public.organisations where type = 'mitra'), 'tt_boot2@example.test', 'admin_super') $$, 'PT403', null, 'S8.69 an ordinary user cannot invite themself into the admin org');
select tt.pg();
select * from finish();
rollback;

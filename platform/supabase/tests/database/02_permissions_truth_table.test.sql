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

select plan(16);

-- Independent specification of the seed (written here, not read from the table under test).
create table tt.spec (role text not null, perm text not null);
insert into tt.spec values
  ('owner','org:manage'),('owner','member:invite'),('owner','member:remove'),('owner','member:set_role'),('owner','audit:read'),
  ('manager','member:invite'),('manager','member:remove'),('manager','member:set_role'),
  ('admin_super','admin:users'),('admin_super','audit:read'),('admin_super','org:manage'),
  ('owner','business:edit'),('owner','verification:submit'),('owner','verification:read'),
  ('manager','business:edit'),('manager','verification:submit'),('manager','verification:read'),('staff','business:edit'),
  ('admin_review','verification:decide'),('admin_super','verification:decide'),
  ('admin_super','verification:review'),('admin_super','programme:publish'),('admin_super','case:reply'),('admin_super','report:view'),
  ('admin_ops','audit:read'),('admin_ops','report:view'),
  ('admin_review','verification:review'),('admin_content','programme:publish'),('admin_support','case:reply'),
  ('owner','listing:publish'),('manager','listing:publish'),
  ('owner','request:post'),('manager','request:post'),('staff','request:post'),
  ('owner','request:respond'),('manager','request:respond'),('staff','request:respond'),
  ('admin_review','listing:review'),('admin_super','listing:review'),
  ('admin_super','request:moderate'),('admin_support','request:moderate'),
  ('owner','enquiry:write'),('manager','enquiry:write'),('staff','enquiry:write'),
  ('owner','quote:send'),('manager','quote:send'),('staff','quote:send'),
  ('owner','lead:manage'),('manager','lead:manage'),('staff','lead:manage'),
  ('owner','review:write'),('manager','review:write'),('staff','review:write'),
  ('admin_review','review:moderate'),('admin_super','review:moderate'),
  ('owner','supplier:manage'),('manager','supplier:manage'),('staff','supplier:manage'),
  ('owner','catalogue:manage'),('manager','catalogue:manage'),('staff','catalogue:manage'),
  ('owner','sourcing:respond'),('manager','sourcing:respond'),('staff','sourcing:respond'),
  ('admin_review','supplier:review'),('admin_super','supplier:review'),
  ('admin_review','catalogue:review'),('admin_super','catalogue:review'),
  ('admin_review','partner:manage'),('admin_super','partner:manage'),
  ('admin_support','catalogue:moderate'),('admin_super','catalogue:moderate'),
  ('admin_super','gov:source_admin'),('admin_super','gov:review'),('admin_super','gov:publish'),('admin_super','gov:view'),
  ('admin_ops','gov:source_admin'),('admin_ops','gov:view'),('admin_review','gov:review'),('admin_review','gov:view'),
  ('admin_content','gov:publish'),('admin_content','gov:view');
grant select on tt.spec to public;

select tt.fresh_mitra();
select tt.mkuser(n) from unnest(array[
  'tt_a_owner','tt_a_manager','tt_a_staff','tt_a_viewer','tt_p_owner','tt_p_manager','tt_b_owner','tt_c_owner','tt_nomember',
  'tt_adm_super','tt_adm_ops','tt_adm_review','tt_adm_content','tt_adm_support']) n;

select tt.reg('A', tt.mkorg('business', 'Truth Org A', 'tt_a_owner'));
select tt.addm(tt.oid('A'), 'tt_a_manager', 'manager');
select tt.addm(tt.oid('A'), 'tt_a_staff', 'staff');
select tt.addm(tt.oid('A'), 'tt_a_viewer', 'viewer');
select tt.reg('P', tt.mkorg('partner', 'Truth Partner P', 'tt_p_owner'));
select tt.addm(tt.oid('P'), 'tt_p_manager', 'manager');
select tt.reg('B', tt.mkorg('business', 'Truth Org B', 'tt_b_owner'));
select tt.reg('C', tt.mkorg('business', 'Truth Org C', 'tt_c_owner'));
select tt.reg('M', tt.mkorg('mitra', 'Truth MITRA', 'tt_adm_super', 'admin_super'));
select tt.addm(tt.oid('M'), 'tt_adm_ops', 'admin_ops');
select tt.addm(tt.oid('M'), 'tt_adm_review', 'admin_review');
select tt.addm(tt.oid('M'), 'tt_adm_content', 'admin_content');
select tt.addm(tt.oid('M'), 'tt_adm_support', 'admin_support');

-- S1.1 the seed equals the specification
select is_empty(
  $$ (select role::text, permission from public.role_permissions except select role, perm from tt.spec)
     union all
     (select role, perm from tt.spec except select role::text, permission from public.role_permissions) $$,
  'S1.1 role_permissions seed equals the specification exactly (no extra, no missing permission)');

-- S1.2 full truth table: user x aal x permission x {own org, other org B, other org C, MITRA/other}
create table tt.truth (n int);
do $$
declare
  r record;
  v_aal text;
  v_perm text;
  v_target record;
  v_expected boolean;
  v_actual boolean;
  v_bad text := '';
  v_n int := 0;
  v_perms text[] := (select array_agg(distinct perm) || array['nonexistent:perm'] from tt.spec);
begin
  for r in
    select * from (values
      ('tt_a_owner','A','owner','business'),('tt_a_manager','A','manager','business'),
      ('tt_a_staff','A','staff','business'),('tt_a_viewer','A','viewer','business'),
      ('tt_p_owner','P','owner','partner'),('tt_p_manager','P','manager','partner'),
      ('tt_adm_super','M','admin_super','mitra'),('tt_adm_ops','M','admin_ops','mitra'),
      ('tt_adm_review','M','admin_review','mitra'),('tt_adm_content','M','admin_content','mitra'),
      ('tt_adm_support','M','admin_support','mitra')
    ) as t(uname, olabel, role, otype)
  loop
    foreach v_aal in array array['aal1','aal2'] loop
      foreach v_perm in array v_perms loop
        for v_target in select * from (values ('A'),('B'),('C'),('M'),('P')) as x(label) loop
          v_expected := v_target.label = r.olabel
            and exists (select 1 from tt.spec s where s.role = r.role and s.perm = v_perm)
            and (not (r.role like 'admin\_%' or (r.otype = 'partner' and r.role = 'owner')) or v_aal = 'aal2');
          perform tt.act(r.uname, v_aal);
          v_actual := private.has_permission(tt.oid(v_target.label), v_perm);
          perform tt.pg();
          v_n := v_n + 1;
          if v_actual is distinct from v_expected then
            v_bad := v_bad || format('%s/%s/%s/%s expected %s got %s; ', r.role, v_aal, v_perm, v_target.label, v_expected, v_actual);
          end if;
        end loop;
      end loop;
    end loop;
  end loop;
  perform set_config('tt.s1_bad', v_bad, true);
  perform set_config('tt.s1_n', v_n::text, true);
end $$;
select is(current_setting('tt.s1_bad'), '', 'S1.2 has_permission truth table: every role x aal x permission x own/other org matches seed + MFA rule');
select is(current_setting('tt.s1_n')::int, 11 * 2 * 36 * 5, 'S1.3 truth table actually evaluated all 3960 combinations (11 users x 2 aal x 36 permissions x 5 target orgs)');

-- S1.4 explicit spot checks of the MFA rule
select tt.act('tt_p_owner', 'aal1');
select is(private.has_permission(tt.oid('P'), 'org:manage'), false, 'S1.4 partner-org owner at aal1 is denied org:manage');
select tt.act('tt_p_owner', 'aal2');
select is(private.has_permission(tt.oid('P'), 'org:manage'), true, 'S1.5 partner-org owner at aal2 is allowed org:manage');
select tt.act('tt_a_owner', 'aal1');
select is(private.has_permission(tt.oid('A'), 'org:manage'), true, 'S1.6 business-org owner at aal1 is allowed (no MFA requirement)');
select tt.act('tt_adm_super', 'aal1');
select is(private.has_permission(tt.oid('M'), 'admin:users'), false, 'S1.7 admin_super at aal1 is denied admin:users');
select is(private.has_platform_permission('audit:read'), false, 'S1.8 has_platform_permission(audit:read) false for admin_super at aal1');
select tt.act('tt_adm_super', 'aal2');
select is(private.has_platform_permission('audit:read'), true, 'S1.9 has_platform_permission(audit:read) true for admin_super at aal2');
select tt.act('tt_adm_review', 'aal2');
select is(private.has_platform_permission('audit:read'), false, 'S1.10 admin_review never has platform audit:read');

-- S1.11 suspended org and removed membership grant nothing
select tt.pg();
update public.organisations set status = 'suspended' where id = tt.oid('C');
select tt.act('tt_c_owner', 'aal2');
select is(private.has_permission(tt.oid('C'), 'org:manage'), false, 'S1.11 owner of a suspended organisation has no permissions');
select tt.pg();
update public.memberships set status = 'removed', removed_at = now() where org_id = tt.oid('A') and user_id = tt.uid('tt_a_viewer');
select tt.act('tt_a_manager', 'aal2');
select tt.pg();
update public.memberships set status = 'removed', removed_at = now() where org_id = tt.oid('A') and user_id = tt.uid('tt_a_staff');
select tt.act('tt_a_staff', 'aal2');
select is(private.is_member(tt.oid('A')), false, 'S1.12 removed member: is_member false');

-- S1.13 users with no membership read zero rows everywhere (own profile/consents excepted)
select tt.act('tt_nomember', 'aal2');
select is(
  (select (select count(*) from public.organisations) + (select count(*) from public.memberships)
        + (select count(*) from public.invitations) + (select count(*) from public.audit_log))::int,
  0, 'S1.13 user without membership reads 0 rows in organisations, memberships, invitations, audit_log');
select is((select count(*)::int from public.profiles where id <> tt.uid('tt_nomember')), 0,
  'S1.14 user without membership sees no other profiles');
select is((select count(*)::int from public.consents where user_id <> tt.uid('tt_nomember')), 0,
  'S1.15 user without membership sees no other users consents');
select tt.act('tt_a_staff', 'aal2');
select is((select count(*)::int from public.memberships where org_id = tt.oid('A')), 0,
  'S1.16 removed member sees no membership rows of the org (not even own history; policy comment says own history is visible - see report note L1)');

select tt.pg();
select * from finish();
rollback;

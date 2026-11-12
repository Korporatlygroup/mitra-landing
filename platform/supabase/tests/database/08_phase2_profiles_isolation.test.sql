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

-- ---------- Phase 2 helpers (setup runs as postgres; assertions run as the acting role) ----------
create table tt.ids (label text primary key, id uuid);
grant select, insert, update on tt.ids to public;
create function tt.id(p_label text) returns uuid language sql stable as $$ select id from tt.ids where label = p_label $$;

create function tt.mkdoc(p_label text, p_org uuid, p_user text, p_claim public.claim_type, p_doc public.doc_type,
                         p_status public.scan_status default 'clean') returns uuid language plpgsql as $$
declare v uuid;
begin
  perform tt.pg();
  v := public.service_register_document(p_org, tt.uid(p_user), p_claim, p_doc, 'file-' || p_label || '.pdf', 'application/pdf', 1234,
         encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex'), 'tt/' || gen_random_uuid()::text, p_status, 'tt-engine');
  insert into tt.ids (label, id) values (p_label, v);
  return v;
end $$;

create function tt.setst(p_claim uuid, p_status public.claim_status, p_version integer default null) returns void language plpgsql as $$
begin
  perform tt.pg();
  update public.verification_claims set status = p_status, version = coalesce(p_version, version) where id = p_claim;
end $$;

create function tt.std(p_name text, p_ssm text) returns jsonb language sql immutable as $$
  select jsonb_build_object('business_name', p_name, 'category_slug', 'food-beverage', 'registration_status', 'registered',
    'ssm_number', p_ssm, 'business_type', 'sole_proprietorship', 'state', 'Selangor', 'district', 'Petaling',
    'address_line', '1 Jalan Satu', 'postcode', '47500', 'contact_phone', '+60 3 1234 5678',
    'contact_email', 'biz@example.test', 'description', 'Synthetic business')
$$;

create function tt.prof(p_org uuid, p_user text, p_data jsonb) returns void language plpgsql as $$
begin
  perform tt.act(p_user);
  perform public.save_business_profile(p_org, p_data);
  perform tt.pg();
end $$;

create function tt.rep(p_org uuid, p_user text) returns void language plpgsql as $$
begin
  perform tt.act(p_user);
  perform public.save_representative(p_org, 'Rep Person', 'owner', 'rep@example.test', '0123456789');
  perform tt.pg();
end $$;

select plan(160);

select tt.fresh_mitra();
select tt.mkuser(n) from unnest(array[
  'tt_a_owner','tt_a_manager','tt_a_staff','tt_a_viewer','tt_b_owner','tt_p_owner','tt_y_owner','tt_u_owner','tt_c_owner',
  'tt_rev','tt_rev_conf','tt_ops','tt_content','tt_support','tt_super','tt_n_owner']) n;
select tt.reg('A', tt.mkorg('business', 'Phase2 Org A', 'tt_a_owner'));
select tt.addm(tt.oid('A'), 'tt_a_manager', 'manager');
select tt.addm(tt.oid('A'), 'tt_a_staff', 'staff');
select tt.addm(tt.oid('A'), 'tt_a_viewer', 'viewer');
select tt.addm(tt.oid('A'), 'tt_rev_conf', 'viewer');
select tt.reg('B', tt.mkorg('business', 'Phase2 Org B', 'tt_b_owner'));
select tt.reg('P', tt.mkorg('partner', 'Phase2 Partner', 'tt_p_owner'));
select tt.reg('Y', tt.mkorg('buyer', 'Phase2 Buyer', 'tt_y_owner'));
select tt.reg('U', tt.mkorg('business', 'Phase2 Unregistered', 'tt_u_owner'));
select tt.reg('C', tt.mkorg('business', 'Phase2 Empty', 'tt_c_owner'));
select tt.reg('N', tt.mkorg('business', 'Phase2 Draft Only', 'tt_n_owner'));
select tt.reg('M', tt.mkorg('mitra', 'Phase2 MITRA', 'tt_super', 'admin_super'));
select tt.addm(tt.oid('M'), 'tt_rev', 'admin_review');
select tt.addm(tt.oid('M'), 'tt_rev_conf', 'admin_review');
select tt.addm(tt.oid('M'), 'tt_ops', 'admin_ops');
select tt.addm(tt.oid('M'), 'tt_content', 'admin_content');
select tt.addm(tt.oid('M'), 'tt_support', 'admin_support');

select tt.prof(tt.oid('A'), 'tt_a_owner', tt.std('Alpha Foods', '202001012345'));
select tt.prof(tt.oid('B'), 'tt_b_owner', tt.std('Bravo Foods', '201901054321'));
select tt.rep(tt.oid('A'), 'tt_a_owner');
select tt.rep(tt.oid('B'), 'tt_b_owner');
select tt.mkdoc('dA', tt.oid('A'), 'tt_a_owner', 'business_registration', 'ssm_certificate');
select tt.mkdoc('dB', tt.oid('B'), 'tt_b_owner', 'business_registration', 'ssm_certificate');
select tt.prof(tt.oid('N'), 'tt_n_owner', tt.std('November Draft Foods', '201601013333'));
select tt.mkdoc('dN', tt.oid('N'), 'tt_n_owner', 'business_registration', 'ssm_certificate');
select tt.mkdoc('dDraftA', tt.oid('A'), 'tt_a_owner', 'business_registration', 'ssm_form');   -- clean but never attached to a submission
select tt.act('tt_a_owner');
insert into tt.ids select 'claimA', (public.submit_claim(tt.oid('A'), 'business_registration', array[tt.id('dA')], 'note a') ->> 'claim_id')::uuid;
select tt.act('tt_b_owner');
insert into tt.ids select 'claimB', (public.submit_claim(tt.oid('B'), 'business_registration', array[tt.id('dB')], 'note b') ->> 'claim_id')::uuid;
select tt.pg();
insert into public.notifications (user_id, org_id, kind) values (tt.uid('tt_a_owner'), tt.oid('A'), 'test.a'), (tt.uid('tt_b_owner'), tt.oid('B'), 'test.b');
insert into tt.ids select 'notifB', id from public.notifications where user_id = tt.uid('tt_b_owner') limit 1;
insert into tt.ids select 'notifA', id from public.notifications where user_id = tt.uid('tt_a_owner') limit 1;

-- ========================== ISOLATION: org A user vs org B ==========================
select tt.act('tt_a_owner');
select is((select count(*)::int from public.business_profiles where org_id = tt.oid('A')), 1, 'P2-ISO.0 control: owner reads own business_profiles row');
select is((select count(*)::int from public.business_profiles where org_id = tt.oid('B')), 0, 'P2-ISO.1 cannot read org B business_profiles');
select is((select count(*)::int from public.business_private where org_id = tt.oid('B')), 0, 'P2-ISO.2 cannot read org B business_private');
select is((select count(*)::int from public.business_representatives where org_id = tt.oid('B')), 0, 'P2-ISO.3 cannot read org B representative');
select is((select count(*)::int from public.verification_claims where org_id = tt.oid('B')), 0, 'P2-ISO.4 cannot read org B claims');
select is((select count(*)::int from public.verification_documents where org_id = tt.oid('B')), 0, 'P2-ISO.5 cannot read org B documents');
select is((select count(*)::int from public.verification_claim_documents where claim_id = tt.id('claimB')), 0, 'P2-ISO.6 cannot read org B claim-document links');
select is((select count(*)::int from public.verification_events where org_id = tt.oid('B')), 0, 'P2-ISO.7 cannot read org B events');
select is((select count(*)::int from public.notifications where user_id = tt.uid('tt_b_owner')), 0, 'P2-ISO.8 cannot read another user''s notifications');
select is((select count(*)::int from public.notifications where user_id = tt.uid('tt_a_owner')), 1, 'P2-ISO.9 control: reads own notifications');
select throws_ok($$ select public.save_business_profile(tt.oid('B'), '{"business_name":"Hijack"}'::jsonb) $$, 'PT403', null, 'P2-ISO.10 save_business_profile on org B => PT403');
select throws_ok($$ select public.save_representative(tt.oid('B'), 'Evil Rep', 'owner', null, null) $$, 'PT403', null, 'P2-ISO.11 save_representative on org B => PT403');
select throws_ok($$ select public.submit_claim(tt.oid('B'), 'business_location', array[tt.id('dB')], null) $$, 'PT403', null, 'P2-ISO.12 submit_claim on org B => PT403');
select throws_ok($$ select public.withdraw_claim(tt.id('claimB')) $$, 'PT403', null, 'P2-ISO.13 withdraw_claim on org B claim => PT403');
select throws_ok($$ select public.remove_document(tt.id('dB')) $$, 'PT403', null, 'P2-ISO.14 remove_document of an org B document => PT403');
select throws_ok($$ select public.get_document_access(tt.id('dB')) $$, 'PT404', null, 'P2-ISO.15 get_document_access of an org B document => PT404 (no existence oracle)');
select throws_ok($$ select public.start_review(tt.id('claimB')) $$, 'PT403', null, 'P2-ISO.16 an org user cannot start a review');
select throws_ok($$ select public.decide_claim(tt.id('claimB'), 'approve', 'looks fine to me', 1) $$, 'PT403', null, 'P2-ISO.17 an org user cannot decide a claim');
select throws_ok($$ select public.decide_claim(tt.id('claimA'), 'approve', 'approving my own claim', 1) $$, 'PT403', null, 'P2-ISO.18 an owner cannot approve even their own claim');
select lives_ok($$ select public.mark_notification_read(tt.id('notifB')) $$, 'P2-ISO.19 mark_notification_read on someone else''s notification does not error...');
select tt.pg();
select is((select read_at from public.notifications where id = tt.id('notifB')), null, 'P2-ISO.20 ...but leaves it unread');
select tt.act('tt_a_owner');
select lives_ok($$ select public.mark_notification_read(tt.id('notifA')) $$, 'P2-ISO.21 control: marks own notification read');
select tt.pg();
select isnt((select read_at from public.notifications where id = tt.id('notifA')), null, 'P2-ISO.22 own notification is read');

-- direct DML on every Phase 2 table is impossible for authenticated and anon
create table tt.dml (t text, role text, op text, state text);
grant insert on tt.dml to public;
do $$
declare
  v_t text; v_role text; v_op text; v_sql text; v_state text; v_bad text := ''; v_n int := 0;
begin
  foreach v_t in array array['business_categories','business_profiles','business_private','business_representatives','verification_claims',
    'verification_documents','verification_claim_documents','verification_events','notifications'] loop
    foreach v_role in array array['authenticated','anon','service_role'] loop
      foreach v_op in array array['insert','update','delete'] loop
        v_sql := case v_op when 'insert' then format('insert into public.%I default values', v_t)
                           when 'update' then format('update public.%I set ctid = ctid where false', v_t)
                           else format('delete from public.%I where false', v_t) end;
        if v_op = 'update' then v_sql := format('update public.%I set %s where false', v_t,
          (select quote_ident(column_name) || ' = ' || quote_ident(column_name) from information_schema.columns
           where table_schema = 'public' and table_name = v_t order by ordinal_position offset 1 limit 1)); end if;
        if v_role = 'authenticated' then perform tt.act('tt_a_owner', 'aal2'); elsif v_role = 'anon' then perform tt.anon(); else perform tt.svc(); end if;
        begin
          execute v_sql;
          v_state := 'allowed';
        exception when others then
          v_state := sqlstate;
        end;
        perform tt.pg();
        v_n := v_n + 1;
        if v_state <> '42501' then v_bad := v_bad || format('%s/%s/%s=%s; ', v_role, v_t, v_op, v_state); end if;
      end loop;
    end loop;
  end loop;
  perform set_config('tt.dml_bad', v_bad, true);
  perform set_config('tt.dml_n', v_n::text, true);
end $$;
select is(current_setting('tt.dml_bad'), '', 'P2-ISO.23 INSERT/UPDATE/DELETE on all 9 Phase 2 tables is denied (42501) for authenticated, anon and service_role');
select is(current_setting('tt.dml_n')::int, 81, 'P2-ISO.24 all 81 DML combinations were evaluated');

-- ========================== ROLES ==========================
select tt.act('tt_a_viewer');
select is((select count(*)::int from public.business_private), 0, 'P2-ROLE.1 viewer cannot read business_private');
select is((select count(*)::int from public.business_representatives), 0, 'P2-ROLE.2 viewer cannot read the representative');
select is((select count(*)::int from public.verification_claims), 0, 'P2-ROLE.3 viewer cannot read claims');
select is((select count(*)::int from public.verification_documents), 0, 'P2-ROLE.4 viewer cannot read documents');
select is((select count(*)::int from public.verification_events), 0, 'P2-ROLE.5 viewer cannot read events');
select is((select count(*)::int from public.verification_claim_documents), 0, 'P2-ROLE.6 viewer cannot read claim-document links');
select throws_ok($$ select public.save_business_profile(tt.oid('A'), '{"description":"viewer edit"}'::jsonb) $$, 'PT403', null, 'P2-ROLE.7 viewer cannot edit the profile');
select throws_ok($$ select public.submit_claim(tt.oid('A'), 'business_location', array[tt.id('dA')], null) $$, 'PT403', null, 'P2-ROLE.8 viewer cannot submit');
select throws_ok($$ select public.get_document_access(tt.id('dA')) $$, 'PT404', null, 'P2-ROLE.9 viewer cannot access documents');
select is((select count(*)::int from public.business_profiles where org_id = tt.oid('A')), 1, 'P2-ROLE.10 viewer can read the non-sensitive profile facts of their own org');

select tt.act('tt_a_staff');
select lives_ok($$ select public.save_business_profile(tt.oid('A'), '{"description":"edited by staff"}'::jsonb) $$, 'P2-ROLE.11 staff can edit the profile');
select lives_ok($$ select public.save_representative(tt.oid('A'), 'Rep Person', 'director', null, null) $$, 'P2-ROLE.12 staff can edit the representative');
select throws_ok($$ select public.submit_claim(tt.oid('A'), 'business_location', array[tt.id('dA')], null) $$, 'PT403', null, 'P2-ROLE.13 staff cannot submit claims');
select throws_ok($$ select public.withdraw_claim(tt.id('claimA')) $$, 'PT403', null, 'P2-ROLE.14 staff cannot withdraw claims');
select throws_ok($$ select public.remove_document(tt.id('dA')) $$, 'PT403', null, 'P2-ROLE.15 staff cannot remove documents');
select is((select count(*)::int from public.verification_claims), 0, 'P2-ROLE.16 staff cannot see claims');
select is((select count(*)::int from public.verification_documents), 0, 'P2-ROLE.17 staff cannot see documents');
select is((select count(*)::int from public.verification_events), 0, 'P2-ROLE.18 staff cannot see events');
select is((select count(*)::int from public.business_representatives), 0, 'P2-ROLE.19 staff cannot read the representative (needs verification:read)');
select is((select count(*)::int from public.business_private), 1, 'P2-ROLE.20 staff can read business_private (business:edit)');
select throws_ok($$ select public.get_document_access(tt.id('dA')) $$, 'PT404', null, 'P2-ROLE.21 staff cannot access documents');

select tt.act('tt_a_manager');
select is((select count(*)::int from public.business_private), 1, 'P2-ROLE.22 manager reads business_private');
select is((select count(*)::int from public.verification_claims), 1, 'P2-ROLE.23 manager reads claims');
select is((select count(*)::int from public.verification_documents), 2, 'P2-ROLE.24 manager reads documents (including the unattached draft document)');
select is((select count(*)::int from public.business_representatives), 1, 'P2-ROLE.25 manager reads the representative');
select lives_ok($$ select public.save_business_profile(tt.oid('A'), '{"description":"edited by manager"}'::jsonb) $$, 'P2-ROLE.26 manager can edit the profile');
select tt.act('tt_a_owner');
select is((select count(*)::int from public.verification_events), 4, 'P2-ROLE.27 owner reads events (claim_created, 2x document_uploaded, submitted)');
select is((select count(*)::int from public.verification_claim_documents), 1, 'P2-ROLE.28 owner reads claim-document links');

-- ========================== REVIEWERS ==========================
select tt.act('tt_rev', 'aal1');
select is((select count(*)::int from public.verification_claims), 0, 'P2-REV.1 admin_review at aal1 sees no claims (MFA)');
select throws_ok($$ select public.start_review(tt.id('claimA')) $$, 'PT403', null, 'P2-REV.2 admin_review at aal1 cannot start a review');
select throws_ok($$ select public.decide_claim(tt.id('claimA'), 'approve', 'enough evidence here', 1) $$, 'PT403', null, 'P2-REV.3 admin_review at aal1 cannot decide');
select throws_ok($$ select public.get_document_access(tt.id('dA')) $$, 'PT404', null, 'P2-REV.4 admin_review at aal1 cannot access documents');
select tt.act('tt_rev', 'aal2');
select is((select count(*)::int from public.verification_claims where org_id in (tt.oid('A'), tt.oid('B'))), 2, 'P2-REV.5 admin_review at aal2 sees claims of every organisation');
select ok((select count(*) from public.verification_claims where snapshot is not null and org_id in (tt.oid('A'), tt.oid('B'))) = 2, 'P2-REV.6 reviewer sees the claim snapshots');
select is((select count(*)::int from public.verification_documents where org_id in (tt.oid('A'), tt.oid('B'))), 2, 'P2-REV.7 reviewer sees document metadata of every organisation');
select is((select count(*)::int from public.verification_documents where id = tt.id('dDraftA')), 0, 'P2-REV.7b reviewers do NOT see metadata of a draft (unattached) document');
select is((select count(*)::int from public.verification_documents where id in (tt.id('dA'), tt.id('dB'))), 2, 'P2-REV.7c reviewers see the documents attached to submitted versions');
select is((select count(*)::int from public.verification_documents where org_id in (tt.oid('A'), tt.oid('B'), tt.oid('U'))), 2, 'P2-REV.7d reviewers see exactly the documents attached to submitted versions of the fixture orgs (A and B; U has not submitted yet), no drafts');
select ok((select count(*) from public.verification_events where org_id in (tt.oid('A'), tt.oid('B'))) >= 6, 'P2-REV.8 reviewer sees events of every organisation');
select is((select count(*)::int from public.business_profiles where org_id in (tt.oid('A'), tt.oid('B'))), 2, 'P2-REV.9 reviewer sees the business profile facts');
select is((select count(*)::int from public.business_private), 0, 'P2-REV.10 reviewer does NOT see business_private');
select is((select count(*)::int from public.business_representatives), 0, 'P2-REV.11 reviewer does NOT see the representative table');
select is((select count(*)::int from public.organisations where id = tt.oid('A')), 1, 'P2-REV.12 reviewer can read the organisation row of a business (to show its name)');
select is((select count(*)::int from public.organisations where id = tt.oid('P')), 0, 'P2-REV.13 but not partner organisations');
select is((select count(*)::int from public.notifications where user_id <> tt.uid('tt_rev')), 0, 'P2-REV.14 reviewer sees no notifications of others');
select lives_ok($$ select public.get_document_access(tt.id('dA')) $$, 'P2-REV.15 non-conflicted reviewer at aal2 can access an attached document');
select tt.act('tt_super', 'aal2');
select is((select count(*)::int from public.verification_claims where org_id in (tt.oid('A'), tt.oid('B'))), 2, 'P2-REV.16 admin_super at aal2 sees claims');
select is((select count(*)::int from public.business_private), 0, 'P2-REV.17 admin_super does NOT see business_private');
select is((select count(*)::int from public.business_representatives), 0, 'P2-REV.18 admin_super does NOT see the representative table');
select tt.act('tt_super', 'aal1');
select is((select count(*)::int from public.verification_claims), 0, 'P2-REV.19 admin_super at aal1 sees no claims');
select throws_ok($$ select public.start_review(tt.id('claimA')) $$, 'PT403', null, 'P2-REV.20 admin_super at aal1 cannot start a review');

select tt.act('tt_ops', 'aal2');
select is((select count(*)::int from public.verification_claims), 0, 'P2-REV.21 admin_ops sees no claims even at aal2');
select throws_ok($$ select public.start_review(tt.id('claimA')) $$, 'PT403', null, 'P2-REV.22 admin_ops cannot start a review');
select throws_ok($$ select public.decide_claim(tt.id('claimA'), 'approve', 'ops approving a claim', 1) $$, 'PT403', null, 'P2-REV.23 admin_ops cannot decide');
select tt.act('tt_content', 'aal2');
select throws_ok($$ select public.decide_claim(tt.id('claimA'), 'approve', 'content approving a claim', 1) $$, 'PT403', null, 'P2-REV.24 admin_content cannot decide');
select throws_ok($$ select public.get_document_access(tt.id('dA')) $$, 'PT404', null, 'P2-REV.25 admin_content cannot access documents');
select tt.act('tt_support', 'aal2');
select throws_ok($$ select public.decide_claim(tt.id('claimA'), 'approve', 'support approving a claim', 1) $$, 'PT403', null, 'P2-REV.26 admin_support cannot decide');
select is((select count(*)::int from public.verification_documents), 0, 'P2-REV.27 admin_support sees no documents');
select tt.act('tt_a_owner');
select is((select count(*)::int from public.verification_documents where id = tt.id('dDraftA')), 1, 'P2-REV.28 control: the owner side still sees its own draft document');

-- conflict of interest: reviewer who is also an active member of the organisation
select tt.act('tt_rev_conf', 'aal2');
select throws_ok($$ select public.start_review(tt.id('claimA')) $$, 'PT403', 'conflict_of_interest', 'P2-COI.1 a reviewer who is a member of the org cannot start its review');
select throws_ok($$ select public.decide_claim(tt.id('claimA'), 'approve', 'reviewing my own org', 1) $$, 'PT403', 'conflict_of_interest', 'P2-COI.2 ...cannot decide its claim');
select throws_ok($$ select public.get_document_access(tt.id('dA')) $$, 'PT404', null, 'P2-COI.3 ...cannot access its documents');
select lives_ok($$ select public.start_review(tt.id('claimB')) $$, 'P2-COI.4 control: the same reviewer can review an org they do not belong to');
select tt.pg();
update public.memberships set status = 'removed', removed_at = now() where org_id = tt.oid('A') and user_id = tt.uid('tt_rev_conf');
select tt.act('tt_rev_conf', 'aal2');
select throws_ok($$ select public.start_review(tt.id('claimA')) $$, 'PT403', 'conflict_of_interest', 'P2-COI.5 leaving the org does NOT clear the conflict (any membership row, even a removed one, counts as involvement)');
select throws_ok($$ select public.decide_claim(tt.id('claimA'), 'approve', 'reviewing my former org', 1) $$, 'PT403', 'conflict_of_interest', 'P2-COI.6 ...nor can a former member decide');
select throws_ok($$ select public.get_document_access(tt.id('dA')) $$, 'PT404', null, 'P2-COI.7 ...nor open its documents');
select tt.pg();
select tt.setst(tt.id('claimA'), 'submitted');

-- ========================== L2: reviewers see only businesses that submitted something ==========================
select tt.act('tt_rev', 'aal2');
select is((select count(*)::int from public.business_profiles where org_id = tt.oid('N')), 0, 'P2-L2.1 a reviewer cannot see the profile of an org with only a draft claim');
select is((select count(*)::int from public.organisations where id = tt.oid('N')), 0, 'P2-L2.2 ...nor its organisation row');
select is((select count(*)::int from public.business_profiles where org_id = tt.oid('C')), 0, 'P2-L2.3 a reviewer cannot see the profile of an org with no claim at all');
select is((select count(*)::int from public.organisations where id = tt.oid('C')), 0, 'P2-L2.4 ...nor its organisation row');
select is((select count(*)::int from public.business_profiles where org_id = tt.oid('A')) + (select count(*)::int from public.organisations where id = tt.oid('A')), 2, 'P2-L2.5 control: org A (submitted claim) is visible');
select tt.act('tt_n_owner');
select is((select count(*)::int from public.business_profiles where org_id = tt.oid('N')) + (select count(*)::int from public.organisations where id = tt.oid('N')), 2, 'P2-L2.6 members always see their own org and profile');
select lives_ok($$ select public.submit_claim(tt.oid('N'), 'business_registration', array[tt.id('dN')], null) $$, 'P2-L2.7 org N submits its claim');
select tt.act('tt_rev', 'aal2');
select is((select count(*)::int from public.business_profiles where org_id = tt.oid('N')) + (select count(*)::int from public.organisations where id = tt.oid('N')), 2, 'P2-L2.8 after submitting, the reviewer sees the profile and the organisation');
select tt.pg();
select tt.setst((select id from public.verification_claims where org_id = tt.oid('N')), 'withdrawn');
select tt.act('tt_rev', 'aal2');
select is((select count(*)::int from public.business_profiles where org_id = tt.oid('N')), 1, 'P2-L2.9 a withdrawn (non-draft) claim keeps the org visible to reviewers');
select tt.pg();
select tt.setst((select id from public.verification_claims where org_id = tt.oid('N')), 'draft');
select tt.act('tt_rev', 'aal2');
select is((select count(*)::int from public.business_profiles where org_id = tt.oid('N')), 0, 'P2-L2.10 back to draft: invisible again');
select tt.act('tt_ops', 'aal2');
select is((select count(*)::int from public.business_profiles where org_id = tt.oid('A')), 0, 'P2-L2.11 non-reviewing admin roles never see business profiles of other orgs');

-- ========================== L1: verification summary for every member ==========================
select tt.act('tt_a_owner');
select is((select status::text from public.get_verification_summary(tt.oid('A')) where claim_type = 'business_registration'), 'submitted', 'P2-L1.1 owner reads the verification summary');
select tt.act('tt_a_manager');
select is((select status::text from public.get_verification_summary(tt.oid('A')) where claim_type = 'business_registration'), 'submitted', 'P2-L1.2 manager reads the verification summary');
select tt.act('tt_a_staff');
select is((select status::text from public.get_verification_summary(tt.oid('A')) where claim_type = 'business_registration'), 'submitted', 'P2-L1.3 staff (who cannot read the claims table) reads the summary');
select tt.act('tt_a_viewer');
select is((select status::text from public.get_verification_summary(tt.oid('A')) where claim_type = 'business_registration'), 'submitted', 'P2-L1.4 viewer reads the summary');
select is((select count(*)::int from public.verification_claims), 0, 'P2-L1.5 ...while the viewer still cannot read the claims table itself');
select tt.act('tt_b_owner');
select throws_ok($$ select * from public.get_verification_summary(tt.oid('A')) $$, 'PT403', null, 'P2-L1.6 a member of another org is denied');
select throws_ok($$ select * from public.get_verification_summary(gen_random_uuid()) $$, 'PT403', null, 'P2-L1.7 an unknown org gives the same denial');
select tt.act('tt_rev', 'aal2');
select throws_ok($$ select * from public.get_verification_summary(tt.oid('A')) $$, 'PT403', null, 'P2-L1.8 even a reviewer is not a member and is denied (they use the claims table)');
select tt.anon();
select throws_ok($$ select * from public.get_verification_summary(tt.oid('A')) $$, '42501', null, 'P2-L1.9 anon is denied');
select tt.pg();
select is((select proargnames from pg_proc where proname = 'get_verification_summary' and pronamespace = 'public'::regnamespace), array['p_org', 'claim_type', 'status', 'decided_at'], 'P2-L1.10 the summary returns only claim_type, status and decided_at (no reasons, notes, documents or snapshots)');

-- ========================== PROFILE VALIDATION ==========================
select tt.act('tt_a_owner');
select throws_ok($$ select public.save_business_profile(tt.oid('A'), '{"business_name":"x"}'::jsonb) $$, 'PT422', 'invalid_name', 'P2-VAL.1 one-character name rejected');
select throws_ok($$ select public.save_business_profile(tt.oid('A'), jsonb_build_object('business_name', E'Bad\x01Name')) $$, 'PT422', 'invalid_name', 'P2-VAL.2 control character in name rejected');
select throws_ok($$ select public.save_business_profile(tt.oid('A'), jsonb_build_object('business_name', repeat('x', 161))) $$, 'PT422', 'invalid_name', 'P2-VAL.3 161-char name rejected');
select throws_ok($$ select public.save_business_profile(tt.oid('A'), '{"ssm_number":"ABC123"}'::jsonb) $$, 'PT422', 'invalid_ssm', 'P2-VAL.4 malformed SSM number rejected');
select throws_ok($$ select public.save_business_profile(tt.oid('A'), '{"ssm_number":"2020010123"}'::jsonb) $$, 'PT422', 'invalid_ssm', 'P2-VAL.5 SSM number with 10 digits rejected');
select throws_ok($$ select public.save_business_profile(tt.oid('A'), '{"state":"Atlantis"}'::jsonb) $$, 'PT422', 'invalid_state', 'P2-VAL.6 unknown state rejected');
select throws_ok($$ select public.save_business_profile(tt.oid('A'), '{"postcode":"1234"}'::jsonb) $$, 'PT422', 'invalid_postcode', 'P2-VAL.7 4-digit postcode rejected');
select throws_ok($$ select public.save_business_profile(tt.oid('A'), '{"postcode":"12A45"}'::jsonb) $$, 'PT422', 'invalid_postcode', 'P2-VAL.8 non-numeric postcode rejected');
select throws_ok($$ select public.save_business_profile(tt.oid('A'), '{"contact_phone":"call me"}'::jsonb) $$, 'PT422', 'invalid_phone', 'P2-VAL.9 invalid phone rejected');
select throws_ok($$ select public.save_business_profile(tt.oid('A'), '{"contact_email":"not-an-email"}'::jsonb) $$, 'PT422', 'invalid_email', 'P2-VAL.10 invalid contact e-mail rejected');
select throws_ok($$ select public.save_business_profile(tt.oid('A'), '{"contact_email":"a@b.test, c@d.test"}'::jsonb) $$, 'PT422', 'invalid_email', 'P2-VAL.11 multi-address contact e-mail rejected');
select throws_ok($$ select public.save_business_profile(tt.oid('A'), '{"category_slug":"no-such-category"}'::jsonb) $$, 'PT422', 'invalid_category', 'P2-VAL.12 unknown category rejected');
select throws_ok($$ select public.save_business_profile(tt.oid('A'), '{"business_type":"cooperative"}'::jsonb) $$, 'PT422', 'invalid_business_type', 'P2-VAL.13 unknown business type rejected');
select throws_ok($$ select public.save_business_profile(tt.oid('A'), '{"registration_status":"maybe"}'::jsonb) $$, 'PT422', 'invalid_registration_status', 'P2-VAL.14 unknown registration status rejected');
select throws_ok($$ select public.save_business_profile(tt.oid('A'), '[1,2]'::jsonb) $$, 'PT422', 'invalid_data', 'P2-VAL.15 non-object payload rejected');
select throws_ok($$ select public.save_business_profile(tt.oid('A'), jsonb_build_object('description', repeat('d', 1001))) $$, 'PT422', 'invalid_description', 'P2-VAL.16 1001-char description rejected');
select throws_ok($$ select public.save_representative(tt.oid('A'), 'R', 'owner', null, null) $$, 'PT422', 'invalid_name', 'P2-VAL.17 representative: 1-char name rejected');
select throws_ok($$ select public.save_representative(tt.oid('A'), 'Rep Person', 'ceo', null, null) $$, 'PT422', 'invalid_role', 'P2-VAL.18 representative: unknown role rejected');
select throws_ok($$ select public.save_representative(tt.oid('A'), 'Rep Person', 'owner', 'bad', null) $$, 'PT422', 'invalid_email', 'P2-VAL.19 representative: invalid e-mail rejected');
select throws_ok($$ select public.save_representative(tt.oid('A'), 'Rep Person', 'owner', null, 'abc') $$, 'PT422', 'invalid_phone', 'P2-VAL.20 representative: invalid phone rejected');
select is((select ssm_number from public.business_profiles where org_id = tt.oid('A')), '202001012345', 'P2-VAL.22 rejected saves changed nothing');
select tt.act('tt_c_owner');
select throws_ok($$ select public.save_representative(tt.oid('C'), 'Rep Person', 'owner', null, null) $$, 'PT409', 'profile_required', 'P2-VAL.21 representative requires a profile first (own org without profile)');
select throws_ok($$ select public.save_business_profile(tt.oid('C'), '{"business_name":"No Category Co"}'::jsonb) $$, 'PT422', 'category_required', 'P2-VAL.23 first save without a category is rejected');
select lives_ok($$ select public.save_business_profile(tt.oid('C'), '{"business_name":"  Spaced Co  ","category_slug":"other","registration_status":"registered","ssm_number":" 1234567-k ","state":"Johor"}'::jsonb) $$, 'P2-VAL.24 partial first save is allowed (save and finish later)');
select tt.pg();
select is((select ssm_number from public.business_profiles where org_id = tt.oid('C')), '1234567-K', 'P2-VAL.25 SSM number is normalised (whitespace removed, upper-cased)');
select is((select business_name from public.business_profiles where org_id = tt.oid('C')), 'Spaced Co', 'P2-VAL.26 name is trimmed');
select tt.act('tt_p_owner', 'aal2');
select throws_ok($$ select public.save_business_profile(tt.oid('P'), tt.std('Partner Co', '202001012345')) $$, 'PT422', 'org_not_business', 'P2-VAL.27 partner organisations cannot have a business profile');
select tt.act('tt_y_owner');
select throws_ok($$ select public.save_business_profile(tt.oid('Y'), tt.std('Buyer Co', '202001012345')) $$, 'PT422', 'org_not_business', 'P2-VAL.28 buyer organisations cannot have a business profile');

-- unregistered limited profile
select tt.act('tt_u_owner');
select lives_ok($$ select public.save_business_profile(tt.oid('U'), jsonb_build_object('business_name','Home Baker','category_slug','food-beverage','registration_status','unregistered','ssm_number','202001012345','business_type','sdn_bhd','state','Perak','address_line','5 Lorong Lima','postcode','30000')) $$,
  'P2-UNREG.1 an unregistered business can save a profile');
select tt.pg();
select is((select ssm_number is null and business_type is null from public.business_profiles where org_id = tt.oid('U')), true, 'P2-UNREG.2 unregistered: SSM number and business type are forced to NULL');
select tt.act('tt_u_owner');
select throws_ok($$ select public.submit_claim(tt.oid('U'), 'business_registration', array[gen_random_uuid()], null) $$, 'PT409', 'details_incomplete', 'P2-UNREG.3 an unregistered business cannot submit business_registration');
select tt.pg();
select tt.mkdoc('dU', tt.oid('U'), 'tt_u_owner', 'business_location', 'address_proof');
select tt.act('tt_u_owner');
select lives_ok($$ select public.submit_claim(tt.oid('U'), 'business_location', array[tt.id('dU')], null) $$, 'P2-UNREG.4 but an unregistered business can still verify its location');
select tt.pg();
select is((select snapshot ? 'ssm_number' from public.verification_claims where org_id = tt.oid('U') and claim_type = 'business_location'), false, 'P2-UNREG.5 the location snapshot carries no SSM data');

-- ========================== DATA MINIMISATION ==========================
select is_empty(
  $$ select table_name || '.' || column_name from information_schema.columns
     where table_schema = 'public'
       and table_name in ('business_categories','business_profiles','business_private','business_representatives','verification_claims',
         'verification_documents','verification_claim_documents','verification_events','notifications')
       and column_name ~* '(^|_)(ic|nric|identity|identification|passport|mykad|ic_number)(_|$)' $$,
  'P2-MIN.1 no identity-document style columns (ic, nric, identity, passport, mykad) in any Phase 2 table');
select is_empty(
  $$ select table_name || '.' || column_name from information_schema.columns
     where table_schema = 'public' and table_name like 'business\_%' and column_name ~* '(birth|dob|gender|religion|race|salary|income)' $$,
  'P2-MIN.2 no demographic or financial columns in the business tables');

-- ========================== CATEGORIES ==========================
select tt.act('tt_a_viewer');
select is((select count(*)::int from public.business_categories where slug in ('food-beverage','retail-shop','tailoring-apparel','beauty-wellness','home-services','education-training','tech-digital','manufacturing','agriculture','transport-logistics','events-hospitality','professional-services','other')), 13, 'P2-CAT.1 13 seeded categories are readable by authenticated');
select tt.pg();
update public.business_categories set active = false where slug = 'agriculture';
select tt.act('tt_a_viewer');
select is((select count(*)::int from public.business_categories where slug in ('food-beverage','retail-shop','tailoring-apparel','beauty-wellness','home-services','education-training','tech-digital','manufacturing','agriculture','transport-logistics','events-hospitality','professional-services','other')), 12, 'P2-CAT.2 an inactive category is hidden from authenticated');
select tt.act('tt_a_owner');
select throws_ok($$ select public.save_business_profile(tt.oid('A'), '{"category_slug":"agriculture"}'::jsonb) $$, 'PT422', 'invalid_category', 'P2-CAT.3 an inactive category cannot be chosen');
select tt.anon();
select throws_ok($$ select * from public.business_categories $$, '42501', null, 'P2-CAT.4 anon cannot read categories');
select tt.pg();
select is((select count(*)::int from public.business_categories where name_en is null or name_ta is null), 0, 'P2-CAT.5 every category has English and Tamil names');
select is((select count(*)::int from public.business_categories where active is false and slug = 'agriculture'), 1, 'P2-CAT.6 (setup check) the deactivated category is inactive');

-- ========================== STORAGE CONFIGURATION ==========================
select is((select public from storage.buckets where id = 'verification-docs'), false, 'P2-STO.1 the verification-docs bucket exists and is private');
select is((select file_size_limit from storage.buckets where id = 'verification-docs'), 10485760::bigint, 'P2-STO.2 bucket size limit is 10 MiB');
select is((select array_agg(m order by m) from storage.buckets b, unnest(b.allowed_mime_types) m where b.id = 'verification-docs'),
  array['application/pdf', 'image/jpeg', 'image/png'], 'P2-STO.3 bucket allows exactly PDF, PNG and JPEG');
select is_empty(
  $$ select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'
       and (roles && array['anon', 'authenticated', 'public']::name[])
       and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'verification-docs' $$,
  'P2-STO.4 no storage.objects policy for anon/authenticated/public references the verification-docs bucket');
select is_empty(
  $$ select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'
       and (roles && array['anon', 'authenticated', 'public']::name[]) $$,
  'P2-STO.5 no storage.objects policy exists at all for anon, authenticated or public (RLS default deny)');
select is((select relrowsecurity from pg_class where oid = 'storage.objects'::regclass), true, 'P2-STO.6 RLS is enabled on storage.objects');
select is((select count(*)::int from storage.buckets where public and id = 'verification-docs'), 0, 'P2-STO.7 the verification-docs bucket is not public');

select tt.pg();
select * from finish();
rollback;

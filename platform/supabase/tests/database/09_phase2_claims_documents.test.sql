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

select plan(242);

select tt.fresh_mitra();
select tt.mkuser(n) from unnest(array[
  'tt_a_owner','tt_a_manager','tt_a_staff','tt_a_viewer','tt_rev','tt_rev2','tt_super','tt_ops',
  'tt_d_owner','tt_d_manager','tt_d_staff','tt_d_viewer','tt_d_removed','tt_e_owner','tt_outsider',
  'tt_h_o1','tt_h2_o2','tt_r_dual','tt_r_upload','tt_r_sub','tt_r_edit','tt_v_owner']) n;
select tt.mkuser('tt_d_unconf', false);
select tt.reg('A', tt.mkorg('business', 'Claims Org A', 'tt_a_owner'));
select tt.addm(tt.oid('A'), 'tt_a_manager', 'manager');
select tt.addm(tt.oid('A'), 'tt_a_staff', 'staff');
select tt.addm(tt.oid('A'), 'tt_a_viewer', 'viewer');
select tt.reg('D', tt.mkorg('business', 'Docs Org D', 'tt_d_owner'));
select tt.addm(tt.oid('D'), 'tt_d_manager', 'manager');
select tt.addm(tt.oid('D'), 'tt_d_staff', 'staff');
select tt.addm(tt.oid('D'), 'tt_d_viewer', 'viewer');
select tt.addm(tt.oid('D'), 'tt_d_removed', 'manager');
select tt.addm(tt.oid('D'), 'tt_d_unconf', 'manager');
select tt.reg('E', tt.mkorg('business', 'Cap Org E', 'tt_e_owner'));
select tt.reg('M', tt.mkorg('mitra', 'Claims MITRA', 'tt_super', 'admin_super'));
select tt.addm(tt.oid('M'), 'tt_rev', 'admin_review');
select tt.addm(tt.oid('M'), 'tt_rev2', 'admin_review');
select tt.addm(tt.oid('M'), 'tt_ops', 'admin_ops');
select tt.addm(tt.oid('M'), 'tt_r_dual', 'admin_review');
select tt.addm(tt.oid('M'), 'tt_r_upload', 'admin_review');
select tt.addm(tt.oid('M'), 'tt_r_sub', 'admin_review');
select tt.addm(tt.oid('M'), 'tt_r_edit', 'admin_review');
select tt.addm(tt.oid('D'), 'tt_rev2', 'viewer');   -- reviewer who is also a member of D (conflict)
select tt.pg();
update public.memberships set status = 'removed', removed_at = now() where org_id = tt.oid('D') and user_id = tt.uid('tt_d_removed');

select tt.prof(tt.oid('A'), 'tt_a_owner', tt.std('Alpha Foods', '202001012345'));
select tt.rep(tt.oid('A'), 'tt_a_owner');
select tt.prof(tt.oid('D'), 'tt_d_owner', tt.std('Delta Foods', '201801011111'));
select tt.rep(tt.oid('D'), 'tt_d_owner');
select tt.prof(tt.oid('E'), 'tt_e_owner', tt.std('Echo Foods', '201701012222'));

-- ====================== STATE MACHINE (table driven: 8 states x 4 actions) ======================
select tt.mkdoc('dR', tt.oid('A'), 'tt_a_owner', 'business_registration', 'ssm_certificate');
select tt.mkdoc('dL1', tt.oid('A'), 'tt_a_owner', 'business_location', 'address_proof');
select tt.mkdoc('dL2', tt.oid('A'), 'tt_a_owner', 'business_location', 'business_licence');
select tt.mkdoc('dG', tt.oid('A'), 'tt_a_owner', 'representative_authority', 'authorisation_letter');
select tt.pg();
insert into tt.ids select 'claimR', id from public.verification_claims where org_id = tt.oid('A') and claim_type = 'business_registration';
insert into tt.ids select 'claimL', id from public.verification_claims where org_id = tt.oid('A') and claim_type = 'business_location';
insert into tt.ids select 'claimG', id from public.verification_claims where org_id = tt.oid('A') and claim_type = 'representative_authority';

do $$
declare
  v_status text; v_action text; v_res text; v_exp text; v_bad text := ''; v_n int := 0;
  v_claim uuid := tt.id('claimR');
begin
  foreach v_status in array array['draft','submitted','in_review','needs_info','approved','rejected','stale','withdrawn'] loop
    foreach v_action in array array['submit','withdraw','start_review','decide'] loop
      perform tt.setst(v_claim, v_status::public.claim_status, 3);
      delete from public.verification_claim_documents where claim_id = v_claim;
      insert into public.verification_claim_documents (claim_id, version, document_id) values (v_claim, 3, tt.id('dR'));
      if v_action in ('submit', 'withdraw') then perform tt.act('tt_a_owner'); else perform tt.act('tt_rev', 'aal2'); end if;
      begin
        if v_action = 'submit' then perform public.submit_claim(tt.oid('A'), 'business_registration', array[tt.id('dR')], null);
        elsif v_action = 'withdraw' then perform public.withdraw_claim(v_claim);
        elsif v_action = 'start_review' then perform public.start_review(v_claim);
        else perform public.decide_claim(v_claim, 'approve', 'enough evidence supplied', 3); end if;
        v_res := 'ok';
      exception when others then
        v_res := sqlstate;
      end;
      perform tt.pg();
      v_exp := case v_action
        when 'submit' then case when v_status in ('draft','needs_info','rejected','stale','withdrawn') then 'ok' else 'PT409' end
        when 'withdraw' then case when v_status in ('submitted','in_review','needs_info') then 'ok' else 'PT409' end
        when 'start_review' then case when v_status = 'submitted' then 'ok' else 'PT409' end
        else case when v_status in ('submitted','in_review') then 'ok' else 'PT409' end end;
      v_n := v_n + 1;
      if v_res <> v_exp then v_bad := v_bad || format('%s/%s expected %s got %s; ', v_status, v_action, v_exp, v_res); end if;
    end loop;
  end loop;
  perform set_config('tt.sm_bad', v_bad, true);
  perform set_config('tt.sm_n', v_n::text, true);
end $$;
select is(current_setting('tt.sm_bad'), '', 'P2-SM.1 every legal and illegal transition (8 states x submit/withdraw/start_review/decide) behaves exactly as specified');
select is(current_setting('tt.sm_n')::int, 32, 'P2-SM.2 all 32 state/action combinations were evaluated');

-- ====================== FULL LIFECYCLE on the location claim ======================
select tt.setst(tt.id('claimR'), 'draft', 0);
select tt.act('tt_a_owner');
select is((public.submit_claim(tt.oid('A'), 'business_location', array[tt.id('dL1')], 'first submission') ->> 'version')::int, 1, 'P2-LIFE.1 first submission creates version 1');
select tt.pg();
select is((select status::text from public.verification_claims where id = tt.id('claimL')), 'submitted', 'P2-LIFE.2 claim is submitted');
select is((select count(*)::int from public.verification_events where claim_id = tt.id('claimL') and event = 'submitted'), 1, 'P2-LIFE.3 a submitted event was recorded (first version)');
select is((select snapshot ->> 'postcode' from public.verification_claims where id = tt.id('claimL')), '47500', 'P2-LIFE.4 the snapshot froze the submitted facts');
select is((select count(*)::int from public.audit_log where action = 'verification.submitted' and entity_id = tt.id('claimL')::text), 1, 'P2-LIFE.5 submission is also in audit_log');

-- decision validation (claim is submitted, reviewer is not a member)
select tt.act('tt_rev', 'aal2');
select throws_ok($$ select public.decide_claim(tt.id('claimL'), 'approve', '', 1) $$, 'PT422', 'reason_required', 'P2-DEC.1 empty reason rejected');
select throws_ok($$ select public.decide_claim(tt.id('claimL'), 'approve', 'abcd', 1) $$, 'PT422', 'reason_required', 'P2-DEC.2 4-character reason rejected');
select throws_ok($$ select public.decide_claim(tt.id('claimL'), 'approve', '    ', 1) $$, 'PT422', 'reason_required', 'P2-DEC.3 whitespace-only reason rejected');
select throws_ok($$ select public.decide_claim(tt.id('claimL'), 'approve', repeat('r', 1001), 1) $$, 'PT422', 'reason_required', 'P2-DEC.4 1001-character reason rejected');
select throws_ok($$ select public.decide_claim(tt.id('claimL'), 'approve', E'bad\x01reason', 1) $$, 'PT422', 'reason_required', 'P2-DEC.5 control characters in the reason rejected');
select throws_ok($$ select public.decide_claim(tt.id('claimL'), 'maybe', 'a perfectly fine reason', 1) $$, 'PT422', 'invalid_decision', 'P2-DEC.6 unknown decision rejected');
select throws_ok($$ select public.decide_claim(tt.id('claimL'), 'approve', 'a perfectly fine reason', 7) $$, 'PT409', 'stale_version', 'P2-DEC.7 wrong p_expected_version => stale_version');
select throws_ok($$ select public.decide_claim(tt.id('claimL'), 'approve', 'a perfectly fine reason', null) $$, 'PT409', 'stale_version', 'P2-DEC.8 NULL p_expected_version => stale_version');
select throws_ok($$ select public.decide_claim(gen_random_uuid(), 'approve', 'a perfectly fine reason', 1) $$, 'PT404', null, 'P2-DEC.9 unknown claim => PT404');
select tt.pg();
select is((select status::text from public.verification_claims where id = tt.id('claimL')), 'submitted', 'P2-DEC.10 none of the rejected decisions changed the claim');
select is((select count(*)::int from public.notifications where kind like 'verification.%' and entity_id = tt.id('claimL')::text), 0, 'P2-DEC.11 none of the rejected decisions created a notification');

select tt.act('tt_rev', 'aal2');
select lives_ok($$ select public.start_review(tt.id('claimL')) $$, 'P2-LIFE.6 reviewer starts the review');
select tt.pg();
select is((select reviewer_id from public.verification_claims where id = tt.id('claimL')), tt.uid('tt_rev'), 'P2-LIFE.7 reviewer recorded');
select is((select count(*)::int from public.verification_events where claim_id = tt.id('claimL') and event = 'review_started' and actor_user_id = tt.uid('tt_rev')), 1, 'P2-LIFE.8 review_started event with the reviewer as actor');
select tt.act('tt_rev', 'aal2');
select lives_ok($$ select public.decide_claim(tt.id('claimL'), 'request_info', 'please add a clearer photo', 1) $$, 'P2-LIFE.9 reviewer requests more information');
select tt.pg();
select is((select status::text from public.verification_claims where id = tt.id('claimL')), 'needs_info', 'P2-LIFE.10 claim is needs_info');
select is((select details ->> 'reason' from public.verification_events where claim_id = tt.id('claimL') and event = 'info_requested'), 'please add a clearer photo', 'P2-EVID.1 the decision reason is stored in verification_events');
select is((select details ->> 'version' from public.verification_events where claim_id = tt.id('claimL') and event = 'info_requested'), '1', 'P2-EVID.2 the decided version is stored in the event');
select is((select actor_user_id from public.verification_events where claim_id = tt.id('claimL') and event = 'info_requested'), tt.uid('tt_rev'), 'P2-EVID.3 the reviewer is the event actor');
select is((select count(*)::int from public.audit_log where action = 'verification.info_requested' and entity_id = tt.id('claimL')::text and actor_user_id = tt.uid('tt_rev') and org_id = tt.oid('A')), 1, 'P2-EVID.4 the decision is also written to audit_log with the reviewer as actor');
select is((select array_agg(user_id::text order by user_id::text) from public.notifications where kind = 'verification.info_requested' and entity_id = tt.id('claimL')::text),
  (select array_agg(x order by x) from unnest(array[tt.uid('tt_a_owner')::text, tt.uid('tt_a_manager')::text]) x), 'P2-NOTIF.1 notifications go to the owner and the manager only');
select is((select count(*)::int from public.notifications where user_id in (tt.uid('tt_a_staff'), tt.uid('tt_a_viewer'), tt.uid('tt_rev')) and kind like 'verification.%' and entity_id = tt.id('claimL')::text), 0, 'P2-NOTIF.2 staff, viewer and reviewer get no notification');
select is((select decision_reason from public.verification_claims where id = tt.id('claimL')), 'please add a clearer photo', 'P2-LIFE.11 decision reason stored on the claim');

-- resubmission keeps the history of earlier versions
select tt.act('tt_a_owner');
select is((public.submit_claim(tt.oid('A'), 'business_location', array[tt.id('dL1'), tt.id('dL2')], null) ->> 'version')::int, 2, 'P2-LIFE.12 resubmission after needs_info creates version 2');
select tt.pg();
select is((select count(*)::int from public.verification_events where claim_id = tt.id('claimL') and event = 'resubmitted'), 1, 'P2-LIFE.13 a resubmitted event was recorded');
select is((select count(*)::int from public.verification_claim_documents where claim_id = tt.id('claimL') and version = 1), 1, 'P2-LIFE.14 version 1 keeps its single document');
select is((select count(*)::int from public.verification_claim_documents where claim_id = tt.id('claimL') and version = 2), 2, 'P2-LIFE.15 version 2 has two documents');
select is((select decided_by from public.verification_claims where id = tt.id('claimL')), null, 'P2-LIFE.16 a resubmission clears the previous decision');

select tt.act('tt_rev2', 'aal2');
select throws_ok($$ select public.decide_claim(tt.id('claimL'), 'reject', 'reviewed against version one', 1) $$, 'PT409', 'stale_version', 'P2-DEC.12 deciding on the superseded version 1 => stale_version');
select lives_ok($$ select public.decide_claim(tt.id('claimL'), 'reject', repeat('r', 1000), 2) $$, 'P2-DEC.13 a 1000-character reason is accepted; rejection straight from submitted is allowed');
select tt.pg();
select is((select status::text from public.verification_claims where id = tt.id('claimL')), 'rejected', 'P2-LIFE.17 claim is rejected');
select is((select count(*)::int from public.notifications where kind = 'verification.rejected' and entity_id = tt.id('claimL')::text), 2, 'P2-NOTIF.3 rejection notified the owner and the manager');
select is((select count(*)::int from public.audit_log where action = 'verification.rejected' and entity_id = tt.id('claimL')::text), 1, 'P2-EVID.5 rejection is in audit_log');

select tt.act('tt_a_owner');
select is((public.submit_claim(tt.oid('A'), 'business_location', array[tt.id('dL1')], null) ->> 'version')::int, 3, 'P2-LIFE.18 resubmission after rejection => version 3');
select lives_ok($$ select public.withdraw_claim(tt.id('claimL')) $$, 'P2-LIFE.19 owner withdraws a submitted claim');
select throws_ok($$ select public.withdraw_claim(tt.id('claimL')) $$, 'PT409', 'claim_not_withdrawable', 'P2-LIFE.20 a withdrawn claim cannot be withdrawn again');
select is((public.submit_claim(tt.oid('A'), 'business_location', array[tt.id('dL1')], null) ->> 'version')::int, 4, 'P2-LIFE.21 a withdrawn claim can be resubmitted (version 4)');
select tt.act('tt_rev', 'aal2');
select lives_ok($$ select public.decide_claim(tt.id('claimL'), 'approve', 'abcde', 4) $$, 'P2-DEC.14 a 5-character reason is accepted; approval');
select tt.pg();
select is((select status::text from public.verification_claims where id = tt.id('claimL')), 'approved', 'P2-LIFE.22 claim is approved');
select is((select decided_by from public.verification_claims where id = tt.id('claimL')), tt.uid('tt_rev'), 'P2-LIFE.23 decided_by is the reviewer');
select is((select count(*)::int from public.verification_events where claim_id = tt.id('claimL') and event = 'approved' and details ->> 'reason' = 'abcde'), 1, 'P2-EVID.6 approval event carries the reason');
select tt.act('tt_a_owner');
select throws_ok($$ select public.submit_claim(tt.oid('A'), 'business_location', array[tt.id('dL1')], null) $$, 'PT409', 'claim_not_resubmittable', 'P2-LIFE.24 an approved claim cannot be resubmitted');
select throws_ok($$ select public.withdraw_claim(tt.id('claimL')) $$, 'PT409', 'claim_not_withdrawable', 'P2-LIFE.25 an approved claim cannot be withdrawn');
select tt.act('tt_rev2', 'aal2');
select throws_ok($$ select public.decide_claim(tt.id('claimL'), 'reject', 'changing my mind later', 4) $$, 'PT409', 'claim_not_reviewable', 'P2-LIFE.26 an approved decision cannot be overturned by a second reviewer');

-- L1: the summary of a decided claim, for every member role
select tt.act('tt_a_staff');
select is((select status::text from public.get_verification_summary(tt.oid('A')) where claim_type = 'business_location'), 'approved', 'P2-L1.11 staff sees the approved status in the summary');
select isnt((select decided_at from public.get_verification_summary(tt.oid('A')) where claim_type = 'business_location'), null, 'P2-L1.12 ...and when it was decided');
select tt.act('tt_a_viewer');
select is((select count(*)::int from public.get_verification_summary(tt.oid('A'))), 3, 'P2-L1.13 the summary lists all three claim types of the org');
select tt.act('tt_outsider');
select throws_ok($$ select * from public.get_verification_summary(tt.oid('A')) $$, 'PT403', null, 'P2-L1.14 a non-member is denied');

-- ====================== STALENESS ======================
select tt.pg();
select tt.setst(tt.id('claimR'), 'approved', 1);
select tt.setst(tt.id('claimG'), 'approved', 1);
create table tt.stale_log (n int);
do $$
declare
  r record; v_c record; v_got text; v_bad text := ''; v_n int := 0;
begin
  for r in
    select * from (values
      ('p', '{"business_name":"Alpha Foods Two"}',   'business_registration,representative_authority'),
      ('p', '{"ssm_number":"202002023456"}',         'business_registration'),
      ('p', '{"business_type":"partnership"}',       'business_registration'),
      ('p', '{"state":"Johor"}',                      'business_location'),
      ('p', '{"district":"Klang"}',                   'business_location'),
      ('p', '{"address_line":"9 Jalan Sembilan"}',    'business_location'),
      ('p', '{"postcode":"47999"}',                   'business_location'),
      ('p', '{"description":"new description"}',     ''),
      ('p', '{"contact_phone":"0123456780"}',        ''),
      ('p', '{"contact_email":"other@example.test"}', ''),
      ('p', '{"category_slug":"retail-shop"}',       ''),
      ('r', '{"name":"Rep Changed","role":"owner","email":"rep@example.test","phone":"0123456789"}',  'representative_authority'),
      ('r', '{"name":"Rep Changed","role":"partner","email":"rep@example.test","phone":"0123456789"}', 'representative_authority'),
      ('r', '{"name":"Rep Changed","role":"partner","email":"x@example.test","phone":"0111111111"}',  ''),
      ('p', '{"registration_status":"unregistered"}', 'business_registration')
    ) as t(kind, payload, expected)
  loop
    perform tt.pg();
    update public.verification_claims c set status = 'approved', snapshot = private.claim_snapshot(c.org_id, c.claim_type)
      where c.org_id = tt.oid('A');
    perform tt.act('tt_a_owner');
    if r.kind = 'p' then perform public.save_business_profile(tt.oid('A'), r.payload::jsonb);
    else perform public.save_representative(tt.oid('A'), r.payload::jsonb ->> 'name', r.payload::jsonb ->> 'role', r.payload::jsonb ->> 'email', r.payload::jsonb ->> 'phone'); end if;
    perform tt.pg();
    select coalesce(string_agg(claim_type::text, ',' order by claim_type::text), '') into v_got
      from public.verification_claims where org_id = tt.oid('A') and status = 'stale';
    v_n := v_n + 1;
    if v_got <> r.expected then v_bad := v_bad || format('%s expected [%s] got [%s]; ', r.payload, r.expected, v_got); end if;
  end loop;
  perform set_config('tt.stale_bad', v_bad, true);
  perform set_config('tt.stale_n', v_n::text, true);
end $$;
select is(current_setting('tt.stale_bad'), '', 'P2-STALE.1 editing name / SSM number / business type / location / representative stales exactly the affected approved claims; description, phone, e-mail and category never do');
select is(current_setting('tt.stale_n')::int, 15, 'P2-STALE.2 all 15 edits were evaluated');
select ok((select count(*) from public.verification_events where event = 'marked_stale' and org_id = tt.oid('A') and details ->> 'reason' = 'details_changed' and details ->> 'from' = 'approved') > 5, 'P2-STALE.3 marked_stale events were recorded with from=approved');

-- submitted / in_review are staled too; other states are left alone
select tt.prof(tt.oid('A'), 'tt_a_owner', '{"registration_status":"registered","ssm_number":"202001012345","business_type":"sole_proprietorship","state":"Selangor","district":"Petaling","business_name":"Alpha Foods"}'::jsonb);
do $$
declare
  v_s text; v_bad text := ''; v_after text; v_exp text;
begin
  foreach v_s in array array['draft','submitted','in_review','needs_info','rejected','withdrawn','approved','stale'] loop
    perform tt.pg();
    update public.verification_claims c set status = v_s::public.claim_status, snapshot = private.claim_snapshot(c.org_id, c.claim_type)
      where c.id = tt.id('claimL');
    perform tt.prof(tt.oid('A'), 'tt_a_owner', jsonb_build_object('district', 'D-' || v_s));
    perform tt.pg();
    select status::text into v_after from public.verification_claims where id = tt.id('claimL');
    v_exp := case when v_s in ('submitted', 'in_review', 'approved') then 'stale' else v_s end;
    if v_after <> v_exp then v_bad := v_bad || format('%s expected %s got %s; ', v_s, v_exp, v_after); end if;
  end loop;
  perform set_config('tt.stale2_bad', v_bad, true);
end $$;
select is(current_setting('tt.stale2_bad'), '', 'P2-STALE.4 only submitted, in_review and approved claims go stale on a relevant edit; draft, needs_info, rejected, withdrawn and stale stay as they are');
select tt.act('tt_a_owner');
select lives_ok($$ select public.submit_claim(tt.oid('A'), 'business_location', array[tt.id('dL1')], null) $$, 'P2-STALE.5 a stale claim can be resubmitted');

-- ====================== EVENTS ARE APPEND-ONLY ======================
select tt.pg();
select throws_ok($$ update public.verification_events set event = 'approved' $$, '42501', 'verification_events is append-only', 'P2-EVT.1 postgres UPDATE blocked by trigger');
select throws_ok($$ delete from public.verification_events $$, '42501', 'verification_events is append-only', 'P2-EVT.2 postgres DELETE blocked by trigger');
select throws_ok($$ truncate public.verification_events $$, '42501', 'verification_events is append-only', 'P2-EVT.3 postgres TRUNCATE blocked by trigger');
select tt.act('tt_a_owner');
select throws_ok($$ update public.verification_events set event = 'approved' $$, '42501', null, 'P2-EVT.4 authenticated UPDATE denied');
select throws_ok($$ delete from public.verification_events $$, '42501', null, 'P2-EVT.5 authenticated DELETE denied');
select throws_ok($$ truncate public.verification_events $$, '42501', null, 'P2-EVT.6 authenticated TRUNCATE denied');
select throws_ok($$ insert into public.verification_events (claim_id, org_id, event) values (gen_random_uuid(), gen_random_uuid(), 'approved') $$, '42501', null, 'P2-EVT.7 authenticated cannot forge an event');
select tt.svc();
select throws_ok($$ delete from public.verification_events $$, '42501', null, 'P2-EVT.8 service_role DELETE denied');
select throws_ok($$ truncate public.verification_events $$, '42501', null, 'P2-EVT.9 service_role TRUNCATE denied');

-- ====================== DOCUMENTS: registration rules ======================
select tt.svc();
select throws_ok($$ select public.service_register_document(tt.oid('D'), tt.uid('tt_d_owner'), 'business_registration', 'address_proof', 'n', 'application/pdf', 10, repeat('a', 64), 'p/m1', 'clean', 'e') $$, 'PT422', 'invalid_doc_type', 'P2-DOC.1 registration claim rejects address_proof');
select throws_ok($$ select public.service_register_document(tt.oid('D'), tt.uid('tt_d_owner'), 'business_registration', 'authorisation_letter', 'n', 'application/pdf', 10, repeat('a', 64), 'p/m2', 'clean', 'e') $$, 'PT422', 'invalid_doc_type', 'P2-DOC.2 registration claim rejects authorisation_letter');
select throws_ok($$ select public.service_register_document(tt.oid('D'), tt.uid('tt_d_owner'), 'business_registration', 'other', 'n', 'application/pdf', 10, repeat('a', 64), 'p/m3', 'clean', 'e') $$, 'PT422', 'invalid_doc_type', 'P2-DOC.3 registration claim rejects other');
select throws_ok($$ select public.service_register_document(tt.oid('D'), tt.uid('tt_d_owner'), 'business_location', 'authorisation_letter', 'n', 'application/pdf', 10, repeat('a', 64), 'p/m4', 'clean', 'e') $$, 'PT422', 'invalid_doc_type', 'P2-DOC.4 location claim rejects authorisation_letter');
select throws_ok($$ select public.service_register_document(tt.oid('D'), tt.uid('tt_d_owner'), 'business_location', 'ssm_form', 'n', 'application/pdf', 10, repeat('a', 64), 'p/m5', 'clean', 'e') $$, 'PT422', 'invalid_doc_type', 'P2-DOC.5 location claim rejects ssm_form');
select throws_ok($$ select public.service_register_document(tt.oid('D'), tt.uid('tt_d_owner'), 'representative_authority', 'ssm_certificate', 'n', 'application/pdf', 10, repeat('a', 64), 'p/m6', 'clean', 'e') $$, 'PT422', 'invalid_doc_type', 'P2-DOC.6 representative claim rejects ssm_certificate');
select throws_ok($$ select public.service_register_document(tt.oid('D'), tt.uid('tt_d_owner'), 'representative_authority', 'business_licence', 'n', 'application/pdf', 10, repeat('a', 64), 'p/m7', 'clean', 'e') $$, 'PT422', 'invalid_doc_type', 'P2-DOC.7 representative claim rejects business_licence');
select lives_ok($$ select public.service_register_document(tt.oid('D'), tt.uid('tt_d_owner'), 'business_registration', 'business_licence', 'n', 'application/pdf', 10, repeat('b', 64), 'p/ok1', 'clean', 'e') $$, 'P2-DOC.8 registration + business_licence is accepted');
select lives_ok($$ select public.service_register_document(tt.oid('D'), tt.uid('tt_d_owner'), 'business_location', 'ssm_certificate', 'n', 'image/png', 10, repeat('c', 64), 'p/ok2', 'clean', 'e') $$, 'P2-DOC.9 location + ssm_certificate is accepted');
select lives_ok($$ select public.service_register_document(tt.oid('D'), tt.uid('tt_d_owner'), 'representative_authority', 'other', 'n', 'image/jpeg', 10, repeat('d', 64), 'p/ok3', 'clean', 'e') $$, 'P2-DOC.10 representative + other is accepted');
select throws_ok($$ select public.service_register_document(tt.oid('D'), tt.uid('tt_d_owner'), 'business_registration', 'ssm_certificate', 'n', 'application/pdf', 10, repeat('e', 64), 'p/inf', 'infected', 'e') $$, 'PT422', 'infected_not_stored', 'P2-DOC.11 an infected document can never be registered');
select throws_ok($$ select public.service_register_document(tt.oid('D'), tt.uid('tt_outsider'), 'business_registration', 'ssm_certificate', 'n', 'application/pdf', 10, repeat('f', 64), 'p/o1', 'clean', 'e') $$, 'PT403', null, 'P2-DOC.12 a non-member cannot register documents for the org');
select throws_ok($$ select public.service_register_document(tt.oid('D'), tt.uid('tt_d_viewer'), 'business_registration', 'ssm_certificate', 'n', 'application/pdf', 10, repeat('f', 64), 'p/o2', 'clean', 'e') $$, 'PT403', null, 'P2-DOC.13 a viewer cannot register documents');
select throws_ok($$ select public.service_register_document(tt.oid('D'), tt.uid('tt_d_staff'), 'business_registration', 'ssm_certificate', 'n', 'application/pdf', 10, repeat('f', 64), 'p/o3', 'clean', 'e') $$, 'PT403', null, 'P2-DOC.14 staff cannot register documents');
select throws_ok($$ select public.service_register_document(tt.oid('D'), tt.uid('tt_d_removed'), 'business_registration', 'ssm_certificate', 'n', 'application/pdf', 10, repeat('f', 64), 'p/o4', 'clean', 'e') $$, 'PT403', null, 'P2-DOC.15 a removed manager cannot register documents');
select throws_ok($$ select public.service_register_document(tt.oid('A'), tt.uid('tt_d_owner'), 'business_registration', 'ssm_certificate', 'n', 'application/pdf', 10, repeat('f', 64), 'p/o5', 'clean', 'e') $$, 'PT403', null, 'P2-DOC.16 an owner of org D cannot register documents for org A');
select throws_ok($$ select public.service_register_document(tt.oid('D'), tt.uid('tt_d_owner'), 'business_registration', 'ssm_certificate', 'n', 'text/html', 10, repeat('f', 64), 'p/bad1', 'clean', 'e') $$, '23514', null, 'P2-DOC.17 a non-whitelisted MIME type violates the table constraint');
select throws_ok($$ select public.service_register_document(tt.oid('D'), tt.uid('tt_d_owner'), 'business_registration', 'ssm_certificate', 'n', 'application/pdf', 0, repeat('f', 64), 'p/bad2', 'clean', 'e') $$, '23514', null, 'P2-DOC.18 a 0-byte document is rejected');
select throws_ok($$ select public.service_register_document(tt.oid('D'), tt.uid('tt_d_owner'), 'business_registration', 'ssm_certificate', 'n', 'application/pdf', 10485761, repeat('f', 64), 'p/bad3', 'clean', 'e') $$, '23514', null, 'P2-DOC.19 a document of 10 MiB + 1 byte is rejected');
select throws_ok($$ select public.service_register_document(tt.oid('D'), tt.uid('tt_d_owner'), 'business_registration', 'ssm_certificate', 'n', 'application/pdf', 10, 'xyz', 'p/bad4', 'clean', 'e') $$, '23514', null, 'P2-DOC.20 a malformed sha256 is rejected');
select throws_ok($$ select public.service_register_document(tt.oid('D'), tt.uid('tt_d_owner'), 'business_registration', 'ssm_certificate', E'bad\nname', 'application/pdf', 10, repeat('f', 64), 'p/bad5', 'clean', 'e') $$, 'PT422', 'invalid_name', 'P2-DOC.21 a control character in the display name is rejected');
select throws_ok($$ select public.service_register_document(tt.oid('D'), tt.uid('tt_d_owner'), 'business_registration', 'ssm_certificate', '   ', 'application/pdf', 10, repeat('f', 64), 'p/bad6', 'clean', 'e') $$, 'PT422', 'invalid_name', 'P2-DOC.22 an empty display name is rejected');
select throws_ok($$ select public.service_register_document(tt.oid('D'), tt.uid('tt_d_owner'), 'business_registration', 'ssm_certificate', 'n', 'application/pdf', 10, repeat('f', 64), 'p/ok1', 'clean', 'e') $$, '23505', null, 'P2-DOC.23 a storage path can be registered only once');
select tt.pg();
select is((select scan_status::text from public.verification_documents where storage_path = 'p/ok1'), 'clean', 'P2-DOC.24 registered with the scan status given by the server');

-- attach rules
select tt.mkdoc('dOk1', tt.oid('D'), 'tt_d_owner', 'business_registration', 'ssm_certificate');
select tt.mkdoc('dOk2', tt.oid('D'), 'tt_d_owner', 'business_registration', 'ssm_form');
select tt.mkdoc('dOk3', tt.oid('D'), 'tt_d_owner', 'business_registration', 'business_licence');
select tt.mkdoc('dOk4', tt.oid('D'), 'tt_d_owner', 'business_registration', 'ssm_certificate');
select tt.mkdoc('dOk5', tt.oid('D'), 'tt_d_owner', 'business_registration', 'ssm_certificate');
select tt.mkdoc('dOk6', tt.oid('D'), 'tt_d_owner', 'business_registration', 'ssm_certificate');
select tt.mkdoc('dPend', tt.oid('D'), 'tt_d_owner', 'business_registration', 'ssm_certificate', 'pending');
select tt.mkdoc('dFail', tt.oid('D'), 'tt_d_owner', 'business_registration', 'ssm_certificate', 'failed');
select tt.mkdoc('dRem', tt.oid('D'), 'tt_d_owner', 'business_registration', 'ssm_certificate');
select tt.mkdoc('dLoc', tt.oid('D'), 'tt_d_owner', 'business_location', 'address_proof');
select tt.mkdoc('dEdoc', tt.oid('E'), 'tt_e_owner', 'business_registration', 'ssm_certificate');
select tt.act('tt_d_owner');
select lives_ok($$ select public.remove_document(tt.id('dRem')) $$, 'P2-ATT.0 owner removes an unattached document');
select throws_ok($$ select public.submit_claim(tt.oid('D'), 'business_registration', array[tt.id('dPend')], null) $$, 'PT409', 'documents_not_ready', 'P2-ATT.1 a pending document cannot be attached');
select throws_ok($$ select public.submit_claim(tt.oid('D'), 'business_registration', array[tt.id('dFail')], null) $$, 'PT409', 'documents_not_ready', 'P2-ATT.2 a failed-scan document cannot be attached');
select throws_ok($$ select public.submit_claim(tt.oid('D'), 'business_registration', array[tt.id('dRem')], null) $$, 'PT409', 'documents_not_ready', 'P2-ATT.3 a removed document cannot be attached');
select throws_ok($$ select public.submit_claim(tt.oid('D'), 'business_registration', array[tt.id('dLoc')], null) $$, 'PT409', 'documents_not_ready', 'P2-ATT.4 a document of another claim of the same org cannot be attached');
select throws_ok($$ select public.submit_claim(tt.oid('D'), 'business_registration', array[tt.id('dEdoc')], null) $$, 'PT409', 'documents_not_ready', 'P2-ATT.5 a document of another organisation cannot be attached');
select throws_ok($$ select public.submit_claim(tt.oid('D'), 'business_registration', array[tt.id('dOk1'), tt.id('dPend')], null) $$, 'PT409', 'documents_not_ready', 'P2-ATT.6 one bad document among good ones blocks the whole submission');
select throws_ok($$ select public.submit_claim(tt.oid('D'), 'business_registration', array[gen_random_uuid()], null) $$, 'PT409', 'documents_not_ready', 'P2-ATT.7 an unknown document id cannot be attached');
select throws_ok($$ select public.submit_claim(tt.oid('D'), 'business_registration', array[]::uuid[], null) $$, 'PT422', 'document_count', 'P2-ATT.8 at least one document is required');
select throws_ok($$ select public.submit_claim(tt.oid('D'), 'business_registration', null, null) $$, 'PT422', 'document_count', 'P2-ATT.9 NULL document list rejected');
select throws_ok($$ select public.submit_claim(tt.oid('D'), 'business_registration', array[tt.id('dOk1'), tt.id('dOk2'), tt.id('dOk3'), tt.id('dOk4'), tt.id('dOk5'), tt.id('dOk6')], null) $$, 'PT422', 'document_count', 'P2-ATT.10 more than 5 documents per submission rejected');
select throws_ok($$ select public.submit_claim(tt.oid('D'), 'business_registration', array[tt.id('dOk1')], repeat('n', 1001)) $$, 'PT422', 'invalid_note', 'P2-ATT.11 owner note longer than 1000 characters rejected');
select lives_ok($$ select public.submit_claim(tt.oid('D'), 'business_registration', array[tt.id('dOk1'), tt.id('dOk2'), tt.id('dOk3'), tt.id('dOk4'), tt.id('dOk5')], null) $$, 'P2-ATT.12 exactly 5 clean documents are accepted');
select throws_ok($$ select public.remove_document(tt.id('dOk1')) $$, 'PT409', 'document_in_use', 'P2-ATT.13 a document attached to a submitted version cannot be removed');
select tt.pg();
select tt.setst((select claim_id from public.verification_documents where id = tt.id('dOk1')), 'approved');
select tt.act('tt_d_owner');
select throws_ok($$ select public.remove_document(tt.id('dOk1')) $$, 'PT409', 'document_in_use', 'P2-ATT.14 ...nor once the claim is decided');
select lives_ok($$ select public.remove_document(tt.id('dOk6')) $$, 'P2-ATT.15 an unattached document can be removed');
select throws_ok($$ select public.remove_document(tt.id('dOk6')) $$, 'PT404', null, 'P2-ATT.16 removing twice => PT404');
select tt.act('tt_d_staff');
select throws_ok($$ select public.remove_document(tt.id('dLoc')) $$, 'PT403', null, 'P2-ATT.17 staff cannot remove documents');
select tt.act('tt_d_viewer');
select throws_ok($$ select public.remove_document(tt.id('dLoc')) $$, 'PT403', null, 'P2-ATT.18 viewers cannot remove documents');
select tt.pg();
select is((select count(*)::int from public.verification_events where event = 'document_removed' and org_id = tt.oid('D')), 2, 'P2-ATT.19 each removal wrote a document_removed event');

-- ====================== DOCUMENT ACCESS ======================
select tt.pg();
select tt.setst((select claim_id from public.verification_documents where id = tt.id('dOk1')), 'submitted');
create function tt.views(p_doc text) returns int language sql stable as $$
  select count(*)::int from public.verification_events where event = 'document_viewed' and details ->> 'document_id' = tt.id(p_doc)::text $$;
create function tt.view_audit(p_doc text) returns int language sql stable as $$
  select count(*)::int from public.audit_log where action = 'verification.document_viewed' and entity_id = tt.id(p_doc)::text $$;
select is(tt.views('dOk1'), 0, 'P2-ACC.0 no views logged yet');
select tt.act('tt_d_owner');
select is(public.get_document_access(tt.id('dOk1')) ->> 'mime_type', 'application/pdf', 'P2-ACC.1 owner may access an attached clean document');
select ok((public.get_document_access(tt.id('dOk1')) ->> 'storage_path') like 'tt/%', 'P2-ACC.2 the storage path is returned to the (server-side) caller');
select tt.act('tt_d_manager');
select lives_ok($$ select public.get_document_access(tt.id('dOk1')) $$, 'P2-ACC.3 manager may access');
select tt.pg();
select is(tt.views('dOk1'), 3, 'P2-ACC.4 every successful access wrote a document_viewed event (3 accesses)');
select is(tt.view_audit('dOk1'), 3, 'P2-ACC.5 ...and an audit_log row');
select is((select count(*)::int from public.verification_events where event = 'document_viewed' and actor_user_id = tt.uid('tt_d_manager')), 1, 'P2-ACC.6 the event actor is the viewer');
select tt.act('tt_d_staff');
select throws_ok($$ select public.get_document_access(tt.id('dOk1')) $$, 'PT404', null, 'P2-ACC.7 staff denied');
select tt.act('tt_d_viewer');
select throws_ok($$ select public.get_document_access(tt.id('dOk1')) $$, 'PT404', null, 'P2-ACC.8 viewer denied');
select tt.act('tt_e_owner');
select throws_ok($$ select public.get_document_access(tt.id('dOk1')) $$, 'PT404', null, 'P2-ACC.9 another organisation''s owner denied');
select tt.act('tt_d_removed');
select throws_ok($$ select public.get_document_access(tt.id('dOk1')) $$, 'PT404', null, 'P2-ACC.10 a removed manager denied');
select tt.act('tt_outsider');
select throws_ok($$ select public.get_document_access(tt.id('dOk1')) $$, 'PT404', null, 'P2-ACC.11 a user with no membership denied');
select tt.anon();
select throws_ok($$ select public.get_document_access(tt.id('dOk1')) $$, '42501', null, 'P2-ACC.12 anon denied');
select tt.act('tt_rev', 'aal1');
select throws_ok($$ select public.get_document_access(tt.id('dOk1')) $$, 'PT404', null, 'P2-ACC.13 reviewer at aal1 denied');
select tt.act('tt_ops', 'aal2');
select throws_ok($$ select public.get_document_access(tt.id('dOk1')) $$, 'PT404', null, 'P2-ACC.14 admin_ops denied');
select tt.act('tt_rev2', 'aal2');
select throws_ok($$ select public.get_document_access(tt.id('dOk1')) $$, 'PT404', null, 'P2-ACC.15 a reviewer who is a member of the org is denied (conflict)');
select tt.act('tt_rev', 'aal2');
select lives_ok($$ select public.get_document_access(tt.id('dOk1')) $$, 'P2-ACC.16 a non-conflicted reviewer at aal2 may access an attached document of a submitted claim');
select throws_ok($$ select public.get_document_access(tt.id('dLoc')) $$, 'PT404', null, 'P2-ACC.17 reviewers cannot access a clean document that is not attached to a submitted version');
select tt.pg();
select tt.setst((select claim_id from public.verification_documents where id = tt.id('dOk1')), 'withdrawn');
select tt.act('tt_rev', 'aal2');
select throws_ok($$ select public.get_document_access(tt.id('dOk1')) $$, 'PT404', null, 'P2-ACC.18 reviewers lose access when the claim is withdrawn');
select tt.pg();
select tt.setst((select claim_id from public.verification_documents where id = tt.id('dOk1')), 'needs_info');
select tt.act('tt_rev', 'aal2');
select lives_ok($$ select public.get_document_access(tt.id('dOk1')) $$, 'P2-ACC.19 reviewers keep access in needs_info');
select tt.pg();
select is(tt.views('dOk1'), 5, 'P2-ACC.20 denied attempts wrote nothing: only the 5 successful accesses are logged');
select tt.act('tt_d_owner');
select throws_ok($$ select public.get_document_access(tt.id('dPend')) $$, 'PT403', 'document_not_available', 'P2-ACC.21 a pending document is not served, even to its owner');
select throws_ok($$ select public.get_document_access(tt.id('dFail')) $$, 'PT403', 'document_not_available', 'P2-ACC.22 a failed-scan document is not served');
select throws_ok($$ select public.get_document_access(tt.id('dRem')) $$, 'PT403', 'document_not_available', 'P2-ACC.23 a removed document is not served');
select throws_ok($$ select public.get_document_access(gen_random_uuid()) $$, 'PT404', null, 'P2-ACC.24 unknown document => PT404');
select tt.pg();
select is(tt.views('dPend') + tt.views('dFail') + tt.views('dRem'), 0, 'P2-ACC.25 refused accesses are not logged as views');

-- scan results (service only)
select tt.svc();
select lives_ok($$ select public.service_set_scan_result(tt.id('dPend'), 'clean', 'tt-clamd') $$, 'P2-SCAN.1 a pending document becomes clean');
select throws_ok($$ select public.service_set_scan_result(tt.id('dPend'), 'failed', 'tt-clamd') $$, 'PT409', 'already_scanned', 'P2-SCAN.2 a clean document cannot become failed');
select lives_ok($$ select public.service_set_scan_result(tt.id('dFail'), 'clean', 'tt-clamd') $$, 'P2-SCAN.3 a failed-scan document can be rescanned to clean');
select throws_ok($$ select public.service_set_scan_result(tt.id('dPend'), 'pending', 'x') $$, 'PT422', 'invalid_status', 'P2-SCAN.4 pending can never be set, not even on a clean document');
select throws_ok($$ select public.service_set_scan_result(tt.id('dPend'), 'clean', 'x') $$, 'PT409', 'already_scanned', 'P2-SCAN.4b clean -> clean is refused (no silent re-labelling)');
select throws_ok($$ select public.service_set_scan_result(gen_random_uuid(), 'clean', 'x') $$, 'PT404', null, 'P2-SCAN.5 unknown document => PT404');
select tt.pg();
select tt.mkdoc('dPend2', tt.oid('D'), 'tt_d_owner', 'business_registration', 'ssm_certificate', 'pending');
select tt.svc();
select throws_ok($$ select public.service_set_scan_result(tt.id('dPend2'), 'pending', 'x') $$, 'PT422', 'invalid_status', 'P2-SCAN.6 cannot set the status back to pending');
select lives_ok($$ select public.service_set_scan_result(tt.id('dPend2'), 'infected', 'tt-clamd') $$, 'P2-SCAN.7 a pending document can be marked infected');
select tt.act('tt_d_owner');
select throws_ok($$ select public.get_document_access(tt.id('dPend2')) $$, 'PT403', 'document_not_available', 'P2-SCAN.8 an infected document is never served');
select throws_ok($$ select public.submit_claim(tt.oid('D'), 'business_registration', array[tt.id('dPend2')], null) $$, 'PT409', null, 'P2-SCAN.9 an infected document can never be attached');
select lives_ok($$ select public.get_document_access(tt.id('dPend')) $$, 'P2-SCAN.10 after a clean scan the owner can access the document');
select tt.pg();
select is((select count(*)::int from public.verification_events where event = 'scan_result' and org_id = tt.oid('D')), 3, 'P2-SCAN.11 every scan result wrote a scan_result event (clean, clean, infected)');
select tt.svc();
select is((select count(*)::int from public.service_list_unscanned_documents(100) where id in (tt.id('dPend'), tt.id('dFail'), tt.id('dPend2'), tt.id('dOk1'), tt.id('dRem'))), 0, 'P2-SCAN.12 the unscanned list excludes clean, infected and removed documents');
select tt.pg();
update public.verification_documents set removed_at = now() where scan_status in ('pending', 'failed') and removed_at is null and org_id <> tt.oid('D');
select tt.mkdoc('dPend3', tt.oid('D'), 'tt_d_owner', 'business_registration', 'ssm_certificate', 'pending');
select tt.mkdoc('dFail3', tt.oid('D'), 'tt_d_owner', 'business_registration', 'ssm_certificate', 'failed');
select tt.svc();
select ok((select array_agg(id order by id) from public.service_list_unscanned_documents(100) where id in (tt.id('dPend3'), tt.id('dFail3'))) = (select array_agg(x order by x) from unnest(array[tt.id('dPend3'), tt.id('dFail3')]) x), 'P2-SCAN.13 the unscanned list contains pending and failed documents');
select ok((select count(*) from public.service_list_unscanned_documents(0)) <= 1, 'P2-SCAN.14 a limit of 0 is clamped to 1');
select ok((select count(*) from public.service_list_unscanned_documents(1)) <= 1, 'P2-SCAN.15 a limit of 1 returns at most one row');

-- queue fairness: a document whose scan failed (stamped) sorts behind never-attempted ones
select tt.pg();
update public.verification_documents set removed_at = now() where scan_status in ('pending', 'failed') and removed_at is null and org_id <> tt.oid('D');
select tt.mkdoc('qA', tt.oid('D'), 'tt_d_owner', 'business_registration', 'ssm_certificate', 'pending');
select tt.mkdoc('qB', tt.oid('D'), 'tt_d_owner', 'business_registration', 'ssm_certificate', 'pending');
select tt.mkdoc('qC', tt.oid('D'), 'tt_d_owner', 'business_registration', 'ssm_certificate', 'pending');
update public.verification_documents set created_at = now() - interval '3 days' where id = tt.id('qA');
update public.verification_documents set created_at = now() - interval '2 days' where id = tt.id('qB');
update public.verification_documents set created_at = now() - interval '1 day' where id = tt.id('qC');
update public.verification_documents set created_at = now() - interval '10 days' where id in (tt.id('dPend3'), tt.id('dFail3'));
update public.verification_documents set scanned_at = now() - interval '9 days' where id in (tt.id('dPend3'), tt.id('dFail3'));
select tt.svc();
select is((select array_agg(s.id) from (select id from public.service_list_unscanned_documents(100)) s where s.id in (tt.id('qA'), tt.id('qB'), tt.id('qC'))),
  array[tt.id('qA'), tt.id('qB'), tt.id('qC')], 'P2-QUEUE.1 never-attempted documents are listed oldest first');
select lives_ok($$ select public.service_set_scan_result(tt.id('qA'), 'failed', 'storage') $$, 'P2-QUEUE.2 a failed attempt can be stamped on a pending document');
select is((select array_agg(s.id) from (select id from public.service_list_unscanned_documents(100)) s where s.id in (tt.id('qA'), tt.id('qB'), tt.id('qC'))),
  array[tt.id('qB'), tt.id('qC'), tt.id('qA')], 'P2-QUEUE.3 the stamped document moved behind the never-attempted ones');
select lives_ok($$ select public.service_set_scan_result(tt.id('qA'), 'failed', 'storage') $$, 'P2-QUEUE.4 failed -> failed (another unsuccessful retry) is allowed');
select is((select count(*)::int from public.service_list_unscanned_documents(100) where id = tt.id('qA')), 1, 'P2-QUEUE.5 a failed document stays in the queue (it is retried)');
select tt.pg();

-- clean -> infected is the one allowed change from a final state
select tt.svc();
select lives_ok($$ select public.service_set_scan_result(tt.id('dFail'), 'infected', 'tt-av2') $$, 'P2-SCAN.16 a clean document can later be flagged infected');
select tt.pg();
select is((select scan_status::text from public.verification_documents where id = tt.id('dFail')), 'infected', 'P2-SCAN.17 the document is now infected');
select is((select details ->> 'previous' from public.verification_events where event = 'scan_result' and details ->> 'document_id' = tt.id('dFail')::text order by id desc limit 1), 'clean', 'P2-SCAN.18 the scan_result event records previous = clean');
select is((select details ->> 'previous' from public.verification_events where event = 'scan_result' and details ->> 'document_id' = tt.id('dFail')::text order by id asc limit 1), 'failed', 'P2-SCAN.19 the earlier failed -> clean event recorded previous = failed');
select is((select details ->> 'scan_status' from public.verification_events where event = 'scan_result' and details ->> 'document_id' = tt.id('dFail')::text order by id desc limit 1), 'infected', 'P2-SCAN.20 and the new status');
select tt.act('tt_d_owner');
select throws_ok($$ select public.get_document_access(tt.id('dFail')) $$, 'PT403', 'document_not_available', 'P2-SCAN.21 access is denied immediately after a clean document is flagged infected');
select tt.svc();
select throws_ok($$ select public.service_set_scan_result(tt.id('dFail'), 'clean', 'x') $$, 'PT409', 'already_scanned', 'P2-SCAN.22 infected -> clean is refused');
select throws_ok($$ select public.service_set_scan_result(tt.id('dFail'), 'failed', 'x') $$, 'PT409', 'already_scanned', 'P2-SCAN.23 infected -> failed is refused');
select throws_ok($$ select public.service_set_scan_result(tt.id('dFail'), 'infected', 'x') $$, 'PT409', 'already_scanned', 'P2-SCAN.24 infected -> infected is refused');
select throws_ok($$ select public.service_set_scan_result(tt.id('dFail'), 'pending', 'x') $$, 'PT422', 'invalid_status', 'P2-SCAN.25 nothing can be set back to pending');
select tt.act('tt_d_owner');
select throws_ok($$ select public.service_set_scan_result(tt.id('dOk2'), 'infected', 'forged') $$, '42501', null, 'P2-SCAN.26 a user cannot flag (or clear) documents');

-- reviewer document metadata is limited to attached documents
select tt.act('tt_rev', 'aal2');
select is((select count(*)::int from public.verification_documents where id = tt.id('dLoc')), 0, 'P2-REVDOC.1 a reviewer sees 0 rows for a draft (unattached) document');
select is((select count(*)::int from public.verification_documents where id = tt.id('dOk1')), 1, 'P2-REVDOC.2 a reviewer sees a document attached to a submitted version');
select is((select count(*)::int from public.verification_documents where org_id = tt.oid('D') and id not in (select document_id from public.verification_claim_documents)), 0, 'P2-REVDOC.3 a reviewer sees no unattached document of org D at all');
select tt.act('tt_d_owner');
select is((select count(*)::int from public.verification_documents where id = tt.id('dLoc')), 1, 'P2-REVDOC.4 control: the owner side sees its draft document');

-- recipients
select tt.svc();
select is(public.service_org_recipient_emails(tt.oid('D')), array['tt_d_manager@example.test', 'tt_d_owner@example.test'],
  'P2-REC.1 recipients are confirmed, active owners and managers only (no staff, viewer, unconfirmed or removed member), lower-cased and distinct');
select is(public.service_org_recipient_emails(gen_random_uuid()), array[]::text[], 'P2-REC.2 unknown org => empty list');

-- rejected uploads
select lives_ok($$ select public.service_record_rejected_upload(tt.oid('D'), tt.uid('tt_d_owner'), 'business_registration', 'infected', repeat('a', 64)) $$, 'P2-REJ.1 an infected upload leaves an audit trace');
select tt.pg();
select is((select count(*)::int from public.audit_log where action = 'verification.upload_rejected' and actor_user_id = tt.uid('tt_d_owner') and source = 'app-server' and details ->> 'reason' = 'infected' and org_id = tt.oid('D')), 1, 'P2-REJ.2 audit row has the reason, org, actor and source app-server');
select is((select count(*)::int from public.verification_documents where sha256 = repeat('a', 64)), 0, 'P2-REJ.3 nothing is stored for a rejected upload');
select tt.svc();
select lives_ok($$ select public.service_record_rejected_upload(tt.oid('D'), tt.uid('tt_d_owner'), 'business_registration', 'bad_type', null) $$, 'P2-REJ.4 a NULL hash is allowed');
select throws_ok($$ select public.service_record_rejected_upload(tt.oid('D'), tt.uid('tt_d_owner'), 'business_registration', 'because', null) $$, 'PT422', 'invalid_reason', 'P2-REJ.5 free-text reasons rejected');
select throws_ok($$ select public.service_record_rejected_upload(tt.oid('D'), tt.uid('tt_d_owner'), 'business_registration', 'empty', 'zz') $$, 'PT422', 'invalid_hash', 'P2-REJ.6 malformed hash rejected');
select throws_ok($$ select public.service_record_rejected_upload(tt.oid('D'), gen_random_uuid(), 'business_registration', 'empty', null) $$, 'PT404', 'unknown_user', 'P2-REJ.7 unknown user rejected');

-- 50 documents per organisation
select tt.pg();
do $$
declare v_i int;
begin
  for v_i in 1..49 loop
    perform public.service_register_document(tt.oid('E'), tt.uid('tt_e_owner'), 'business_registration', 'ssm_certificate', 'cap ' || v_i,
      'application/pdf', 10, encode(sha256(convert_to('cap' || v_i, 'UTF8')), 'hex'), 'cap/' || gen_random_uuid()::text, 'clean', 'e');
  end loop;
end $$;
select is((select count(*)::int from public.verification_documents where org_id = tt.oid('E') and removed_at is null), 50, 'P2-CAP.0 org E now holds 50 active documents');
select tt.svc();
select throws_ok($$ select public.service_register_document(tt.oid('E'), tt.uid('tt_e_owner'), 'business_registration', 'ssm_certificate', 'n', 'application/pdf', 10, repeat('9', 64), 'cap/over', 'clean', 'e') $$, 'PT409', 'document_limit_reached', 'P2-CAP.1 the 51st document is refused');
select tt.act('tt_e_owner');
select lives_ok($$ select public.remove_document(tt.id('dEdoc')) $$, 'P2-CAP.2 removing a document frees a slot...');
select tt.svc();
select lives_ok($$ select public.service_register_document(tt.oid('E'), tt.uid('tt_e_owner'), 'business_registration', 'ssm_certificate', 'n', 'application/pdf', 10, repeat('9', 64), 'cap/over', 'clean', 'e') $$, 'P2-CAP.3 ...and the registration then succeeds');
select tt.act('tt_d_owner');


-- ====================== H1: conflict of interest is permanent ======================
select tt.pg();
select tt.reg('H', tt.mkorg('business', 'Conflict Org H', 'tt_h_o1'));
select tt.prof(tt.oid('H'), 'tt_h_o1', tt.std('Hotel Foods', '201501014444'));
select tt.rep(tt.oid('H'), 'tt_h_o1');
-- (a) a reviewer who ONLY uploaded a document: member briefly, then the membership row is deleted
select tt.addm(tt.oid('H'), 'tt_r_upload', 'manager');
select tt.mkdoc('hLoc', tt.oid('H'), 'tt_r_upload', 'business_location', 'address_proof');
delete from public.memberships where org_id = tt.oid('H') and user_id = tt.uid('tt_r_upload');
-- the owner submits the registration claim
select tt.mkdoc('hReg', tt.oid('H'), 'tt_h_o1', 'business_registration', 'ssm_certificate');
select tt.act('tt_h_o1');
insert into tt.ids select 'claimH', (public.submit_claim(tt.oid('H'), 'business_registration', array[tt.id('hReg')], null) ->> 'claim_id')::uuid;
-- (b) a reviewer who is only 'submitted_by' on a claim (no membership afterwards)
select tt.pg();
select tt.addm(tt.oid('H'), 'tt_r_sub', 'manager');
select tt.mkdoc('hRep', tt.oid('H'), 'tt_r_sub', 'representative_authority', 'authorisation_letter');
select tt.act('tt_r_sub');
insert into tt.ids select 'claimHRep', (public.submit_claim(tt.oid('H'), 'representative_authority', array[tt.id('hRep')], null) ->> 'claim_id')::uuid;
select tt.pg();
delete from public.memberships where org_id = tt.oid('H') and user_id = tt.uid('tt_r_sub');
-- (c) a reviewer who only edited the profile (business_profiles.updated_by), no membership afterwards
select tt.addm(tt.oid('H'), 'tt_r_edit', 'manager');
select tt.act('tt_r_edit');
select public.save_business_profile(tt.oid('H'), '{"description":"last edit by a future reviewer"}'::jsonb);
select tt.pg();
delete from public.memberships where org_id = tt.oid('H') and user_id = tt.uid('tt_r_edit');
select is((select updated_by from public.business_profiles where org_id = tt.oid('H')), tt.uid('tt_r_edit'), 'P2-H1.0 (setup check) the last profile editor is the future reviewer');
select is((select count(*)::int from public.memberships where org_id = tt.oid('H') and user_id in (tt.uid('tt_r_upload'), tt.uid('tt_r_sub'), tt.uid('tt_r_edit'))), 0, 'P2-H1.0b (setup check) none of the three has any membership row');

select tt.act('tt_r_upload', 'aal2');
select throws_ok($$ select public.start_review(tt.id('claimH')) $$, 'PT403', 'conflict_of_interest', 'P2-H1.1 uploader-only: start_review refused');
select throws_ok($$ select public.decide_claim(tt.id('claimH'), 'approve', 'deciding on my own upload', 1) $$, 'PT403', 'conflict_of_interest', 'P2-H1.2 uploader-only: decide refused');
select throws_ok($$ select public.get_document_access(tt.id('hReg')) $$, 'PT404', null, 'P2-H1.3 uploader-only: document access refused');
select tt.act('tt_r_sub', 'aal2');
select throws_ok($$ select public.start_review(tt.id('claimH')) $$, 'PT403', 'conflict_of_interest', 'P2-H1.4 submitted_by-only: start_review refused');
select throws_ok($$ select public.decide_claim(tt.id('claimH'), 'approve', 'deciding on my own claim', 1) $$, 'PT403', 'conflict_of_interest', 'P2-H1.5 submitted_by-only: decide refused');
select throws_ok($$ select public.get_document_access(tt.id('hReg')) $$, 'PT404', null, 'P2-H1.6 submitted_by-only: document access refused');
select tt.act('tt_r_edit', 'aal2');
select throws_ok($$ select public.start_review(tt.id('claimH')) $$, 'PT403', 'conflict_of_interest', 'P2-H1.7 profile-editor-only: start_review refused');
select throws_ok($$ select public.decide_claim(tt.id('claimH'), 'approve', 'deciding on my own edits', 1) $$, 'PT403', 'conflict_of_interest', 'P2-H1.8 profile-editor-only: decide refused');
select throws_ok($$ select public.get_document_access(tt.id('hReg')) $$, 'PT404', null, 'P2-H1.9 profile-editor-only: document access refused');

-- (d) reviewer AND owner of the org, submits, adds a second owner, then leaves
select tt.pg();
select tt.reg('H2', tt.mkorg('business', 'Conflict Org H2', 'tt_r_dual'));
select tt.prof(tt.oid('H2'), 'tt_r_dual', tt.std('Hotel Two Foods', '201401015555'));
select tt.mkdoc('h2Reg', tt.oid('H2'), 'tt_r_dual', 'business_registration', 'ssm_certificate');
select tt.act('tt_r_dual');
insert into tt.ids select 'claimH2', (public.submit_claim(tt.oid('H2'), 'business_registration', array[tt.id('h2Reg')], null) ->> 'claim_id')::uuid;
select tt.pg();
select tt.addm(tt.oid('H2'), 'tt_h2_o2', 'owner');
update public.memberships set status = 'removed', removed_at = now() where org_id = tt.oid('H2') and user_id = tt.uid('tt_r_dual');
select tt.act('tt_r_dual', 'aal2');
select throws_ok($$ select public.start_review(tt.id('claimH2')) $$, 'PT403', 'conflict_of_interest', 'P2-H1.10 former owner who submitted: start_review refused');
select throws_ok($$ select public.decide_claim(tt.id('claimH2'), 'approve', 'approving my own submission', 1) $$, 'PT403', 'conflict_of_interest', 'P2-H1.11 former owner who submitted: decide refused');
select throws_ok($$ select public.get_document_access(tt.id('h2Reg')) $$, 'PT404', null, 'P2-H1.12 former owner who submitted: document access refused');
select tt.pg();
select is((select status::text from public.verification_claims where id = tt.id('claimH2')), 'submitted', 'P2-H1.13 none of the refused attempts changed the claim');
select is((select count(*)::int from public.verification_events where claim_id in (tt.id('claimH'), tt.id('claimH2')) and event in ('review_started', 'approved', 'document_viewed')), 0, 'P2-H1.14 and none wrote an event');
-- an uninvolved reviewer works normally
select tt.act('tt_rev', 'aal2');
select lives_ok($$ select public.start_review(tt.id('claimH')) $$, 'P2-H1.15 an uninvolved reviewer can start the review');
select lives_ok($$ select public.get_document_access(tt.id('hReg')) $$, 'P2-H1.16 ...open the documents');
select lives_ok($$ select public.decide_claim(tt.id('claimH'), 'approve', 'uninvolved reviewer approves', 1) $$, 'P2-H1.17 ...and decide');

-- ====================== M1: approve needs the attached evidence to still be clean ======================
select tt.pg();
select tt.reg('V', tt.mkorg('business', 'Evidence Org V', 'tt_v_owner'));
select tt.prof(tt.oid('V'), 'tt_v_owner', tt.std('Victor Foods', '201301016666'));
select tt.mkdoc('vD1', tt.oid('V'), 'tt_v_owner', 'business_registration', 'ssm_certificate');
select tt.mkdoc('vD2', tt.oid('V'), 'tt_v_owner', 'business_registration', 'ssm_form');
select tt.act('tt_v_owner');
insert into tt.ids select 'claimV', (public.submit_claim(tt.oid('V'), 'business_registration', array[tt.id('vD1'), tt.id('vD2')], null) ->> 'claim_id')::uuid;
select tt.pg();
create function tt.reset_v() returns void language plpgsql as $$
begin
  perform tt.pg();
  update public.verification_documents set scan_status = 'clean', removed_at = null where id in (tt.id('vD1'), tt.id('vD2'));
  update public.verification_claims set status = 'submitted', decided_at = null, decided_by = null, decision_reason = null, reviewer_id = null where id = tt.id('claimV');
  delete from public.verification_claim_documents where claim_id = tt.id('claimV') and version = 1;
  insert into public.verification_claim_documents (claim_id, version, document_id) values (tt.id('claimV'), 1, tt.id('vD1')), (tt.id('claimV'), 1, tt.id('vD2'));
end $$;

-- flagged infected after submission (clean -> infected is allowed by the scan job)
select tt.svc();
select lives_ok($$ select public.service_set_scan_result(tt.id('vD2'), 'infected', 'tt-av-later') $$, 'P2-M1.0 (setup) an attached document is flagged infected after submission');
select tt.act('tt_rev', 'aal2');
select throws_ok($$ select public.decide_claim(tt.id('claimV'), 'approve', 'approving despite infection', 1) $$, 'PT409', 'evidence_not_clean', 'P2-M1.1 approve is refused when an attached document was later flagged infected');
select tt.pg();
select is((select status::text from public.verification_claims where id = tt.id('claimV')), 'submitted', 'P2-M1.2 the refused approval changed nothing');
select is((select count(*)::int from public.verification_events where claim_id = tt.id('claimV') and event in ('approved', 'rejected', 'info_requested')), 0, 'P2-M1.3 ...and wrote no decision event');
select is((select count(*)::int from public.notifications where entity_id = tt.id('claimV')::text), 0, 'P2-M1.4 ...and sent no notification');
select tt.act('tt_rev', 'aal2');
select lives_ok($$ select public.decide_claim(tt.id('claimV'), 'request_info', 'one of the files failed the virus scan', 1) $$, 'P2-M1.5 request_info still works with infected evidence');
select tt.reset_v();
select tt.svc();
select public.service_set_scan_result(tt.id('vD2'), 'infected', 'tt-av-later');
select tt.act('tt_rev', 'aal2');
select lives_ok($$ select public.decide_claim(tt.id('claimV'), 'reject', 'evidence contains malware', 1) $$, 'P2-M1.6 reject still works with infected evidence');
-- failed scan status
select tt.reset_v();
update public.verification_documents set scan_status = 'failed' where id = tt.id('vD1');
select tt.act('tt_rev', 'aal2');
select throws_ok($$ select public.decide_claim(tt.id('claimV'), 'approve', 'approving unscanned evidence', 1) $$, 'PT409', 'evidence_not_clean', 'P2-M1.7 approve is refused when an attached document is failed');
select lives_ok($$ select public.decide_claim(tt.id('claimV'), 'request_info', 'please upload the file again', 1) $$, 'P2-M1.8 request_info still works with a failed document');
-- pending
select tt.reset_v();
update public.verification_documents set scan_status = 'pending' where id = tt.id('vD1');
select tt.act('tt_rev', 'aal2');
select throws_ok($$ select public.decide_claim(tt.id('claimV'), 'approve', 'approving unscanned evidence', 1) $$, 'PT409', 'evidence_not_clean', 'P2-M1.9 approve is refused when an attached document is pending');
-- removed
select tt.reset_v();
update public.verification_documents set removed_at = now() where id = tt.id('vD1');
select tt.act('tt_rev', 'aal2');
select throws_ok($$ select public.decide_claim(tt.id('claimV'), 'approve', 'approving removed evidence', 1) $$, 'PT409', 'evidence_not_clean', 'P2-M1.10 approve is refused when an attached document was removed');
select lives_ok($$ select public.decide_claim(tt.id('claimV'), 'reject', 'evidence was removed by the owner', 1) $$, 'P2-M1.11 reject still works with removed evidence');
-- no evidence attached to the current version
select tt.reset_v();
delete from public.verification_claim_documents where claim_id = tt.id('claimV');
select tt.act('tt_rev', 'aal2');
select throws_ok($$ select public.decide_claim(tt.id('claimV'), 'approve', 'approving with no evidence', 1) $$, 'PT409', 'evidence_not_clean', 'P2-M1.12 approve is refused when no document is attached to the version');
-- all clean
select tt.reset_v();
select tt.act('tt_rev', 'aal2');
select lives_ok($$ select public.decide_claim(tt.id('claimV'), 'approve', 'all evidence is clean and matches', 1) $$, 'P2-M1.13 approve succeeds when all attached documents are clean');
select tt.pg();
select is((select status::text from public.verification_claims where id = tt.id('claimV')), 'approved', 'P2-M1.14 claim approved');

-- ====================== L4: suspended organisation ======================
select tt.reset_v();
update public.organisations set status = 'suspended' where id = tt.oid('V');
select set_config('tt.ev0', (select count(*) from public.verification_events where claim_id = tt.id('claimV') and event in ('review_started', 'approved', 'rejected', 'info_requested'))::text, true);
select tt.act('tt_rev', 'aal2');
select throws_ok($$ select public.start_review(tt.id('claimV')) $$, 'PT409', 'org_not_active', 'P2-L4.1 start_review on a suspended organisation is refused');
select throws_ok($$ select public.decide_claim(tt.id('claimV'), 'approve', 'approving a suspended org', 1) $$, 'PT409', 'org_not_active', 'P2-L4.2 decide (approve) on a suspended organisation is refused');
select throws_ok($$ select public.decide_claim(tt.id('claimV'), 'reject', 'rejecting a suspended org', 1) $$, 'PT409', 'org_not_active', 'P2-L4.3 decide (reject) on a suspended organisation is refused');
select tt.pg();
select is((select status::text || ':' || coalesce(reviewer_id::text, '-') || ':' || coalesce(decided_by::text, '-') from public.verification_claims where id = tt.id('claimV')), 'submitted:-:-', 'P2-L4.4 nothing changed on the claim');
select is((select count(*)::int from public.verification_events where claim_id = tt.id('claimV') and event in ('review_started', 'approved', 'rejected', 'info_requested')), current_setting('tt.ev0')::int, 'P2-L4.5 and no event was written');
update public.organisations set status = 'active' where id = tt.oid('V');
select tt.act('tt_rev', 'aal2');
select lives_ok($$ select public.start_review(tt.id('claimV')) $$, 'P2-L4.6 control: once the organisation is active again the review can start');

-- ====================== FORGERY: users cannot reach service_* or write tables ======================
select tt.act('tt_d_owner', 'aal2');
select throws_ok($$ select public.service_register_document(tt.oid('D'), tt.uid('tt_d_owner'), 'business_registration', 'ssm_certificate', 'n', 'application/pdf', 10, repeat('7', 64), 'forge/1', 'clean', 'e') $$, '42501', null, 'P2-FORGE.1 authenticated cannot call service_register_document');
select throws_ok($$ select public.service_set_scan_result(tt.id('dPend3'), 'clean', 'forged') $$, '42501', null, 'P2-FORGE.2 authenticated cannot call service_set_scan_result');
select throws_ok($$ select * from public.service_list_unscanned_documents(5) $$, '42501', null, 'P2-FORGE.3 authenticated cannot call service_list_unscanned_documents');
select throws_ok($$ select public.service_org_recipient_emails(tt.oid('D')) $$, '42501', null, 'P2-FORGE.4 authenticated cannot call service_org_recipient_emails');
select throws_ok($$ select public.service_record_rejected_upload(tt.oid('D'), tt.uid('tt_d_owner'), 'business_registration', 'infected', null) $$, '42501', null, 'P2-FORGE.5 authenticated cannot call service_record_rejected_upload');
select throws_ok($$ update public.verification_documents set scan_status = 'clean' where id = tt.id('dPend3') $$, '42501', null, 'P2-FORGE.6 a user cannot set scan_status with a direct UPDATE');
select throws_ok($$ update public.verification_claims set status = 'approved' where org_id = tt.oid('D') $$, '42501', null, 'P2-FORGE.7 a user cannot approve a claim with a direct UPDATE');
select throws_ok($$ insert into public.verification_documents (org_id, claim_id, doc_type, display_name, mime_type, size_bytes, sha256, storage_path, scan_status) values (tt.oid('D'), gen_random_uuid(), 'other', 'n', 'application/pdf', 1, repeat('1', 64), 'forge/2', 'clean') $$, '42501', null, 'P2-FORGE.8 a user cannot insert a pre-cleaned document');
select ok(not has_column_privilege('authenticated', 'public.verification_documents', 'scan_status', 'update')
      and not has_column_privilege('authenticated', 'public.verification_documents', 'scan_status', 'insert')
      and not has_column_privilege('service_role', 'public.verification_documents', 'scan_status', 'update'), 'P2-FORGE.9 no API role holds a column privilege on scan_status');
select tt.anon();
select throws_ok($$ select public.service_set_scan_result(gen_random_uuid(), 'clean', 'forged') $$, '42501', null, 'P2-FORGE.10 anon cannot call service_set_scan_result');
select throws_ok($$ select public.service_register_document(gen_random_uuid(), gen_random_uuid(), 'business_registration', 'ssm_certificate', 'n', 'application/pdf', 10, repeat('7', 64), 'forge/3', 'clean', 'e') $$, '42501', null, 'P2-FORGE.11 anon cannot call service_register_document');
select throws_ok($$ select public.service_org_recipient_emails(gen_random_uuid()) $$, '42501', null, 'P2-FORGE.12 anon cannot enumerate recipient e-mails');
select tt.svc();
select throws_ok($$ select public.decide_claim(gen_random_uuid(), 'approve', 'service role deciding', 1) $$, '42501', null, 'P2-FORGE.13 even service_role cannot call decide_claim');
select throws_ok($$ select public.get_document_access(gen_random_uuid()) $$, '42501', null, 'P2-FORGE.14 even service_role cannot call get_document_access (no logged authorisation path)');

select tt.pg();
select * from finish();
rollback;

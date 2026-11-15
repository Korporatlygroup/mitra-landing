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
grant select,insert on tt.o to public;
create function tt.oid(p_label text) returns uuid language sql stable as $$ select id from tt.o where label = p_label $$;
create function tt.reg(p_label text, p_id uuid) returns uuid language plpgsql as $$
begin
  insert into tt.o (label, id) values (p_label, p_id);
  return p_id;
end $$;
create table tt.ids (label text primary key, id uuid);
grant select, insert, update on tt.ids to public;
create function tt.id(p_label text) returns uuid language sql stable as $$ select id from tt.ids where label=p_label $$;

create function tt.cand(p_name text, p_extra jsonb default '{}') returns jsonb
language sql as $$
  select jsonb_build_object('name', p_name, 'description', 'Synthetic test programme', 'funding_type', 'grant',
    'application_channel', 'form', 'application_url', 'https://www.mitra.gov.my/apply',
    'info_url', 'https://www.mitra.gov.my/ms/modal-insan', 'application_status', 'open', 'extraction_status', 'complete',
    'category', 'grants_funding', 'beneficiary_type', 'entrepreneur', 'sectors', jsonb_build_array('retail'),
    'documents', jsonb_build_array('SSM registration')) || p_extra
$$;

select tt.mkuser('rev'); select tt.mkuser('pub'); select tt.mkuser('su1'); select tt.mkuser('su2'); select tt.mkuser('opsx');
select tt.mkuser('own'); select tt.mkuser('oth'); select tt.mkuser('stf');
select tt.fresh_mitra();
select tt.mkorg('mitra', 'MITRA Admin', 'rev', 'admin_review');
select tt.addm((select id from public.organisations where type = 'mitra'), 'pub', 'admin_content');
select tt.addm((select id from public.organisations where type = 'mitra'), 'su1', 'admin_super');
select tt.addm((select id from public.organisations where type = 'mitra'), 'su2', 'admin_super');
select tt.addm((select id from public.organisations where type = 'mitra'), 'opsx', 'admin_ops');
select tt.reg('A', tt.mkorg('business', 'Biz A', 'own'));
select tt.addm(tt.oid('A'), 'stf', 'staff');
select tt.reg('B', tt.mkorg('business', 'Biz B', 'oth'));

select tt.pg();
insert into public.gov_agencies (code, name, domain) values ('MIT', 'MITRA test', 'mitra.gov.my');
insert into public.gov_sources (agency_id, name, source_type, adapter, allowed_hosts, approved_urls, allowed_method, enabled)
  select id, 'Editorial', 'manual', 'manual', '{www.mitra.gov.my}', '{}', 'manual_entry', false from public.gov_agencies where code = 'MIT';
insert into tt.ids values ('src', (select id from public.gov_sources where name = 'Editorial'));
update public.gov_settings set enabled = true where key in ('publishing_enabled', 'notifications_enabled');

select plan(27);

-- ============ manual proposal: who may do what ============
select tt.act('own', 'aal1');
select throws_ok($$select public.gov_propose_manual(tt.id('src'), null, tt.cand('Hack Programme'), 'trying as a shop owner')$$, 'PT403', null, 'M1 a business owner cannot propose a programme');
select tt.anon();
select throws_ok($$select public.gov_propose_manual(tt.id('src'), null, tt.cand('Hack Programme'), 'trying anonymous')$$, '42501', null, 'M2 anonymous cannot call the proposal RPC');
select tt.act('opsx', 'aal2');
select throws_ok($$select public.gov_propose_manual(tt.id('src'), null, tt.cand('Ops Programme'), 'ops lacks review right')$$, 'PT403', null, 'M3 a source administrator without review rights cannot propose');
select tt.act('rev', 'aal2');
select throws_ok($$select public.gov_propose_manual(tt.id('src'), null, tt.cand('Bad Cat', '{"category":"magic"}'), 'invalid category here')$$, 'PT422', 'category', 'M4 an unknown category is refused');
select throws_ok($$select public.gov_propose_manual(tt.id('src'), null, tt.cand('Bad Sector', '{"sectors":"retail"}'), 'sectors must be a list')$$, 'PT422', 'sectors', 'M5 sectors must be a list of text');
select throws_ok($$select public.gov_propose_manual(tt.id('src'), null, tt.cand('Short Reason'), 'no')$$, 'PT422', 'reason', 'M6 a reason is required');
select lives_ok($$select public.gov_propose_manual(tt.id('src'), null, tt.cand('Uyarvu Test Grant'), 'read from the official MITRA page on test day')$$, 'M7 a reviewer can propose a new programme');
select tt.pg();
insert into tt.ids values ('p1', (select id from public.gov_change_proposals where candidate ->> 'name' = 'Uyarvu Test Grant'));
select is((select proposed_by from public.gov_change_proposals where id = tt.id('p1')), tt.uid('rev'), 'M8 the proposer is recorded from the session, not a parameter');
select ok((select 'manual' = any (flags) from public.gov_change_proposals where id = tt.id('p1')), 'M9 the proposal is flagged as manual');
select is((select count(*)::int from public.gov_programmes), 0, 'M10 nothing is published by proposing');
select tt.act('rev', 'aal2');
select throws_ok($$select public.gov_propose_manual(tt.id('src'), null, tt.cand('Uyarvu Test Grant'), 'same content again, test')$$, 'PT409', 'duplicate', 'M11 the same proposal cannot be queued twice');
select throws_ok($$select public.gov_decide_proposal(tt.id('p1'), 'approve', 'reviewer cannot publish', 'pending')$$, 'PT403', null, 'M12 a reviewer without publish rights cannot approve');

-- ============ two-person rule ============
select tt.act('su1', 'aal2');
select lives_ok($$select public.gov_propose_manual(tt.id('src'), null, tt.cand('Self Approved Grant'), 'proposed by a super administrator')$$, 'T1 a super administrator can propose');
select tt.pg();
insert into tt.ids values ('p2', (select id from public.gov_change_proposals where candidate ->> 'name' = 'Self Approved Grant'));
select tt.act('su1', 'aal2');
select throws_ok($$select public.gov_decide_proposal(tt.id('p2'), 'approve', 'approving my own proposal', 'pending')$$, 'PT403', 'second_person_required', 'T2 the proposer cannot approve their own change');
select tt.act('su2', 'aal2');
select lives_ok($$select public.gov_decide_proposal(tt.id('p2'), 'approve', 'checked against the official page', 'pending')$$, 'T3 a different administrator can approve it');
select tt.pg();
select is((select detection_method from public.gov_programme_versions order by published_at limit 1), 'manual', 'T4 the version records that it was entered by a person');
select is((select approved_by from public.gov_programme_versions order by published_at limit 1), tt.uid('su2'), 'T5 the approver is recorded');
select is((select category from public.gov_programmes limit 1), 'grants_funding', 'T6 the category is promoted for filtering');
select is((select beneficiary_type from public.gov_programmes limit 1), 'entrepreneur', 'T7 who the programme is for is promoted');
select tt.act('pub', 'aal2');
select lives_ok($$select public.gov_decide_proposal(tt.id('p1'), 'approve', 'a content publisher approves it', 'pending')$$, 'T8 the content publisher approves the reviewer proposal');

-- ============ version history is never overwritten ============
select tt.pg();
insert into tt.ids values ('prog', (select id from public.gov_programmes where name = 'Uyarvu Test Grant'));
select tt.act('rev', 'aal2');
select lives_ok($$select public.gov_propose_manual(tt.id('src'), tt.id('prog'), tt.cand('Uyarvu Test Grant', '{"closes_on":"2099-01-31","description":"Changed text"}'), 'deadline announced on the page')$$, 'V1 a change to a published programme is a new proposal');
select tt.pg();
insert into tt.ids values ('p3', (select id from public.gov_change_proposals where programme_id = tt.id('prog') and status = 'pending'));
select ok((select diff ? 'closes_on' and diff ? 'description' from public.gov_change_proposals where id = tt.id('p3')), 'V2 the proposal carries a before/after difference');
select ok((select 'dates_changed' = any (flags) from public.gov_change_proposals where id = tt.id('p3')), 'V3 a deadline change is flagged');
select is((select data ->> 'description' from public.gov_programme_versions where programme_id = tt.id('prog') and version_no = 1), 'Synthetic test programme', 'V4 the published version is unchanged while the change waits');
select tt.act('su2', 'aal2');
select public.gov_decide_proposal(tt.id('p3'), 'approve', 'second editor confirmed on the official page', 'pending');
select tt.pg();
select is((select count(*)::int from public.gov_programme_versions where programme_id = tt.id('prog')), 2, 'V5 approval adds a version instead of overwriting');
select throws_ok($$update public.gov_programme_versions set data = '{}'$$, '42501', null, 'V6 published versions cannot be edited');

-- ============ the monitor keeps editorial fields it cannot see on the page ============
create function tt.resubmit_without_editorial() returns text language plpgsql security definer as $f$
declare v_key text; v_data jsonb;
begin
  select p.external_key, v.data into v_key, v_data from public.gov_programmes p join public.gov_programme_versions v on v.id = p.current_version_id where p.name = 'Uyarvu Test Grant';
  return public.gov_submit_candidate((select id from tt.ids where label = 'src'), null, v_key, v_data - 'category' - 'beneficiary_type' - 'sectors');
end $f$;
select tt.pg();
select is(tt.resubmit_without_editorial(), 'unchanged', 'E1 a re-extraction without editorial fields is not treated as a change');

select * from finish();
rollback;

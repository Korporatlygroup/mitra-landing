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

-- ---------- Phase 2 helpers (setup runs as postgres; assertions run as the acting role) ----------
create table tt.ids (label text primary key, id uuid);
grant select, insert, update on tt.ids to public;
create function tt.id(p_label text) returns uuid language sql stable as $$ select id from tt.ids where label=p_label $$;

create function tt.cand(p_name text, p_amount_max text default '50000', p_url text default 'https://tekunonline.tekun.gov.my/login') returns jsonb
language sql as $$
  select jsonb_build_object('name', p_name, 'description', 'Synthetic test programme', 'funding_type', 'financing',
    'amount_max', p_amount_max, 'currency', 'MYR', 'application_channel', 'online', 'application_url', p_url,
    'info_url', 'https://www.tekun.gov.my/synthetic/', 'application_status', 'open', 'extraction_status', 'complete',
    'rules', jsonb_build_array(jsonb_build_object('field', 'employees_max', 'op', 'lte', 'value', 5, 'quote', 'Synthetic quote')))
$$;

-- Fixtures: MITRA admins and a plain business user.
select tt.mkuser('ops1'); select tt.mkuser('ops2'); select tt.mkuser('rev'); select tt.mkuser('pub'); select tt.mkuser('biz');
select tt.fresh_mitra();
select tt.mkorg('mitra', 'MITRA Admin', 'ops1', 'admin_ops');
select tt.addm((select id from public.organisations where type = 'mitra'), 'ops2', 'admin_ops');
select tt.addm((select id from public.organisations where type = 'mitra'), 'rev', 'admin_review');
select tt.addm((select id from public.organisations where type = 'mitra'), 'pub', 'admin_content');
select tt.mkorg('business', 'Biz Shop', 'biz');

-- Test-only (rolled back): lets assertions made as the worker role read tables the worker never reads in production.
grant select on public.gov_fetch_jobs, public.gov_programmes, public.gov_change_proposals, public.gov_programme_versions to service_role;
select plan(46);

-- ===== Switches default off =====
select tt.pg();
select is((select count(*)::int from public.gov_settings where enabled), 0, 'G1 all switches start off');

-- ===== Access =====
select tt.anon();
select throws_ok($$select * from public.gov_sources$$, '42501', null, 'G2 anon cannot read sources');
select throws_ok($$select public.gov_enqueue_due_jobs()$$, '42501', null, 'G3 anon cannot run worker RPCs');
select tt.act('biz', 'aal2');
select is((select count(*)::int from public.gov_sources), 0, 'G4 business user sees no sources');
select throws_ok($$select public.gov_enqueue_due_jobs()$$, '42501', null, 'G5 authenticated cannot run worker RPCs');
select throws_ok($$select public.gov_register_source('TEKUN','TEKUN','tekun.gov.my','X','website','tekun','{www.tekun.gov.my}','{https://www.tekun.gov.my/a/}','public_pages',null)$$,
  'PT403', null, 'G6 non-staff cannot register a source');
select tt.act('rev', 'aal2');
select throws_ok($$select public.gov_register_source('TEKUN','TEKUN','tekun.gov.my','X','website','tekun','{www.tekun.gov.my}','{https://www.tekun.gov.my/a/}','public_pages',null)$$,
  'PT403', null, 'G7 reviewer cannot register a source');

-- ops1 without MFA is refused, with MFA allowed
select tt.act('ops1', 'aal1');
select throws_ok($$select public.gov_register_source('TEKUN','TEKUN','tekun.gov.my','X','website','tekun','{www.tekun.gov.my}','{https://www.tekun.gov.my/a/}','public_pages',null)$$,
  'PT403', null, 'G8 admin without MFA refused');
select tt.act('ops1', 'aal2');
insert into tt.ids values ('src', public.gov_register_source('TEKUN','TEKUN Nasional','tekun.gov.my','TEKUN schemes','website','tekun',
  '{www.tekun.gov.my,tekunonline.tekun.gov.my}', '{https://www.tekun.gov.my/skim-pembiayaan-tekun-niaga/}', 'public_pages', 'robots respected'));
select is((select count(*)::int from public.gov_sources where not enabled and id = tt.id('src')), 1, 'G9 admin registers a source, disabled by default');
select throws_ok($$insert into public.gov_sources (agency_id, name, source_type, adapter, allowed_hosts, approved_urls)
  select agency_id, 'bad', 'website', 'tekun', '{x.gov.my}', '{http://x.gov.my/a}' from public.gov_sources limit 1$$, '42501', null, 'G10 no direct table writes');

-- ===== Source change needs a second person =====
insert into tt.ids values ('chg', public.gov_propose_source_change(tt.id('src'), '{"enabled": true}', 'turn on after review'));
select throws_ok(format($$select public.gov_decide_source_change(%L, true, 'self approve')$$, tt.id('chg')), 'PT403', 'second_person_required', 'G11 proposer cannot approve own change');
select throws_ok(format($$select public.gov_propose_source_change(%L, '{"api_key": "x"}', 'bad field here')$$, tt.id('src')), 'PT422', 'field', 'G12 unknown change field refused');
select tt.act('ops2', 'aal2');
select lives_ok(format($$select public.gov_decide_source_change(%L, true, 'second person ok')$$, tt.id('chg')), 'G13 second administrator approves');
select is((select enabled from public.gov_sources where id = tt.id('src')), true, 'G14 approved change applied');
select throws_ok(format($$select public.gov_decide_source_change(%L, true, 'again again')$$, tt.id('chg')), 'PT409', 'already_decided', 'G15 change decided once');

-- ===== Worker: switches, enqueue, claim, lease, retry =====
select tt.svc();
select is(public.gov_enqueue_due_jobs(), 0, 'G16 monitoring off: nothing queued');
select tt.act('ops1', 'aal2');
select lives_ok($$select public.gov_set_setting('monitoring_enabled', true, 'start monitoring')$$, 'G17 source admin enables monitoring');
select tt.pg();
update public.gov_sources set next_check_at = null;
select tt.svc();
select is(public.gov_enqueue_due_jobs(), 1, 'G18 due source gets one job');
select tt.pg();
update public.gov_sources set next_check_at = null;
select tt.svc();
select is(public.gov_enqueue_due_jobs(), 0, 'G19 scheduler running twice creates no duplicate job');
select is((select count(*)::int from public.gov_claim_jobs('w1', 5, 60)), 1, 'G20 worker claims the job');
select is((select count(*)::int from public.gov_claim_jobs('w2', 5, 60)), 0, 'G21 second worker cannot claim a leased job');
select throws_ok($$select public.gov_complete_job((select id from public.gov_fetch_jobs limit 1), 'w2', '{"outcome":"ok"}')$$, 'PT409', 'not_lease_holder', 'G22 only the lease holder completes');
select is(public.gov_fail_job((select id from public.gov_fetch_jobs limit 1), 'w1', 'timeout', 120), 'queued', 'G23 failure requeues with backoff');
select ok((select run_after >= now() + interval '110 seconds' from public.gov_fetch_jobs limit 1), 'G24 Retry-After is honoured');
select tt.pg();
update public.gov_sources set consecutive_failures = 2;
update public.gov_fetch_jobs set run_after = now() - interval '1 second', attempts = 4, status = 'running', locked_by = 'w1', lease_until = now() - interval '1 minute';
update public.gov_sources set last_request_at = null;
select tt.svc();
select is((select count(*)::int from public.gov_claim_jobs('w3', 5, 60)), 1, 'G25 expired lease is recovered and reclaimed');
select is(public.gov_fail_job((select id from public.gov_fetch_jobs limit 1), 'w3', 'boom'), 'dead', 'G26 job dead-letters at max attempts');
select is((select health from public.gov_sources where id = tt.id('src')), 'degraded', 'G27 repeated failures degrade the source');
select tt.pg();
update public.gov_sources set last_request_at = null;
update public.gov_fetch_jobs set status = 'running', locked_by = 'w9', lease_until = now() + interval '1 minute', finished_at = null;
select tt.svc();
select lives_ok($$select public.gov_complete_job((select id from public.gov_fetch_jobs limit 1), 'w9',
  '{"outcome":"ok","http_status":200,"content_type":"text/html","content_sha256":"0000000000000000000000000000000000000000000000000000000000000000","byte_length":10,"parser_version":"1","evidence_excerpt":"x"}')$$, 'G28 job completes');
select is((select health from public.gov_sources where id = tt.id('src')), 'healthy', 'G29 success restores health');

-- ===== Candidate submission and verification =====
select is(public.gov_submit_candidate(tt.id('src'), null, 'niaga', tt.cand('TEKUN Niaga') || '{"closes_on":"2026-01-01","opens_on":"2026-06-01"}'), 'invalid', 'G30 contradictory dates rejected');
select is(public.gov_submit_candidate(tt.id('src'), null, 'niaga', tt.cand('TEKUN Niaga', '50000', 'https://evil.example/apply')), 'queued', 'G31 candidate queued, not published');
select is((select count(*)::int from public.gov_programmes), 0, 'G32 queueing publishes nothing');
select is(public.gov_submit_candidate(tt.id('src'), null, 'niaga', tt.cand('TEKUN Niaga', '50000', 'https://evil.example/apply')), 'duplicate', 'G33 duplicate discovery is ignored');
select ok((select 'url_host_not_allowed' = any (flags) from public.gov_change_proposals where status = 'pending'), 'G34 unapproved application host is flagged');
select tt.act('pub', 'aal2');
select throws_ok($$select public.gov_decide_proposal((select id from public.gov_change_proposals where status = 'pending'), 'approve', 'looks fine here')$$, 'PT409', 'publishing_disabled', 'G35 publishing switch blocks approval');
select tt.act('ops1', 'aal2');
select lives_ok($$select public.gov_set_setting('publishing_enabled', true, 'start publishing')$$, 'G36 publishing enabled');
select tt.act('pub', 'aal2');
select throws_ok($$select public.gov_decide_proposal((select id from public.gov_change_proposals where status = 'pending'), 'approve', 'looks fine here')$$, 'PT409', 'url_host_not_allowed', 'G37 bad application link cannot be approved');
select tt.svc();
select is(public.gov_submit_candidate(tt.id('src'), null, 'niaga', tt.cand('TEKUN Niaga')), 'queued', 'G38 corrected candidate supersedes the old one');
select is((select count(*)::int from public.gov_change_proposals where status = 'superseded'), 1, 'G39 old proposal superseded');
select tt.act('rev', 'aal2');
select throws_ok($$select public.gov_decide_proposal((select id from public.gov_change_proposals where status = 'pending'), 'approve', 'reviewer cannot publish')$$, 'PT403', null, 'G40 reviewer cannot publish');
select tt.act('pub', 'aal2');
select throws_ok($$select public.gov_decide_proposal((select id from public.gov_change_proposals where status = 'pending'), 'approve', 'no')$$, 'PT422', 'reason', 'G41 reason required');
select lives_ok($$select public.gov_decide_proposal((select id from public.gov_change_proposals where status = 'pending'), 'approve', 'checked against the official page')$$, 'G42 publisher approves with a reason');
select tt.pg();
select is((select verification_status || '/' || publication_state || '/' || (select count(*) from public.gov_programme_versions)::text from public.gov_programmes), 'verified/published/1', 'G43 programme verified, published, version 1');
select throws_ok($$update public.gov_programme_versions set approval_reason = 'tamper'$$, '42501', null, 'G44 versions are immutable');
select tt.anon();
select is((select application_status from public.gov_list_programmes()), 'open', 'G45 fresh evidence shows open to the public');
select tt.pg();
update public.gov_programmes set last_checked_at = now() - interval '30 days';
select tt.anon();
select is((select application_status from public.gov_list_programmes()), 'unknown', 'G46 stale evidence is never shown as open');

select * from finish();
rollback;

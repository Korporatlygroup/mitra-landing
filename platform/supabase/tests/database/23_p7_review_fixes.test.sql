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
    'review_notes', jsonb_build_array('internal reviewer note'),
    'rules', jsonb_build_array(jsonb_build_object('field', 'employees_max', 'op', 'lte', 'value', 5, 'quote', 'Synthetic quote')))
$$;

select tt.mkuser('ops'); select tt.mkuser('pub'); select tt.mkuser('own'); select tt.mkuser('stf'); select tt.mkuser('vwr'); select tt.mkuser('oth');
select tt.fresh_mitra();
select tt.mkorg('mitra', 'MITRA Admin', 'ops', 'admin_ops');
select tt.addm((select id from public.organisations where type = 'mitra'), 'pub', 'admin_content');
select tt.reg('A', tt.mkorg('business', 'Biz A', 'own'));
select tt.addm(tt.oid('A'), 'stf', 'staff');
select tt.addm(tt.oid('A'), 'vwr', 'viewer');
select tt.reg('B', tt.mkorg('business', 'Biz B', 'oth'));

-- A source and a published programme (setup as owner of the database, then approvals through the real RPCs).
select tt.pg();
insert into public.gov_agencies (code, name, domain) values ('TST', 'Test agency', 'tekun.gov.my');
insert into public.gov_sources (agency_id, name, source_type, adapter, allowed_hosts, approved_urls, enabled)
  select id, 'Test', 'website', 'tekun', '{www.tekun.gov.my,tekunonline.tekun.gov.my}', '{https://www.tekun.gov.my/a/}', true from public.gov_agencies where code = 'TST';
update public.gov_settings set enabled = true where key in ('publishing_enabled');
insert into tt.ids values ('src', (select id from public.gov_sources where name = 'Test'));
select tt.svc();
select public.gov_submit_candidate(tt.id('src'), null, 'p1', tt.cand('Synthetic Scheme'));
select tt.act('pub', 'aal2');
select public.gov_decide_proposal((select id from public.gov_change_proposals where status = 'pending' limit 1), 'approve', 'verified against official page');
select tt.pg();
insert into tt.ids values ('prog', (select id from public.gov_programmes limit 1));

select plan(15);

-- Candidate validation never raises a raw error
select tt.svc();
select is(public.gov_submit_candidate(tt.id('src'), null, 'bad-date', tt.cand('Bad Date') || '{"closes_on":"2025-13-45"}'::jsonb), 'invalid', 'R1 impossible calendar date is refused cleanly');

-- Host checks use a strict parser
select is(public.gov_submit_candidate(tt.id('src'), null, 'userinfo', tt.cand('Userinfo Trick', '1000', 'https://www.tekun.gov.my:x@evil.example/')), 'queued', 'R2 candidate with a userinfo trick is queued for review');
select tt.pg();
select ok((select 'url_host_not_allowed' = any (flags) from public.gov_change_proposals where external_key = 'userinfo'), 'R3 userinfo trick is flagged as an unapproved host');
select tt.svc();
select is(public.gov_submit_candidate(tt.id('src'), null, 'infohost', jsonb_set(tt.cand('Info Host'), '{info_url}', '"https://evil.example/page"')), 'queued', 'R4 candidate with a foreign information page is queued');
select tt.pg();
select ok((select 'url_host_not_allowed' = any (flags) from public.gov_change_proposals where external_key = 'infohost'), 'R5 the information page host is checked too');

-- Decisions only on open proposals
select tt.act('pub', 'aal2');
select throws_ok($$select public.gov_decide_proposal((select id from public.gov_change_proposals where external_key = 'infohost'), 'approve', 'trying to reopen', 'rejected')$$, 'PT422', 'decision', 'R6 a caller cannot name another expected status');
select throws_ok($$select public.gov_decide_proposal((select id from public.gov_change_proposals where external_key = 'infohost'), 'approve', 'trying with a bad host', 'pending')$$, 'PT409', 'url_host_not_allowed', 'R7 foreign information page cannot be approved');

-- A vanished page: one miss changes nothing visible, three make it unconfirmed, the source coming back restores it
select tt.pg();
update public.gov_programmes set last_checked_at = now() - interval '1 hour' where id = tt.id('prog');
select tt.svc();
select public.gov_mark_missing(tt.id('src'), 'p1');
select tt.pg();
select is((select verification_status from public.gov_programmes where id = tt.id('prog')), 'verified', 'R8 one miss keeps the record verified');
select ok((select last_checked_at < now() - interval '30 minutes' from public.gov_programmes where id = tt.id('prog')), 'R9 a miss does not make the record look freshly checked');
select tt.svc();
select public.gov_mark_missing(tt.id('src'), 'p1'); select public.gov_mark_missing(tt.id('src'), 'p1');
select tt.pg();
select is((select verification_status from public.gov_programmes where id = tt.id('prog')), 'unconfirmed', 'R10 three misses in a row make it unconfirmed');
select tt.svc();
select is(public.gov_submit_candidate(tt.id('src'), null, 'p1', tt.cand('Synthetic Scheme')), 'unchanged', 'R11 the source returns with the same content');
select tt.pg();
select is((select verification_status from public.gov_programmes where id = tt.id('prog')), 'verified', 'R12 and the programme is confirmed again');

-- Mail provider not configured: attempts are not burned
select tt.act('own', 'aal1');
select lives_ok($$select public.gov_set_prefs('{"channel_email": true}')$$, 'R13 opt in to email');
select tt.act('ops', 'aal2');
select throws_ok($$select public.gov_propose_source_change((select id from public.gov_sources limit 1), '{"enabled": true}', 'no')$$, 'PT422', 'reason', 'R14 source change reason length is validated');
select tt.pg();
select is((select count(*)::int from public.gov_outbox where attempts > 5), 0, 'R15 no outbox row has more than the allowed attempts');

select * from finish();
rollback;

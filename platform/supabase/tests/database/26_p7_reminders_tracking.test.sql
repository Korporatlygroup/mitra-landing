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
    'info_url', 'https://www.mitra.gov.my/ms/modal-insan', 'application_status', 'open', 'extraction_status', 'complete') || p_extra
$$;

select tt.mkuser('su1'); select tt.mkuser('su2'); select tt.mkuser('rev'); select tt.mkuser('own'); select tt.mkuser('stf'); select tt.mkuser('oth');
select tt.fresh_mitra();
select tt.mkorg('mitra', 'MITRA Admin', 'su1', 'admin_super');
select tt.addm((select id from public.organisations where type = 'mitra'), 'su2', 'admin_super');
select tt.addm((select id from public.organisations where type = 'mitra'), 'rev', 'admin_review');
select tt.reg('A', tt.mkorg('business', 'Biz A', 'own'));
select tt.addm(tt.oid('A'), 'stf', 'staff');
select tt.reg('B', tt.mkorg('business', 'Biz B', 'oth'));

select tt.pg();
insert into public.gov_agencies (code, name, domain) values ('MIT', 'MITRA test', 'mitra.gov.my');
insert into public.gov_sources (agency_id, name, source_type, adapter, allowed_hosts, approved_urls, allowed_method, enabled)
  select id, 'Editorial', 'manual', 'manual', '{www.mitra.gov.my}', '{}', 'manual_entry', false from public.gov_agencies where code = 'MIT';
insert into tt.ids values ('src', (select id from public.gov_sources where name = 'Editorial'));
update public.gov_settings set enabled = true where key in ('publishing_enabled', 'notifications_enabled');

-- Publish three programmes through the real two-person path: one closing in 10 days, one with an unknown deadline, one stale.
create function tt.publish(p_label text, p_extra jsonb) returns void language plpgsql as $f$
declare v_prop uuid;
begin
  perform tt.act('su1', 'aal2');
  v_prop := public.gov_propose_manual(tt.id('src'), null, tt.cand(p_label, p_extra), 'entered for the test, from the page');
  perform tt.act('su2', 'aal2');
  perform public.gov_decide_proposal(v_prop, 'approve', 'second editor checked the page');
  perform tt.pg();
  insert into tt.ids values (p_label, (select id from public.gov_programmes where name = p_label));
end $f$;
select tt.publish('Closing Soon Grant', jsonb_build_object('closes_on', to_char(current_date + 10, 'YYYY-MM-DD')));
select tt.publish('No Date Grant', '{}');
select tt.publish('Stale Grant', '{}');
select tt.pg();
update public.gov_programmes set last_checked_at = now() - interval '30 days' where id = tt.id('Stale Grant');

-- Saved by Biz A
select tt.act('own', 'aal1');
select public.gov_save_programme(tt.oid('A'), tt.id('Closing Soon Grant'));
select public.gov_save_programme(tt.oid('A'), tt.id('No Date Grant'));
select public.gov_save_programme(tt.oid('A'), tt.id('Stale Grant'));

select plan(31);

-- ============ tracking: seven self-reported stages ============
select tt.act('own', 'aal1');
select lives_ok($$select public.gov_update_tracking(tt.oid('A'), tt.id('No Date Grant'), '{"tracking_status":"ready_to_apply"}', 1)$$, 'K1 "ready to apply" is a valid self-reported stage');
select throws_ok($$select public.gov_update_tracking(tt.oid('A'), tt.id('No Date Grant'), '{"tracking_status":"approved_by_agency"}', 2)$$, 'PT422', null, 'K2 an invented stage is refused');
select is((select tracking_status from public.gov_list_saved(tt.oid('A')) where slug like 'no-date-grant%'), 'ready_to_apply', 'K3 the saved list shows the stage the owner reported');

-- ============ preferences ============
select lives_ok($$select public.gov_set_prefs('{"reminder_days":[30,7,1]}')$$, 'N1 reminder days can be changed');
select is((public.gov_get_prefs() -> 'reminder_days'), '[30, 7, 1]'::jsonb, 'N2 and are stored largest first');
select throws_ok($$select public.gov_set_prefs('{"reminder_days":[0]}')$$, 'PT422', null, 'N3 zero days is refused');
select throws_ok($$select public.gov_set_prefs('{"reminder_days":[1,2,3,4,5]}')$$, 'PT422', null, 'N4 more than four reminders is refused');
select throws_ok($$select public.gov_set_prefs('{"reminder_days":"14"}')$$, 'PT422', null, 'N5 reminder days must be a list');
select lives_ok($$select public.gov_set_prefs('{"reminder_days":[14,3]}')$$, 'N6 the defaults can be restored');
select is((select (public.gov_get_prefs() -> 'reminder_days')), '[14, 3]'::jsonb, 'N7 default is 14 and 3 days');

-- ============ deadline reminders: confirmed dates only, once ============
select tt.svc();
select ok(public.gov_enqueue_reminders() >= 1, 'D1 a confirmed deadline inside the window queues a notice');
select tt.pg();
select is((select count(*)::int from public.gov_outbox where category = 'deadline' and programme_id = tt.id('Closing Soon Grant') and user_id = tt.uid('own')), 1, 'D2 exactly one deadline notice for the owner');
select ok((select event_key like '%:14:%' from public.gov_outbox where category = 'deadline' and user_id = tt.uid('own') limit 1), 'D3 it is the 14-day reminder (10 days left)');
select is((select count(*)::int from public.gov_outbox where category = 'deadline' and programme_id = tt.id('No Date Grant')), 0, 'D4 an unknown deadline never produces a deadline notice');
select tt.svc();
select public.gov_enqueue_reminders();
select tt.pg();
select is((select count(*)::int from public.gov_outbox where category = 'deadline' and user_id = tt.uid('own')), 1, 'D5 running again does not duplicate the reminder');
select is((select count(*)::int from public.gov_outbox where category = 'recheck' and programme_id = tt.id('Stale Grant') and user_id = tt.uid('own')), 1, 'D6 a stale saved programme asks to be rechecked, once');
select is((select count(*)::int from public.gov_outbox where category = 'recheck' and programme_id = tt.id('No Date Grant')), 0, 'D7 a freshly checked programme does not');

-- ============ delivery: in-app once, preferences honoured ============
select tt.act('stf', 'aal1');
select public.gov_set_prefs('{"deadline":false}');
select tt.svc();
select public.gov_dispatch_outbox(50);
select tt.pg();
select is((select count(*)::int from public.notifications where kind = 'gov.deadline' and user_id = tt.uid('own')), 1, 'P1 the owner gets one in-app deadline notification');
select is((select count(*)::int from public.notifications where kind = 'gov.deadline' and user_id = tt.uid('stf')), 0, 'P2 a person who turned deadline notices off gets none');
select tt.svc();
select public.gov_dispatch_outbox(50);
select tt.pg();
select is((select count(*)::int from public.notifications where kind = 'gov.deadline' and user_id = tt.uid('own')), 1, 'P3 dispatching again does not send it twice');
select is((select email_status from public.gov_outbox where user_id = tt.uid('own') and category = 'deadline'), 'skipped', 'P4 email is not marked sent when the person did not opt in');

-- ============ isolation ============
select tt.act('oth', 'aal1');
select throws_ok($$select * from public.gov_list_saved(tt.oid('A'))$$, 'PT404', null, 'I1 another business cannot list this business''s saved programmes');
select throws_ok($$select public.gov_update_tracking(tt.oid('A'), tt.id('No Date Grant'), '{"note":"x"}', 1)$$, 'PT404', null, 'I2 nor change its tracking');

-- ============ page monitoring ============
select tt.pg();
insert into public.gov_fetch_results (source_id, url, http_status, content_sha256, outcome, evidence_excerpt, fetched_at)
values (tt.id('src'), 'https://www.mitra.gov.my/ms/modal-insan', 200, repeat('a', 64), 'ok', 'old text', now() - interval '2 days');
insert into public.gov_fetch_results (source_id, url, http_status, content_sha256, outcome, evidence_excerpt, fetched_at)
values (tt.id('src'), 'https://www.mitra.gov.my/ms/modal-insan', 200, repeat('b', 64), 'ok', 'new text', now());
insert into tt.ids values ('r2', (select id from public.gov_fetch_results where content_sha256 = repeat('b', 64)));
select tt.svc();
select is(public.gov_record_page(tt.id('r2')), 'changed', 'W1 a changed page creates a review item');
select is(public.gov_record_page(tt.id('r2')), 'changed', 'W2 recording the same result twice does not create a second item');
select tt.pg();
select is((select count(*)::int from public.gov_page_changes), 1, 'W3 exactly one review item');

-- ============ check-now requests ============
-- ============ check-now requests ============
select tt.act('own', 'aal1');
select throws_ok($q$select public.gov_request_recheck(tt.id('src'), 'asking as a shop owner')$q$, 'PT403', null, 'Q1 a shop owner cannot request a source check');
select tt.act('su1', 'aal2');
select throws_ok($q$select public.gov_request_recheck(tt.id('src'), 'source is switched off')$q$, 'PT409', 'not_enabled', 'Q2 a switched-off source cannot be checked');
select tt.pg();
update public.gov_sources set enabled = true, approved_urls = array['https://www.mitra.gov.my/ms/modal-insan'] where id = tt.id('src');
select tt.act('su1', 'aal2');
select is(public.gov_request_recheck(tt.id('src'), 'announcement on the page today'), 1, 'Q3 an enabled source gets a check queued');
select is(public.gov_request_recheck(tt.id('src'), 'asking again straight away'), 0, 'Q4 asking again within ten minutes queues nothing');
select tt.act('own', 'aal1');
select is((select verification_status from public.gov_list_saved(tt.oid('A')) where slug like 'no-date-grant%'), 'verified', 'Q5 the saved list reports the verification status');

select * from finish();
rollback;

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

select plan(65);

-- ===== Profile privacy and validation =====
select tt.act('own', 'aal1');
select is((select (public.gov_get_profile(tt.oid('A')) ->> 'version')::int), 0, 'U1 owner reads an empty profile');
select is(public.gov_save_profile(tt.oid('A'), '{"needs":["financing"],"business_size":"micro","employees":3,"registration":"registered","community":"indian","citizenship":"malaysian","owner_age":40}', 0), 1, 'U2 owner saves the profile');
select throws_ok($$select public.gov_save_profile((select id from tt.o where label = 'A'), '{"needs":["financing"]}', 0)$$, 'PT409', 'stale_version', 'U3 stale version refused');
select throws_ok($$select public.gov_save_profile((select id from tt.o where label = 'A'), '{"needs":["lottery"]}', 1)$$, 'PT422', 'invalid_data', 'U4 unknown need refused');
select throws_ok($$select public.gov_save_profile((select id from tt.o where label = 'A'), '{"owner_age":5}', 1)$$, 'PT422', 'invalid_data', 'U5 out-of-range value refused');
select tt.act('stf', 'aal1');
select is((public.gov_get_profile(tt.oid('A')) ->> 'business_size'), 'micro', 'U6 staff member can read the organisation profile');
select tt.act('vwr', 'aal1');
select throws_ok($$select public.gov_get_profile((select id from tt.o where label = 'A'))$$, 'PT404', null, 'U7 viewer cannot read it');
select is((select count(*)::int from public.gov_assistance_profiles), 0, 'U8 viewer sees no profile rows (RLS)');
select tt.act('oth', 'aal1');
select throws_ok($$select public.gov_get_profile((select id from tt.o where label = 'A'))$$, 'PT404', null, 'U9 another business cannot read it');
select is((select count(*)::int from public.gov_assistance_profiles), 0, 'U10 another business sees no profile rows');
select throws_ok($$select public.gov_save_profile((select id from tt.o where label = 'A'), '{}', 1)$$, 'PT404', null, 'U11 another business cannot write it');
select tt.anon();
select throws_ok($$select public.gov_get_profile((select id from tt.o where label = 'A'))$$, '42501', null, 'U12 anonymous cannot call profile RPCs');
select throws_ok($$select * from public.gov_assistance_profiles$$, '42501', null, 'U13 anonymous cannot read profiles');

-- ===== Saved opportunities and user-reported tracking =====
select tt.act('own', 'aal1');
select lives_ok(format($$select public.gov_save_programme(%L, %L)$$, tt.oid('A'), tt.id('prog')), 'U14 owner saves a published programme');
select lives_ok(format($$select public.gov_save_programme(%L, %L)$$, tt.oid('A'), tt.id('prog')), 'U15 saving twice is harmless');
select throws_ok(format($$select public.gov_save_programme(%L, gen_random_uuid())$$, tt.oid('A')), 'PT404', null, 'U16 unknown programme is not found');
select is((select tracking_status from public.gov_list_saved(tt.oid('A'))), 'interested', 'U17 saved items start as interested (user-reported)');
select is(public.gov_update_tracking(tt.oid('A'), tt.id('prog'), '{"tracking_status":"applied_externally","applied_on":"2026-11-01","note":"Went to branch","reminder_on":"2026-12-01"}', 1), 2, 'U18 tracking updated');
select throws_ok(format($$select public.gov_update_tracking(%L, %L, '{"tracking_status":"preparing"}', 1)$$, tt.oid('A'), tt.id('prog')), 'PT409', 'stale_version', 'U19 stale tracking version refused');
select throws_ok(format($$select public.gov_update_tracking(%L, %L, '{"tracking_status":"approved_by_agency"}', 2)$$, tt.oid('A'), tt.id('prog')), 'PT422', 'invalid_data', 'U20 only user-reported statuses exist');
select is(public.gov_update_tracking(tt.oid('A'), tt.id('prog'), '{"tracking_status":"outcome_recorded","outcome":"approved"}', 2), 3, 'U21 self-reported outcome recorded');
select is((select outcome from public.gov_list_saved(tt.oid('A'))), 'approved', 'U21b outcome stored as reported by the user');
select tt.act('oth', 'aal1');
select is((select count(*)::int from public.gov_saved), 0, 'U22 another business sees no saved items');
select throws_ok(format($$select public.gov_list_saved(%L)$$, tt.oid('A')), 'PT404', null, 'U23 another business cannot list them');
select throws_ok(format($$select public.gov_update_tracking(%L, %L, '{"note":"x"}', 2)$$, tt.oid('A'), tt.id('prog')), 'PT404', null, 'U24 another business cannot edit tracking');
select tt.act('vwr', 'aal1');
select is((select count(*)::int from public.gov_saved), 0, 'U25 viewer sees no saved items');

-- ===== Public detail hides reviewer notes =====
select tt.anon();
select is((public.gov_get_programme((select slug from public.gov_list_programmes() limit 1)) -> 'data') ? 'review_notes', false, 'U26 public detail omits internal reviewer notes');
select is((public.gov_get_programme((select slug from public.gov_list_programmes() limit 1)) ->> 'verification_status'), 'verified', 'U27 public detail states verification');
select throws_ok($$select public.gov_get_programme('no-such-slug')$$, 'PT404', null, 'U28 unknown slug is not found');

-- ===== Preferences =====
select tt.act('own', 'aal1');
select throws_ok($$select public.gov_set_prefs('{"admin": true}')$$, 'PT422', 'field', 'U29 unknown preference refused');
select lives_ok($$select public.gov_set_prefs('{"channel_email": true}')$$, 'U30 user opts in to email');
select is((public.gov_get_prefs() ->> 'channel_email')::boolean, true, 'U31 preference stored');
select tt.act('oth', 'aal1');
select is((public.gov_get_prefs() ->> 'channel_email')::boolean, false, 'U32 another user sees only their own defaults');
select is((select count(*)::int from public.gov_notification_prefs), 0, 'U33 another user cannot read others prefs');

-- ===== Change, events, outbox: one notification per event, never duplicated =====
select tt.pg();
update public.gov_settings set enabled = true where key = 'notifications_enabled';
select tt.svc();
select public.gov_submit_candidate(tt.id('src'), null, 'p1', tt.cand('Synthetic Scheme', '80000') || '{"closes_on":"2027-03-01"}'::jsonb);
select tt.act('pub', 'aal2');
select public.gov_decide_proposal((select id from public.gov_change_proposals where status = 'pending' limit 1), 'approve', 'amount and date confirmed');
select tt.pg();
select is((select count(*)::int from public.gov_programme_events where kind in ('programme_verified', 'programme_updated', 'deadline_changed')), 3, 'U34 events emitted for the verified, updated and deadline versions');
select is((select count(*)::int from public.gov_outbox where category = 'rule_change' and user_id = tt.uid('own')), 1, 'U35 saver gets one rule-change outbox row');
select is((select count(*)::int from public.gov_outbox where category = 'deadline' and user_id = tt.uid('own')), 1, 'U36 saver gets one deadline row');
select is((select count(*)::int from public.gov_outbox where user_id = tt.uid('vwr') or user_id = tt.uid('oth')), 0, 'U37 viewer and other business get nothing');
select is((select count(*)::int from public.gov_outbox where category = 'new_match' and user_id = tt.uid('own')), 0, 'U38 profile need was declared after verification: no retro new_match');

select tt.svc();
select is((select count(*)::int from public.gov_dispatch_outbox(50)), 2, 'U39 dispatch hands out email jobs for the opted-in user (2 events)');
select tt.pg();
select is((select count(*)::int from public.notifications where user_id = tt.uid('own') and kind like 'gov.%'), 2, 'U40 in-app notifications created');
select is((select count(*)::int from public.gov_outbox where email_status = 'queued'), 2, 'U41 email is only queued until the provider accepts');
select tt.svc();
select is((select count(*)::int from public.gov_dispatch_outbox(50)), 0, 'U42 running dispatch again sends nothing twice');
select tt.pg();
select tt.svc();
select lives_ok($$select public.gov_mark_email((select id from public.gov_outbox where email_status = 'queued' limit 1), true)$$, 'U43 provider accepted');
select lives_ok($$select public.gov_mark_email((select id from public.gov_outbox where email_status = 'sent' limit 1), true)$$, 'U44 marking again is idempotent');
select lives_ok($$select public.gov_mark_email((select id from public.gov_outbox where email_status = 'queued' limit 1), false, 'smtp down')$$, 'U45 provider failure recorded');
select tt.pg();
select is((select email_status from public.gov_outbox where last_error = 'smtp down'), 'pending', 'U46 failed email returns to pending for retry');
select is((select count(*)::int from public.gov_outbox where email_status = 'sent'), 1, 'U47 exactly one email counted as sent');

-- ===== Preferences are honoured =====
select tt.act('own', 'aal1');
select lives_ok($$select public.gov_set_prefs('{"channel_email": false, "deadline": false}')$$, 'U48 unsubscribe from email and turn off deadlines');
select tt.pg();
select ok((select email_unsubscribed_at is not null from public.gov_notification_prefs where user_id = tt.uid('own')), 'U49 unsubscribe is remembered');
select tt.svc();
select is((select count(*)::int from public.gov_dispatch_outbox(50)), 0, 'U50 no email after unsubscribe');
select tt.pg();
select is((select count(*)::int from public.gov_outbox where email_status = 'pending'), 0, 'U51 pending email was skipped, not left to send later');

-- A later change while notifications are paused stays pending, then flows when the pause ends.
select tt.act('own', 'aal1');
select lives_ok($$select public.gov_set_prefs('{"paused_until": "2999-01-01T00:00:00Z", "channel_email": false}')$$, 'U52 user pauses notifications');
select tt.svc();
select public.gov_submit_candidate(tt.id('src'), null, 'p1', tt.cand('Synthetic Scheme', '90000') || '{"closes_on":"2027-03-01"}'::jsonb);
select tt.act('pub', 'aal2');
select public.gov_decide_proposal((select id from public.gov_change_proposals where status = 'pending' limit 1), 'approve', 'amount confirmed again');
select tt.svc();
select is((select count(*)::int from public.gov_dispatch_outbox(50)), 0, 'U53 paused: nothing delivered');
select tt.pg();
select is((select count(*)::int from public.gov_outbox where in_app_status = 'pending' and user_id = tt.uid('own')), 1, 'U54 the event waits while paused');
update public.gov_notification_prefs set paused_until = null where user_id = tt.uid('own');
select tt.svc();
select * from public.gov_dispatch_outbox(50);
select tt.pg();
select is((select count(*)::int from public.gov_outbox where in_app_status = 'pending' and user_id = tt.uid('own')), 0, 'U55 delivered after the pause ends');

-- Switch off: nothing is delivered and nothing is lost.
select tt.pg();
update public.gov_settings set enabled = false where key = 'notifications_enabled';
select tt.svc();
select is((select count(*)::int from public.gov_dispatch_outbox(50)), 0, 'U56 notifications switch off: dispatch does nothing');
select is(public.gov_enqueue_reminders(), 0, 'U57 reminders also respect the switch');

-- ===== Reminders =====
select tt.pg();
update public.gov_settings set enabled = true where key = 'notifications_enabled';
update public.gov_saved set reminder_on = current_date - 1, tracking_status = 'preparing', outcome = null;
select tt.svc();
select is(public.gov_enqueue_reminders() >= 1, true, 'U58 due personal reminder queued');
select is(public.gov_enqueue_reminders(), 0, 'U59 same reminder is not queued twice');

-- ===== Archive notifies savers and the feed =====
select tt.act('pub', 'aal2');
select lives_ok(format($$select public.gov_set_programme_state(%L, 'archived', 'programme ended')$$, tt.id('prog')), 'U60 archive a programme');
select tt.pg();
select is((select count(*)::int from public.gov_programme_events where kind = 'programme_closed'), 1, 'U61 closed event in the feed');
select throws_ok($$update public.gov_programme_events set kind = 'programme_opened'$$, '42501', null, 'U62 event feed is append-only');
select tt.anon();
select throws_ok($$select * from public.gov_programme_events$$, '42501', null, 'U63 feed is not public');
select is((select count(*)::int from public.gov_list_programmes()), 0, 'U64 archived programmes disappear from the public list');

select * from finish();
rollback;

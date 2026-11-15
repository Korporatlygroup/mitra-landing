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

-- Label -> id table for ids created during the test.
create table tt.ids (label text primary key, id uuid);
grant select, insert, update on tt.ids to public;
create function tt.id(p_label text) returns uuid language sql stable as $$ select id from tt.ids where label=p_label $$;

-- ---------- redesign test body ----------
select tt.mkuser('own'); select tt.mkuser('stf'); select tt.mkuser('vwr'); select tt.mkuser('oth'); select tt.mkuser('rev'); select tt.mkuser('pub'); select tt.mkuser('buy');
select tt.fresh_mitra();
select tt.mkorg('mitra', 'MITRA Admin', 'rev', 'admin_review');
select tt.addm((select id from public.organisations where type = 'mitra'), 'pub', 'admin_content');
select tt.reg('A', tt.mkorg('business', 'Biz A', 'own'));
select tt.addm(tt.oid('A'), 'stf', 'staff');
select tt.addm(tt.oid('A'), 'vwr', 'viewer');
select tt.reg('B', tt.mkorg('business', 'Biz B', 'oth'));

select plan(62);

-- ===== Business products: who can write =====
select tt.act('own', 'aal1');
select is((public.biz_product_save(tt.oid('A'), null, '{"kind":"product","name":"Polo shirt","price_cents":2500,"unit":"piece","min_order":20}', null) ->> 'status'), 'draft', 'R1 owner saves a draft product');
select tt.pg();
insert into tt.ids values ('p1', (select id from public.biz_products where name = 'Polo shirt'));
select tt.act('own', 'aal1');
select throws_ok($$select public.biz_product_save((select id from tt.o where label = 'A'), null, '{"kind":"product","name":"X","price_cents":10}', null)$$, 'PT422', 'invalid_data', 'R2 a one-letter name is refused');
select throws_ok($$select public.biz_product_save((select id from tt.o where label = 'A'), null, '{"kind":"product","name":"Bad price","price_cents":-5}', null)$$, 'PT422', 'invalid_data', 'R3 a negative price is refused');
select throws_ok($$select public.biz_product_save((select id from tt.o where label = 'A'), null, '{"kind":"product","name":"Bad unit","unit":"parsec"}', null)$$, 'PT422', 'invalid_data', 'R4 an unknown unit is refused');
select tt.act('vwr', 'aal1');
select throws_ok($$select public.biz_product_save((select id from tt.o where label = 'A'), null, '{"kind":"product","name":"Viewer item"}', null)$$, 'PT404', null, 'R5 a viewer cannot add products');
select tt.act('oth', 'aal1');
select throws_ok($$select public.biz_product_save((select id from tt.o where label = 'A'), null, '{"kind":"product","name":"Other org item"}', null)$$, 'PT404', null, 'R6 another business cannot add to this one');
select is((select count(*)::int from public.biz_products), 0, 'R7 another business sees none of the rows (RLS)');
select throws_ok($$insert into public.biz_products (org_id, name, created_by) values ((select id from tt.o where label = 'B'), 'Direct', auth.uid())$$, '42501', null, 'R8 direct insert is denied: writes go through the RPC');
select tt.act('stf', 'aal1');
select is((select count(*)::int from public.biz_products), 1, 'R9 staff of the business can read its products');
select tt.act('own', 'aal1');
select throws_ok($$select public.biz_product_save((select id from tt.o where label = 'A'), (select id from tt.ids where label = 'p1'), '{"kind":"product","name":"Polo shirt 2"}', 9)$$, 'PT409', 'stale_version', 'R10 a stale version is refused');

-- ===== Submit and review =====
select throws_ok($$select public.biz_product_submit((select id from tt.o where label = 'A'), (select id from public.biz_products where name = 'Polo shirt'), 99)$$, 'PT409', 'stale_version', 'R11 submit with a stale version is refused');
select is((public.biz_product_submit(tt.oid('A'), tt.id('p1'), 1) ->> 'status'), 'in_review', 'R12 owner sends it for review');
select throws_ok($$select public.biz_product_submit((select id from tt.o where label = 'A'), (select id from tt.ids where label = 'p1'), 2)$$, 'PT409', 'state', 'R13 it cannot be sent twice');
select is(public.public_biz_products('no-such-slug'), '[]'::jsonb, 'R14 an unknown profile has no public products');
select tt.pg();
insert into public.business_profiles (org_id, business_name, category_id) values (tt.oid('A'), 'Biz A', (select id from public.business_categories where slug = 'food-beverage'));
insert into public.business_listings (org_id, slug, live_status, live_name) values (tt.oid('A'), 'biz-a-test', 'published', 'Biz A')
  on conflict (org_id) do update set slug = 'biz-a-test', live_status = 'published', live_name = 'Biz A';
select tt.anon();
select is(public.public_biz_products('biz-a-test'), '[]'::jsonb, 'R15 an item in review is not shown to the public');
select tt.act('own', 'aal1');
select throws_ok($$select public.admin_biz_products('in_review')$$, 'PT404', null, 'R16 a business owner cannot list the review queue');
select tt.act('rev', 'aal2');
select is((select jsonb_array_length(public.admin_biz_products('in_review'))), 1, 'R17 a reviewer sees the item waiting');
select throws_ok($$select public.admin_biz_product_decide((select id from tt.ids where label = 'p1'), 'request_changes', '', 2)$$, 'PT422', 'reason', 'R18 asking for changes needs a written note');
select throws_ok($$select public.admin_biz_product_decide((select id from tt.ids where label = 'p1'), 'maybe', 'xxxxxx', 2)$$, 'PT422', 'decision', 'R19 an unknown decision is refused');
select throws_ok($$select public.admin_biz_product_decide((select id from tt.ids where label = 'p1'), 'approve', null, 1)$$, 'PT409', 'stale_version', 'R20 a decision on an old version is refused');
select lives_ok($$select public.admin_biz_product_decide((select id from tt.ids where label = 'p1'), 'approve', null, 2)$$, 'R21 the reviewer approves it');
select tt.anon();
select is((select jsonb_array_length(public.public_biz_products('biz-a-test'))), 1, 'R22 an approved item is now public');
select is((public.public_biz_products('biz-a-test') -> 0 ->> 'name'), 'Polo shirt', 'R23 with its name');
select ok(not (public.public_biz_products('biz-a-test') -> 0) ? 'org_id', 'R24 and without internal ids');
select tt.act('rev', 'aal2');
select throws_ok($$select public.admin_biz_product_decide((select id from tt.ids where label = 'p1'), 'approve', null, 3)$$, 'PT409', 'already_decided', 'R25 it cannot be decided again');
select tt.act('own', 'aal1');
select is((public.biz_product_save(tt.oid('A'), tt.id('p1'), '{"kind":"product","name":"Polo shirt","price_cents":2800}', 3) ->> 'status'), 'draft', 'R26 editing a live item takes it back to draft');
select tt.anon();
select is(public.public_biz_products('biz-a-test'), '[]'::jsonb, 'R27 and it leaves the public page until reviewed again');
select tt.act('own', 'aal1');
select is((public.biz_product_submit(tt.oid('A'), tt.id('p1'), 4) ->> 'status'), 'in_review', 'R28 the edited item can be sent for review again');

-- ===== Archive =====
select lives_ok($$select public.biz_product_archive((select id from tt.o where label = 'A'), (select id from tt.ids where label = 'p1'))$$, 'R29 owner removes an item');
select is((select count(*)::int from public.biz_products where status = 'archived'), 1, 'R30 it is kept as archived, not deleted');

-- ===== News =====
select tt.act('pub', 'aal2');
select is((public.admin_news_save(null, '{"title":"SPUMI intake open","summary":"Applications are open for the scheme.","body":"Full text of the post goes here.","category":"grants","language":"en","sectors":["food-beverage"],"states":["Selangor"],"deadline_on":"2099-01-31"}', null) ->> 'status'), 'draft', 'N1 staff write a draft post');
select tt.pg();
insert into tt.ids values ('n1', (select id from public.news_posts where title = 'SPUMI intake open'));
select tt.anon();
select is((public.news_list(null, null, null, null, false, 20, 0) ->> 'total')::int, 0, 'N2 a draft is not in the public feed');
select tt.act('own', 'aal1');
select throws_ok($$select public.admin_news_list()$$, 'PT404', null, 'N3 a business owner cannot list the editor');
select throws_ok($$select public.admin_news_save(null, '{"title":"x"}', null)$$, 'PT404', null, 'N4 a business owner cannot write posts');
select tt.act('pub', 'aal2');
select throws_ok($$select public.admin_news_save(null, '{"title":"Hi","summary":"short","body":"short","category":"grants"}', null)$$, 'PT422', 'invalid_data', 'N5 too-short text is refused');
select throws_ok($$select public.admin_news_save(null, '{"title":"Fine title","summary":"A long enough summary.","body":"A long enough body text.","category":"gossip"}', null)$$, 'PT422', 'invalid_data', 'N6 an unknown category is refused');
select lives_ok($$select public.admin_news_set_status((select id from tt.ids where label = 'n1'), 'published', null, 1)$$, 'N7 staff publish the post');
select tt.anon();
select is((public.news_list(null, null, null, null, false, 20, 0) ->> 'total')::int, 1, 'N8 the public feed now has it');
select is((public.news_list('training', null, null, null, false, 20, 0) ->> 'total')::int, 0, 'N9 another category filter excludes it');
select is((public.news_list(null, null, 'retail-shop', null, false, 20, 0) ->> 'total')::int, 0, 'N10 a post tagged for another business type is not offered to it');
select is((public.news_list(null, null, 'food-beverage', 'Selangor', false, 20, 0) ->> 'total')::int, 1, 'N11 but is offered to the matching type and state');
select is((public.news_deadlines(5) -> 0 ->> 'title'), 'SPUMI intake open', 'N12 its deadline shows in the upcoming list');
select throws_ok($$select public.news_save((select id from tt.ids where label = 'n1'))$$, '42501', null, 'N13 a visitor cannot save posts');
select tt.act('pub', 'aal2');
select lives_ok($$select public.admin_news_set_status((select id from tt.ids where label = 'n1'), 'published', now() + interval '2 days', 2)$$, 'N14 staff schedule it for later');
select tt.anon();
select is((public.news_list(null, null, null, null, false, 20, 0) ->> 'total')::int, 0, 'N15 a scheduled post is not public yet');
select tt.act('pub', 'aal2');
select lives_ok($$select public.admin_news_set_status((select id from tt.ids where label = 'n1'), 'published', now() - interval '1 minute', 3)$$, 'N16 and published now');

-- Saved posts and preferences
select tt.act('buy', 'aal1');
select lives_ok($$select public.news_save((select id from tt.ids where label = 'n1'))$$, 'N17 a signed-in person saves it');
select is((public.news_list(null, null, null, null, true, 20, 0) ->> 'total')::int, 1, 'N18 and finds it under Saved');
select tt.act('oth', 'aal1');
select is((public.news_list(null, null, null, null, true, 20, 0) ->> 'total')::int, 0, 'N19 saved lists are private to the person');
select tt.act('buy', 'aal1');
select lives_ok($$select public.news_unsave((select id from tt.ids where label = 'n1'))$$, 'N20 unsaving works');
select is((public.news_get_prefs() ->> 'weekly_email')::boolean, false, 'N21 the weekly email is off by default');
select lives_ok($$select public.news_set_prefs('{"weekly_email":true,"training":false,"language":"ta"}')$$, 'N22 preferences are saved');
select is((public.news_get_prefs() ->> 'language'), 'ta', 'N23 and read back');
select throws_ok($$select public.news_set_prefs('{"language":"fr"}')$$, 'PT422', 'invalid_data', 'N24 an unknown language is refused');

-- Weekly digest: service role only, at most once per person and week
select tt.svc();
select is((select count(*)::int from jsonb_array_elements(public.news_digest_candidates()) c where c ->> 'email' = 'buy@example.test'), 1, 'N25 the person who switched the email on is a candidate');
select is(public.news_digest_claim(tt.uid('buy'), '2099-W01'), true, 'N26 the first claim for a week succeeds');
select is(public.news_digest_claim(tt.uid('buy'), '2099-W01'), false, 'N27 a second claim for the same week is refused');

-- ===== Dashboard dismissals =====
select tt.act('own', 'aal1');
select lives_ok($$select public.dash_dismiss((select id from tt.o where label = 'A'), 'due:2026-11-13')$$, 'D1 a member dismisses a card');
select is((select 'due:2026-11-13' = any (public.dash_active_dismissals(tt.oid('A')))), true, 'D2 it is hidden for the person');
select tt.act('stf', 'aal1');
select is((select 'due:2026-11-13' = any (public.dash_active_dismissals(tt.oid('A')))), false, 'D3 other members still see it');
select tt.act('oth', 'aal1');
select throws_ok($$select public.dash_dismiss((select id from tt.o where label = 'A'), 'due:x')$$, 'PT404', null, 'D4 a non-member cannot dismiss for this business');
select tt.act('own', 'aal1');
select throws_ok($$select public.dash_dismiss((select id from tt.o where label = 'A'), 'Bad Key!')$$, 'PT422', 'invalid_data', 'D5 a malformed key is refused');

select * from finish();
rollback;

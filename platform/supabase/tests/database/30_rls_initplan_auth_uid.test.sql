begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- Migration 224: the 13 policies that called auth.uid() per row now wrap it (once per statement), with the same table, command and role.
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and cmd = 'SELECT' and roles = '{authenticated}'
     and policyname in ('suppliers_select', 'supplier_private_select', 'supplier_documents_select', 'supplier_events_select', 'products_select',
       'product_revisions_select', 'product_media_select', 'news_digests_own', 'news_saved_own', 'news_prefs_own', 'dash_dismissals_own',
       'gov_prefs_select', 'gov_outbox_select')),
  13, 'all 13 policies exist as SELECT policies for authenticated');
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public'
     and policyname in ('suppliers_select', 'supplier_private_select', 'supplier_documents_select', 'supplier_events_select', 'products_select',
       'product_revisions_select', 'product_media_select', 'news_digests_own', 'news_saved_own', 'news_prefs_own', 'dash_dismissals_own',
       'gov_prefs_select', 'gov_outbox_select')
     and qual ~ 'SELECT auth\.uid\(\)'),
  13, 'every one of them wraps auth.uid() in a sub-select');
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and policyname in ('suppliers_select', 'supplier_private_select', 'supplier_documents_select', 'supplier_events_select', 'products_select',
       'product_revisions_select', 'product_media_select', 'news_digests_own', 'news_saved_own', 'news_prefs_own', 'dash_dismissals_own',
       'gov_prefs_select', 'gov_outbox_select')
     and regexp_replace(qual, '\(\s*SELECT auth\.uid\(\) AS uid\s*\)|\(SELECT auth\.uid\(\)\)', '', 'g') ~ 'auth\.uid\(\)'),
  0, 'no bare auth.uid() call is left in any of them');

-- Behaviour is unchanged: a person reads only their own rows.
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-4000-8000-000000000291', 'authenticated', 'authenticated', 'initplan-a@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000292', 'authenticated', 'authenticated', 'initplan-b@example.test', now(), '{}', '{}', now(), now());
insert into public.news_prefs (user_id) values ('00000000-0000-4000-8000-000000000291'), ('00000000-0000-4000-8000-000000000292');
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000291', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
select is((select count(*)::int from public.news_prefs), 1, 'a user sees exactly their own news preferences');
select is((select user_id::text from public.news_prefs), '00000000-0000-4000-8000-000000000291', 'and it is their own row');
select is((select count(*)::int from public.news_prefs where user_id = '00000000-0000-4000-8000-000000000292'), 0, 'another user''s row stays invisible');
reset role;

-- The plans contain an InitPlan (one evaluation per statement) for the simple own-row policies.
create function pg_temp.plan_text(q text) returns text language plpgsql as $$
declare r record; t text := '';
begin for r in execute 'explain ' || q loop t := t || (r."QUERY PLAN") || E'\n'; end loop; return t; end $$;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000291', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
select matches(pg_temp.plan_text('select * from public.news_prefs'), 'InitPlan', 'news_prefs plan contains an InitPlan');
select matches(pg_temp.plan_text('select * from public.news_saved'), 'InitPlan', 'news_saved plan contains an InitPlan');
select matches(pg_temp.plan_text('select * from public.dash_dismissals'), 'InitPlan', 'dash_dismissals plan contains an InitPlan');
select matches(pg_temp.plan_text('select * from public.gov_notification_prefs'), 'InitPlan', 'gov_notification_prefs plan contains an InitPlan');
select matches(pg_temp.plan_text('select * from public.gov_outbox'), 'InitPlan', 'gov_outbox plan contains an InitPlan');
reset role;

-- The partner tables still answer for a user with no membership (empty here; the older isolation suites cover populated data).
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000291', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
select is((select count(*)::int from public.suppliers), 0, 'a user outside the partner organisation sees no suppliers');
select is((select count(*)::int from public.supplier_private), 0, 'and no private supplier data');
select is((select count(*)::int from public.products), 0, 'and no products');
select is((select count(*)::int from public.supplier_documents), 0, 'and no supplier documents');
select is((select count(*)::int from public.product_media), 0, 'and no product media');
reset role;
select * from finish();
rollback;

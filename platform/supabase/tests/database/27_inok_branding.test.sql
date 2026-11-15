begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

-- The operator organisation is named INOK. An old row is renamed by the migration's statement, and a fresh bootstrap uses the new name.
delete from public.organisations where type = 'mitra';
update private.bootstrap_state set completed_at = null, completed_user_id = null;
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-4000-8000-000000000271', 'authenticated', 'authenticated', 'branding@example.test', now(), '{}'::jsonb,
  '{"consents":{"terms":"2026-07","privacy":"2026-07"}}'::jsonb, now(), now());

select is(public.bootstrap_first_admin('branding@example.test'), '00000000-0000-4000-8000-000000000271'::uuid, 'bootstrap still creates the first administrator');
select is((select name from public.organisations where type = 'mitra'), 'INOK Administration', 'the bootstrap names the operator organisation INOK Administration');
select is((select count(*)::int from public.organisations where type = 'mitra' and name ilike '%mitra%'), 0, 'no organisation display name says MITRA');
select throws_ok($$ select public.bootstrap_first_admin('branding@example.test') $$, 'PT409', null, 'a second bootstrap is still refused');

select * from finish();
rollback;

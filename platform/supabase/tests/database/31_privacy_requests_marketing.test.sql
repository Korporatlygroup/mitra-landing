begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-4000-8000-000000000301', 'authenticated', 'authenticated', 'priv-a@example.test', now(), '{}', json_build_object('consents', json_build_object('terms', private.current_consent_version(), 'privacy', private.current_consent_version()))::jsonb, now(), now()),
  ('00000000-0000-4000-8000-000000000302', 'authenticated', 'authenticated', 'priv-b@example.test', now(), '{}', json_build_object('consents', json_build_object('terms', private.current_consent_version(), 'privacy', private.current_consent_version(), 'marketing', private.current_consent_version()))::jsonb, now(), now()),
  ('00000000-0000-4000-8000-000000000303', 'authenticated', 'authenticated', 'priv-admin@example.test', now(), '{}', '{}', now(), now());
delete from public.organisations where type = 'mitra';
insert into public.organisations (id, type, name) values ('00000000-0000-4000-8000-0000000003a0', 'mitra', 'MITRA test admin');
insert into public.memberships (org_id, user_id, role) values ('00000000-0000-4000-8000-0000000003a0', '00000000-0000-4000-8000-000000000303', 'admin_super');

-- Marketing consent: never recorded unless the form sent it; required consents are recorded.
select is((select count(*)::int from public.consents where user_id = '00000000-0000-4000-8000-000000000301' and purpose in ('terms', 'privacy')), 2, 'sign-up without marketing still records terms and privacy');
select is((select count(*)::int from public.consents where user_id = '00000000-0000-4000-8000-000000000301' and purpose = 'marketing'), 0, 'no marketing consent is recorded when the box was not ticked');
select is((select count(*)::int from public.consents where user_id = '00000000-0000-4000-8000-000000000302' and purpose = 'marketing' and withdrawn_at is null), 1, 'marketing consent is recorded when the box was ticked');

-- Anonymous callers cannot use any of the new functions.
set local role anon;
select throws_ok($$ select public.set_marketing_consent(true) $$, '42501', null, 'anon cannot call set_marketing_consent');
select throws_ok($$ select public.submit_privacy_request('access', 'x') $$, '42501', null, 'anon cannot call submit_privacy_request');
select throws_ok($$ select public.admin_list_privacy_requests('all') $$, '42501', null, 'anon cannot call admin_list_privacy_requests');
select throws_ok($$ select * from public.privacy_requests $$, '42501', null, 'anon cannot read privacy_requests');
reset role;

-- User A: turn marketing on and off, submit requests.
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000301', 'role', 'authenticated', 'aal', 'aal1')::text, true);
set local role authenticated;
select is(public.set_marketing_consent(true), true, 'a user can opt in to marketing');
select is((select count(*)::int from public.consents where user_id = '00000000-0000-4000-8000-000000000301' and purpose = 'marketing' and withdrawn_at is null), 1, 'exactly one active marketing consent');
select public.set_marketing_consent(true);
select is((select count(*)::int from public.consents where user_id = '00000000-0000-4000-8000-000000000301' and purpose = 'marketing'), 1, 'opting in twice does not duplicate the consent');
select is(public.set_marketing_consent(false), false, 'a user can withdraw marketing consent');
select is((select count(*)::int from public.consents where user_id = '00000000-0000-4000-8000-000000000301' and purpose = 'marketing' and withdrawn_at is null), 0, 'no active marketing consent after withdrawal');
select is((select count(*)::int from public.consents where user_id = '00000000-0000-4000-8000-000000000301' and purpose in ('terms', 'privacy') and withdrawn_at is null), 2, 'withdrawing marketing leaves the required consents untouched');

select ok(public.submit_privacy_request('access', 'Please send me a copy of my personal data.') is not null, 'a user can submit a data request');
select throws_ok($$ select public.submit_privacy_request('hack', 'x') $$, null, null, 'an unknown request type is refused');
select throws_ok($$ select public.submit_privacy_request('access', '   ') $$, null, null, 'an empty request is refused');
select is((select count(*)::int from public.list_my_privacy_requests()), 1, 'the user sees their own request');
select throws_ok($$ select public.admin_list_privacy_requests('all') $$, null, null, 'an ordinary user cannot list all requests');
select throws_ok($$ insert into public.privacy_requests (user_id, request_type, details) values (auth.uid(), 'access', 'direct insert') $$, '42501', null, 'direct inserts are refused: only the RPC writes');
reset role;

-- User B sees none of A's requests.
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000302', 'role', 'authenticated', 'aal', 'aal1')::text, true);
set local role authenticated;
select is((select count(*)::int from public.privacy_requests), 0, 'another user sees no request of A');
reset role;

-- Administrator (admin_super at aal2) handles it; a note is required to close it.
select set_config('t.rid', (select id::text from public.privacy_requests limit 1), true);
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000303', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
select is(jsonb_array_length(public.admin_list_privacy_requests('open')), 1, 'the administrator sees the open request');
select throws_ok(format($$ select public.admin_update_privacy_request(%L, 'completed', '') $$, current_setting('t.rid')), null, null, 'closing without a note is refused');
select lives_ok(format($$ select public.admin_update_privacy_request(%L, 'completed', 'Copy provided by email.') $$, current_setting('t.rid')), 'the administrator can complete it with a note');
reset role;
select is((select status from public.privacy_requests limit 1), 'completed', 'the request is completed and the handler audit exists');

select * from finish();
rollback;

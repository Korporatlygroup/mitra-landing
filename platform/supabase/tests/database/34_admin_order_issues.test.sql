begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select is(has_function_privilege('anon', 'public.admin_order_issues(integer)', 'execute'), false, 'anon cannot execute admin_order_issues');
select is(has_function_privilege('authenticated', 'public.admin_order_issues(integer)', 'execute'), true, 'authenticated can execute it (the function checks the staff permission)');
select is((select prosecdef from pg_proc where oid = 'public.admin_order_issues(integer)'::regprocedure), true, 'it is security definer with a fixed search_path');
select is((select provolatile from pg_proc where oid = 'public.admin_order_issues(integer)'::regprocedure), 's', 'it is stable: read only');

-- Not signed in, and signed in without the staff permission: nothing is returned.
select throws_ok($$select public.admin_order_issues(10)$$, null, null, 'a caller who is not signed in is refused');
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-4000-8000-000000000334', 'authenticated', 'authenticated', 'issues-nobody@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000334', 'role', 'authenticated', 'aal', 'aal1')::text, true);
set local role authenticated;
select throws_ok($$select public.admin_order_issues(10)$$, null, 'not_found', 'a signed-in user without the report permission gets not_found');
reset role;

select * from finish();
rollback;

begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select is((select relrowsecurity from pg_class where oid = 'public.orders'::regclass), true, 'orders has row level security');
select is((select relrowsecurity from pg_class where oid = 'public.deal_events'::regclass), true, 'deal_events has row level security');
select is((select count(*)::int from pg_policies where tablename in ('orders','deal_events') and cmd <> 'SELECT'), 0, 'only SELECT policies exist: no direct writes');
select is((select count(*)::int from information_schema.role_table_grants where table_name in ('orders','deal_events') and grantee in ('anon','authenticated') and privilege_type <> 'SELECT'), 0, 'anon and authenticated hold no write privilege on orders or deal_events');
select is((select count(*)::int from information_schema.role_table_grants where table_name in ('orders','deal_events') and grantee = 'anon'), 0, 'anon cannot read orders or deal_events');
select is(has_function_privilege('anon', 'public.order_action(uuid,text,text)', 'execute'), false, 'anon cannot execute order_action');
select is(has_function_privilege('authenticated', 'public.order_action(uuid,text,text)', 'execute'), true, 'authenticated can execute order_action (the function checks membership)');
select is(has_function_privilege('anon', 'public.set_order_details(uuid,date,text)', 'execute'), false, 'anon cannot execute set_order_details');
select is(has_function_privilege('authenticated', 'private.deal_on_quote_change()', 'execute'), false, 'the trigger function is not callable by users');
select is((select count(*)::int from pg_constraint where conrelid = 'public.orders'::regclass and contype = 'u' and conkey = array[(select attnum from pg_attribute where attrelid = 'public.orders'::regclass and attname = 'enquiry_id')]), 1, 'one order per enquiry (no duplicate agreements)');
select ok((select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.orders'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ 'agreed') !~ '(paid|secured|refunded|released)', 'order statuses contain no payment state');

-- Behaviour: a signed-in user who is in neither organisation sees no order and no event.
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-4000-8000-000000000321', 'authenticated', 'authenticated', 'deals-nobody@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000321', 'role', 'authenticated', 'aal', 'aal1')::text, true);
set local role authenticated;
select is((select count(*)::int from public.orders) + (select count(*)::int from public.deal_events), 0, 'a stranger sees no orders or events');
reset role;

select * from finish();
rollback;

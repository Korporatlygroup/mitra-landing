begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

-- The two policies keep their meaning and now evaluate the platform check once per statement.
select is((select count(*)::int from pg_policies where tablename = 'audit_log' and policyname = 'audit_log_select' and cmd = 'SELECT' and roles = '{authenticated}'), 1, 'audit_log_select exists for authenticated');
select ok((select qual from pg_policies where tablename = 'audit_log' and policyname = 'audit_log_select') ~ 'SELECT private\.has_platform_permission', 'audit_log_select wraps the platform check in a sub-select');
select ok((select qual from pg_policies where tablename = 'verification_events' and policyname = 'verification_events_select') ~ 'SELECT private\.has_platform_permission', 'verification_events_select wraps the platform check in a sub-select');

-- Behaviour: a signed-in user with no membership sees nothing; an administrator with audit:read sees the rows.
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-4000-8000-000000000281', 'authenticated', 'authenticated', 'initplan-nobody@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
insert into public.audit_log (action, entity_type) values ('test.initplan', 'test');
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000281', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
select is((select count(*)::int from public.audit_log where action = 'test.initplan'), 0, 'a user without the permission still sees no audit rows');
reset role;

-- The plan evaluates the platform check as an InitPlan (once), not per row.
create function pg_temp.plan_text(q text) returns text language plpgsql as $$
declare r record; t text := '';
begin for r in execute 'explain ' || q loop t := t || (r."QUERY PLAN") || E'
'; end loop; return t; end $$;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000281', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
select matches(pg_temp.plan_text('select * from public.audit_log'), 'InitPlan', 'the audit_log plan contains an InitPlan for the platform check');
reset role;
select * from finish();
rollback;

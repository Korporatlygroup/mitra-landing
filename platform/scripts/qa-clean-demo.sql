-- Removes the demonstration data created by tests/e2e/support/demo-seed.ts. LOCAL/STAGING ONLY (never run against production).
-- Usage (local stack): psql "$TEST_DB_URL" -f scripts/qa-clean-demo.sql
begin;
set session_replication_role = replica; -- demo users and organisations are removed together with their dependent rows below
delete from public.news_posts where title like 'INOK Demo bulletin%';
delete from public.organisations where name like 'INOK Demo%';
delete from auth.users where email like 'demo-%@example.test';
do $$ declare r record; begin
  for r in select c.conrelid::regclass::text as tbl, a.attname as col from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
           where c.contype = 'f' and c.confrelid = 'public.organisations'::regclass and array_length(c.conkey, 1) = 1 loop
    execute format('delete from %s where %I is not null and %I not in (select id from public.organisations)', r.tbl, r.col, r.col);
  end loop;
end $$;
delete from public.business_listings where org_id not in (select id from public.organisations);
delete from public.profiles where id not in (select id from auth.users);
commit;

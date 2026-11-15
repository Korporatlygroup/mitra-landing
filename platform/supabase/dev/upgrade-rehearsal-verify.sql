-- LOCAL ONLY. Run after the Phase 7 migrations were applied on top of the rehearsal data (see upgrade-rehearsal-seed.sql).
-- For every table that existed before the upgrade: same row count and same hash over the ORIGINAL columns.
create temp table cmp (tbl text, before_n bigint, after_n bigint, same boolean);
do $$
declare r record; n bigint; h text;
begin
  for r in select * from rehearsal.before order by tbl loop
    execute format('select count(*), coalesce(md5(string_agg(md5(row(%s)::text), '''' order by md5(row(%s)::text))), ''empty'') from %s t',
      (select string_agg(format('t.%I', c), ',') from unnest(r.cols) c), (select string_agg(format('t.%I', c), ',') from unnest(r.cols) c), r.tbl) into n, h;
    insert into cmp values (r.tbl, r.n, n, r.n = n and r.h = h);
  end loop;
end $$;
select count(*) as tables_compared, count(*) filter (where same) as identical, count(*) filter (where not same) as changed, sum(before_n) as rows_before, sum(after_n) as rows_after from cmp;
select tbl, before_n, after_n from cmp where not same order by tbl;

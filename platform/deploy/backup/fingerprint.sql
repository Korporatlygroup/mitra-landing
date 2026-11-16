-- Row count and an order-independent content hash for every application table (public, private) plus the auth and storage tables a restore
-- must bring back. Run the same statement on the source and on the restored database; the two result sets must be identical.
select c.table_schema || '.' || c.table_name as tbl,
  (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', c.table_schema, c.table_name), false, true, '')))[1]::text as n,
  (xpath('/row/h/text()', query_to_xml(format('select coalesce(md5(string_agg(md5(t::text), %L order by md5(t::text))), %L) as h from %I.%I t', '', 'empty', c.table_schema, c.table_name), false, true, '')))[1]::text as h
from information_schema.tables c
where c.table_type = 'BASE TABLE'
  and (c.table_schema in ('public', 'private')
    or (c.table_schema = 'auth' and c.table_name in ('users', 'identities', 'mfa_factors', 'sessions', 'refresh_tokens', 'mfa_challenges', 'mfa_amr_claims'))
    or (c.table_schema = 'storage' and c.table_name = 'buckets'))
order by 1;

#!/bin/bash
# Restore test: rebuild a DISPOSABLE local database from the migrations, load a data backup into it, and compare table fingerprints with the source.
# Usage (from platform/): deploy/backup/restore-test.sh <data-backup.sql> <source-project-ref>
# Needs the local Supabase stack (it is reset: never run this against anything you want to keep) and the signed-in Supabase CLI for the read-only source fingerprint.
set -euo pipefail
BACKUP="$1"; REF="$2"; DB="${LOCAL_DB_CONTAINER:-supabase_db_mitra-p17}"
npx supabase db reset >/dev/null 2>&1
# Reference rows (categories, permissions, buckets) are created by the migrations and the seed, so the restore replaces them with the backup's copy.
docker exec -i "$DB" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
begin;
set session_replication_role = replica;
do $$ declare r record; begin
  for r in select schemaname, tablename from pg_tables where schemaname in ('public', 'private') loop
    execute format('truncate %I.%I restart identity cascade', r.schemaname, r.tablename);
  end loop;
  truncate auth.users, auth.identities, auth.sessions, auth.refresh_tokens, auth.mfa_factors, auth.mfa_challenges, auth.mfa_amr_claims cascade;
  truncate storage.buckets cascade;
end $$;
commit;
SQL
docker exec -i "$DB" psql -U postgres -v ON_ERROR_STOP=1 -q < "$BACKUP" > /dev/null
docker exec -i "$DB" psql -U postgres -At -F'|' -f - < deploy/backup/fingerprint.sql > /tmp/fp-restored.txt
npx supabase db query --remote="$REF" --read-only --output-format json -f deploy/backup/fingerprint.sql 2>/dev/null | tr -d '\000' | python -c "
import sys,json
raw=sys.stdin.read(); d,_=json.JSONDecoder().raw_decode(raw[raw.index('{'):])
for r in (d.get('rows') or d.get('result',{}).get('rows') or []): print('|'.join([r['tbl'],str(r['n']),r['h']]))" > /tmp/fp-source.txt
if diff <(tr -d '\r' < /tmp/fp-source.txt) <(tr -d '\r' < /tmp/fp-restored.txt) > /tmp/fp-diff.txt; then
  echo "RESTORE VERIFIED: $(wc -l < /tmp/fp-source.txt) tables identical, $(awk -F'|' '{s+=$2} END {print s}' /tmp/fp-source.txt) rows"
else
  echo "RESTORE DIFFERS:"; cat /tmp/fp-diff.txt; exit 1
fi

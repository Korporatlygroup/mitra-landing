# Backup and recovery on the Supabase Free plan (verified procedure)

The Free plan has no automatic backups and no point-in-time recovery. The procedure below costs nothing, and its restore step was actually run on 2026-11-16, not only the export.

## What is backed up
| Item | How | Notes |
|---|---|---|
| Schema | the migrations in git (`supabase/migrations`) are the schema of record; a hosted schema dump (`supabase db dump --remote=<ref>`) is kept as a cross-check | A new project is rebuilt by `supabase db push`, not by replaying a dump |
| Data | `supabase db dump --remote=<ref> --data-only -s public,private,auth,storage -f <file>` | Includes `auth.users`, identities, MFA factors, sessions and `private.bootstrap_state` (without that row a restored project would allow a second first-administrator bootstrap) |
| Storage files | private buckets `verification-docs` and `catalogue-media`: the dump holds only the bucket rows. Object bytes need their own copy (`supabase storage cp`, experimental) before real documents exist | **Not yet covered, no documents exist yet** |
| Secrets and settings | not in a dump. Auth settings are in `deploy/supabase-auth/*.toml`; Worker secrets must be re-entered from the password manager | |

## Where backups go
Outside the repository, encrypted, with the access limited to named owners (the dump contains personal data and password hashes). Never commit a dump. A local folder is only the first copy: keep a second copy off the machine.
Frequency before launch: daily is not possible without a scheduler holding a database credential; use a weekly manual run now and a scheduled GitHub Actions job later if the owner adds a `SUPABASE_ACCESS_TOKEN` repository secret (GitHub Actions minutes are free for the private repository within its quota; not verified).

## Restore (tested)
`deploy/backup/restore-test.sh <data-dump.sql> <source-project-ref>` rebuilds a **disposable local database** from the migrations (`supabase db reset`), empties every application table, loads the dump, then compares row counts and content hashes of every table (`deploy/backup/fingerprint.sql`) with the source project.
Result on 2026-11-16 with the staging backup: **98 tables identical, 474 rows, including 7 auth tables and the bucket rows** (`RESTORE VERIFIED`). The reference rows created by migrations and the seed have to be emptied before loading, otherwise the load fails on duplicate keys; the script does that.
To restore a real project: create an empty project, `supabase db push`, then run the same truncate-and-load steps against it (point `LOCAL_DB_CONTAINER` or use `psql` with the project's connection string), then re-enter secrets and redeploy the Worker. Recovery time for a small database is minutes; it needs a person with project access.

## Rules
- Run the restore test again after every schema change batch and after the first real data exists; a backup that was never restored is not a backup.
- The restore script resets the local stack: never run it on anything to be kept.
- Production: no backups exist until `inok-production` exists. On Free the project also pauses after inactivity; a paid plan (daily backups) remains the recommended state before real business data, but is not purchased.

# Production release plan: WP5 order issues (PR 27, migration 000233)

Status: prepared, NOT executed. Needs the owner's explicit approval for (a) applying 000233 to production and (b) deploying the Worker. No staging is used.
Production already has 000231 and all earlier migrations (read-only `supabase migration list --remote`: only 000232 and 000233 are not applied; 000232 belongs to WP4 and is independent).

## What the migration does
One new read-only function `public.admin_order_issues(integer)`: stable, security definer, requires the existing `report:view` staff permission (others get not_found), anon cannot execute. No table, column, policy or data change.

## Local verification already done (clean database, migrations from scratch on the WP5 branch)
- Full pgTAP: 34 files, 2480 tests, Result PASS (includes 34_admin_order_issues and the 198-function allow-list in 01).
- Production build + e2e on that database, desktop and phone: e105 (reason required, stored on the existing event, seller notified once and sees the same words, staff with report:view see a read-only list, reviewer without it sees no access, direct RPC call by a buyer gets not_found, no money columns, Malay and Tamil), e100, e41: pass.

## Release steps (after approval)
1. Pre-checks: PR 27 CI green; diff shows only 000233.
2. Backup: follow "Backup and recovery" below (schema + DATA + storage listing, manifest, count comparison). A schema-only dump is NOT a backup. Confirm the restore comparison matches before applying anything.
3. `npx supabase db push --remote=tykdrzrszznwlcyxmgrg --dry-run` must list exactly `20260701000233_admin_order_issues.sql` (if WP4 is released first, exactly 000233 remains).
4. Apply with `--yes`; verify the function exists with the expected grants (`has_function_privilege`: anon false, authenticated true) and `migration list --remote`.
5. Merge PR 27, confirm CI on the merge commit, build and deploy the Worker with the production procedure, record the Version ID.
6. Smoke read-only: public pages en/ms/ta, protected routes redirect; the admin list and issue reporting need a signed-in staff account and real agreement data, so they are NOT testable without the owner and are covered by e2e.
## Backup and recovery (corrected, and the restore was tested)
Finding, read-only on 2026-11-19 (`supabase backups list --remote=tykdrzrszznwlcyxmgrg`): production has **PITR disabled and no physical backups listed**. So there is no platform recovery point; the ONLY recovery is the logical backup taken immediately before the release. (Owner decision, separate from this release: enable daily backups or PITR on the Supabase plan before real businesses use the platform.)
`supabase db dump` with no flags is **schema only**. The backup therefore has three parts, all written outside git to `C:\Users\User\inok-backups\<ref>-<UTC timestamp>\` with a `MANIFEST.sha256`:
1. Schema: `npx supabase db dump --remote=tykdrzrszznwlcyxmgrg -f schema.sql`
2. DATA: `npx supabase db dump --remote=tykdrzrszznwlcyxmgrg --data-only -s public,private,auth,storage -f data.sql` (rows of every application table, users, identities, buckets)
3. Storage objects: production currently holds 0 objects in 2 buckets (checked read-only); if that changes, list and download them and add `STORAGE-MANIFEST.txt`.
Restore test done 2026-11-19 (read-only dump of production, restored to an emptied local database that has the same migrations): data.sql loaded with `set session_replication_role = replica;`, and the row counts of all 99 `public` and `private` tables are identical to production, `auth.users` 6 = 6, `storage.buckets` 2 = 2. (Quirks: the target must be emptied first or the seed rows collide; auth session tables of the target need clearing too.) The same count comparison is the verification step after each backup: run the count query (`information_schema.tables` + `query_to_xml`) on production (read-only) and on the restored copy.
Recovery procedure if the release must be undone at data level: stop writes (take the Worker to the previous version), restore schema + data into a fresh Supabase project or the emptied database with the steps above, repoint, verify counts. Expect to lose anything written after the dump. Because this release is additive (nullable columns / one function), a data-level restore should never be needed; the rollback section below is the normal path.

## Final checklist (tick each before saying go)
- [ ] Owner approved applying the migration to production and deploying the Worker (two separate yeses)
- [ ] CI green on the PR and on the merge commit, pgTAP Result PASS
- [ ] Production migration list: only this migration missing
- [ ] Backup taken (schema + data + manifest) and row-count comparison matched
- [ ] Dry run lists exactly this migration
- [ ] Migration applied; read-only verification done
- [ ] PR merged; Worker built from the merge commit and deployed; Version ID recorded; previous Version ID noted
- [ ] Read-only smoke tests; signed-in flows reported as tested only if the owner signed in
- [ ] Notes updated

Order: database first, Worker second.

## Rollback
- App: `npx wrangler rollback <previous version>`; the old Worker never calls the function.
- Database: `drop function public.admin_order_issues(integer);` (nothing depends on it). No data is involved.
- Disaster recovery: restore from the pre-release dump as described in "Backup and recovery" (PITR is not enabled).
Note: the issue reason is stored inside the existing note text (`[reason] text`), so rolling back the app leaves such notes readable as plain text.

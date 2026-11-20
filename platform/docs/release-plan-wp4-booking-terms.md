# Production release plan: WP4 booking terms (PR 26, migration 000232)

Status: prepared, NOT executed. Needs the owner's explicit approval for (a) applying 000232 to production and (b) deploying the Worker.
No staging environment is used. Production already has 000231 and every earlier migration (checked read-only with `supabase migration list --remote`: only 000232 is missing).

## What the migration does
Additive: 5 nullable columns on `quotation_versions`, 4 columns on `orders` (`terms_locked` defaults to false), and three `create or replace` functions (`send_quote_version`, `private.deal_on_quote_change`, `set_order_details`). No table is dropped, no data is rewritten, grants are unchanged. Existing quotations and agreements keep null terms and behave exactly as before.

## Local verification already done (clean database, all 49 migrations from scratch, 000232 last)
- Full pgTAP: 34 files, 2487 tests, Result PASS (includes 33_quote_booking_terms, 13 erasure, 01 inventories).
- Production build + e2e on that database, desktop and phone: e104 (terms stored exactly, shown on the quotation card before accepting, revision to version 2, version 1 unchanged, agreement copies version 2 and locks it, edits refused with terms_locked, six database rejections, older draft cannot be sent, Malay and Tamil), e100, e41, e46, e98: all pass.
- Rollback script tested on a clean local database: `platform/supabase/rollback/000232_down.sql` restores the three previous functions; pgTAP 11 and 32 pass afterwards.

## Release steps (after approval)
1. Pre-checks: PR 26 CI green on the release commit; `git diff origin/release/inok-final -- platform/supabase/migrations` shows only 000232.
2. Backup: follow "Backup and recovery" below (schema + DATA + storage listing, manifest, count comparison). A schema-only dump is NOT a backup. Confirm the restore comparison matches before applying anything.
3. Dry run: `npx supabase db push --remote=tykdrzrszznwlcyxmgrg --dry-run` must list exactly `20260701000232_quote_booking_terms.sql`.
4. Apply: `npx supabase db push --remote=tykdrzrszznwlcyxmgrg --yes`.
5. Verify (read-only SQL): the 9 columns exist and are nullable (terms_locked not null default false); the three functions exist; `select count(*) from orders where terms_locked` = 0; row counts equal the snapshot; `supabase migration list --remote` shows 000232 on both sides.
6. Merge PR 26 into `release/inok-final`, confirm CI on the merge commit (pgTAP Result PASS).
7. Build from that commit with the production procedure (clean checkout, production URL and publishable key, bundle check), `wrangler deploy -c wrangler.production.jsonc`, record the Version ID.
8. Smoke (read-only; no data created in production): public pages in en/ms/ta, protected routes redirect, sign-in dependent flows reported as not tested unless the owner signs in.
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

Order matters: database first (old Worker ignores the new columns and keeps working), Worker second (the new Worker needs the columns).

## Rollback / recovery
- App only: `npx wrangler rollback <previous Worker version> -c wrangler.production.jsonc` (previous = the version live before this release). The old Worker works with the migrated database because the columns are nullable and unused by it.
- Database: normally NOT needed. If a function misbehaves, run `supabase/rollback/000232_down.sql` (restores the three previous functions; keeps the columns and any terms already agreed). Dropping the columns is optional, destructive and only for the case where no quotation with terms has been sent.
- Disaster recovery: restore from the pre-release dump as described in "Backup and recovery" (PITR is not enabled).
- Risk is low: additive columns, no data change, and no real businesses or agreements exist in production yet.

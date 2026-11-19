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
2. Backup: `npx supabase db dump --remote=tykdrzrszznwlcyxmgrg -f <backups>/tykdrzrszznwlcyxmgrg-<timestamp>.sql` (schema + data, outside git) and a read-only row count snapshot of quotation_versions and orders. Confirm the plan's backup/PITR status.
3. Dry run: `npx supabase db push --remote=tykdrzrszznwlcyxmgrg --dry-run` must list exactly `20260701000232_quote_booking_terms.sql`.
4. Apply: `npx supabase db push --remote=tykdrzrszznwlcyxmgrg --yes`.
5. Verify (read-only SQL): the 9 columns exist and are nullable (terms_locked not null default false); the three functions exist; `select count(*) from orders where terms_locked` = 0; row counts equal the snapshot; `supabase migration list --remote` shows 000232 on both sides.
6. Merge PR 26 into `release/inok-final`, confirm CI on the merge commit (pgTAP Result PASS).
7. Build from that commit with the production procedure (clean checkout, production URL and publishable key, bundle check), `wrangler deploy -c wrangler.production.jsonc`, record the Version ID.
8. Smoke (read-only; no data created in production): public pages in en/ms/ta, protected routes redirect, sign-in dependent flows reported as not tested unless the owner signs in.
Order matters: database first (old Worker ignores the new columns and keeps working), Worker second (the new Worker needs the columns).

## Rollback / recovery
- App only: `npx wrangler rollback <previous Worker version> -c wrangler.production.jsonc` (previous = the version live before this release). The old Worker works with the migrated database because the columns are nullable and unused by it.
- Database: normally NOT needed. If a function misbehaves, run `supabase/rollback/000232_down.sql` (restores the three previous functions; keeps the columns and any terms already agreed). Dropping the columns is optional, destructive and only for the case where no quotation with terms has been sent.
- Disaster recovery: restore from the pre-release dump or PITR (data loss since the backup).
- Risk is low: additive columns, no data change, and no real businesses or agreements exist in production yet.

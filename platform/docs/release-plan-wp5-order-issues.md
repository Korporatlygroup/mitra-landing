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
2. Backup: `npx supabase db dump --remote=tykdrzrszznwlcyxmgrg -f <backups>/<ref>-<timestamp>.sql`; confirm backup/PITR.
3. `npx supabase db push --remote=tykdrzrszznwlcyxmgrg --dry-run` must list exactly `20260701000233_admin_order_issues.sql` (if WP4 is released first, exactly 000233 remains).
4. Apply with `--yes`; verify the function exists with the expected grants (`has_function_privilege`: anon false, authenticated true) and `migration list --remote`.
5. Merge PR 27, confirm CI on the merge commit, build and deploy the Worker with the production procedure, record the Version ID.
6. Smoke read-only: public pages en/ms/ta, protected routes redirect; the admin list and issue reporting need a signed-in staff account and real agreement data, so they are NOT testable without the owner and are covered by e2e.
Order: database first, Worker second.

## Rollback
- App: `npx wrangler rollback <previous version>`; the old Worker never calls the function.
- Database: `drop function public.admin_order_issues(integer);` (nothing depends on it). No data is involved.
- Disaster recovery: pre-release dump or PITR.
Note: the issue reason is stored inside the existing note text (`[reason] text`), so rolling back the app leaves such notes readable as plain text.

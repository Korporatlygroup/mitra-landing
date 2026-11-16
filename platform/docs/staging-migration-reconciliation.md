# Staging migration-history reconciliation plan (status: PROPOSED, independently reviewed: approve with changes, changes applied below; NOT EXECUTED)

Target: Supabase project `udxzukodfqjzdukweygy` (mitra-staging). Nothing in this document has been run against hosted data. Re-checked read-only on 2026-11-11: hosted history unchanged (the same 11 execution-time versions). Evidence below was gathered with read-only queries (`supabase db query --linked --read-only`) on 2026-11-10.

## Findings
1. Hosted `supabase_migrations.schema_migrations` holds 11 rows. Their `name` columns equal the committed files `20260701000001` to `…011` (name part only), but their `version` columns are execution-time stamps (`20261110074212` … `20261110074243`).
2. The SQL stored in `statements` for all 11 rows is identical to the committed files (compared after removing whitespace): 11 of 11 IDENTICAL. So the schema is what the repo says it is.
3. Cause: the migrations were applied through an API that stamps the version with the time of execution (the Supabase MCP `apply_migration` tool), not through `supabase db push`, which records the filename version.
4. The CLI compares by version only. `supabase migration list` shows 14 local-only versions (`…01` to `…14`) and 11 remote-only versions. A `supabase db push` today would therefore try to re-run all of Phase 1 and 2 SQL against a database that already has it, and would fail or damage data. This is why automatic deployment must not be switched on yet.
5. Hosted staging has 0 users, 0 organisations, 18 tables in `public`+`private`, and one private bucket `verification-docs` (10 MiB limit, not public). Rebuilding is not needed and is not proposed.

## Proposal: relabel history only (no SQL re-run)
`supabase migration repair` edits only the `schema_migrations` bookkeeping table. It does not run migration SQL.

Step 0, backup and re-verify (read-only):
```
supabase projects list                                # confirm the target ref is udxzukodfqjzdukweygy (the org also holds SEA AI Academy projects)
supabase migration list --remote
supabase db query --remote --read-only "select version, name from supabase_migrations.schema_migrations order by version"   # snapshot of the 11 rows: the rollback list
supabase db dump --remote -f staging-before.sql      # schema dump kept outside git; also check the plan's backup/PITR
```
Step 1, mark the 11 execution-time versions as reverted (removes the 11 wrong rows):
```
supabase migration repair --remote --yes --status reverted 20261110074212 20261110074214 20261110074215 20261110074228 20261110074230 20261110074232 20261110074234 20261110074236 20261110074239 20261110074241 20261110074243
```
Step 2, mark the 11 filename versions as applied (inserts 11 rows):
```
supabase migration repair --remote --yes --status applied 20260701000001 20260701000002 20260701000003 20260701000004 20260701000005 20260701000006 20260701000007 20260701000008 20260701000009 20260701000010 20260701000011
```
Step 3, check:
```
supabase migration list --remote     # expect 11 matched pairs, 000012-000014 local-only
supabase db push --remote --dry-run  # expect it to list ONLY 000012, 000013, 000014, 000100, 000101, 000102, 000103, 000104, 000105, in that order (on the integrated branch; on the Phase 3 branch alone, only the first six)
```
Expected effect: no table, trigger, policy, function or bucket changes (the repair command never touches them). Only 11 history rows change. Note: whether `repair --status applied` also stores the local file's statements is not confirmed by the docs; it is harmless either way (the CLI compares versions). After repair, compare the `statements` column with the files read-only to settle it. `--yes` removes the CLI's confirmation prompt, so use it only after the owner approves. `--linked` is deprecated in v3; use `--remote`.

Rollback: Step 1/2 are reversible with the opposite `repair` commands using the original versions listed above.

Then, only with approval, apply hosted: `supabase db push` (applies 000012-000014, 000100-000102, 000103-000104 and 000105 in one pass), followed by the read-only verification queries in `integration/phase1-4-staging-deployment.md`.

## Open items before executing
- Independent review of this plan: done (approve with changes; applied below). A human owner should still read it before approval.
- Explicit approval from the project owner for steps 1-2 (they write to hosted history) and for the later `db push`.
- Confirm no one else (Codex) has applied other migrations to staging meanwhile: rerun Step 0.
- Do not touch the other Supabase projects in the organisation (SEA AI Academy).

## Changes required by the independent review (all applied above or listed here)
1. Use `--remote` (not `--linked`), and `--yes` only after approval.
2. **Ordering rule.** Every new migration version must be greater than the highest version already applied to hosted. A plain `db push` refuses migrations that sort before the last applied one, and `--include-all` would apply them out of order and let staging drift from a fresh `db reset`. Phase 3 addenda are `000100` to `000102`. **Decided 2026-11-11 (owner instruction): Phase 4's two migrations are renumbered `000103` and `000104` (content unchanged, renamed by Codex), and Phase 3's referral hand-off is `000105`.** All nine new versions go in one push. The exact sequence is in `integration/phase1-4-staging-deployment.md`.
3. Freeze other writers (MCP `apply_migration`, Codex, other developers) during the window; that tool caused the version mismatch. Applying migrations to staging should be done only by `supabase db push` from CI or one named person.
4. Step 1 and step 2 are separate commands; if step 2 fails the history is empty. Rollback is the reverse repair using the snapshot of the 11 original rows.
5. After repair, re-dump the schema and diff against `staging-before.sql` (expect no difference).
6. Check the project's backup/PITR tier; a schema dump is not a data backup (staging currently has no users or organisations).

## Update 2026-11-16 (integrated Phase 1-7 branch; still NOT EXECUTED)
- Hosted `mitra-staging` re-checked read-only: unchanged (the same 11 execution-time history rows, 0 users, 0 organisations, 17 public tables and 1 private table, 18 policies, bucket `verification-docs` only). Extensions present: citext, pgcrypto, uuid-ossp, pg_stat_statements, supabase_vault, plpgsql. The local migrations need only citext and pgcrypto.
- The integrated branch has 40 migration files. After the repair in this document, `supabase db push --dry-run` must list exactly these 29 versions, in this order: `20260701000012`, `…013`, `…014`, `…100` to `…107`, `…110` to `…116`, `…150` to `…153`, `…200`, `…201`, `…210`, `…220`, `…221`, `…222`, `…223`. All sort above the repaired `…011`, so the ordering rule holds. No number is duplicated.
- New since the earlier plan: `222` recreates two RLS policies (performance only, same rules) and `223` inserts the private `verification-docs` bucket with `on conflict do nothing`. On `mitra-staging` the bucket already exists with the same settings (private, 10 MiB), so 223 changes nothing there. A brand-new project (`inok-production`) now gets the bucket from migrations; before 223 it would have had none (it lived only in local `config.toml`).
- `221` renames the operator organisation only when it still carries the old name and replaces `bootstrap_first_admin`; staging has 0 organisations, so it is a no-op there.
- Data risk on staging: none of the 29 migrations deletes or rewrites existing rows in the Phase 1-2 tables (staging holds no business data anyway). The local upgrade rehearsal with synthetic data proved row-for-row preservation for Phase 1-6 tables.
- Still required before executing: owner approval of the repair and of the push, a frozen-writers window, and the snapshot of the 11 original history rows.

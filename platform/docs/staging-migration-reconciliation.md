# Staging migration-history reconciliation plan (status: PROPOSED, NOT EXECUTED)

Target: Supabase project `udxzukodfqjzdukweygy` (mitra-staging). Nothing in this document has been run against hosted data. Evidence below was gathered with read-only queries (`supabase db query --linked --read-only`) on 2026-11-10.

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
supabase migration list --remote
supabase db dump --linked -f staging-before.sql      # schema dump kept outside git
```
Step 1, mark the 11 execution-time versions as reverted (removes the 11 wrong rows):
```
supabase migration repair --status reverted 20261110074212 20261110074214 20261110074215 20261110074228 20261110074230 20261110074232 20261110074234 20261110074236 20261110074239 20261110074241 20261110074243
```
Step 2, mark the 11 filename versions as applied (inserts 11 rows):
```
supabase migration repair --status applied 20260701000001 20260701000002 20260701000003 20260701000004 20260701000005 20260701000006 20260701000007 20260701000008 20260701000009 20260701000010 20260701000011
```
Step 3, check:
```
supabase migration list --remote     # expect 11 matched pairs, 000012-000014 local-only
supabase db push --dry-run           # expect it to list ONLY 000012, 000013, 000014
```
Expected effect: no table, trigger, policy, function or bucket changes (the repair command never touches them). Only 11 history rows change. Note: `repair --status applied` stores the version and name but not the original `statements`; this is cosmetic.

Rollback: Step 1/2 are reversible with the opposite `repair` commands using the original versions listed above.

Then, only with approval, apply Phase 3 hosted: `supabase db push` (applies 000012-000014 in one pass), followed by hosted pgTAP-equivalent smoke checks.

## Open items before executing
- Independent review of this plan (a second reviewer reads the plan and the read-only evidence). Not done yet.
- Explicit approval from the project owner for steps 1-2 (they write to hosted history) and for the later `db push`.
- Confirm no one else (Codex) has applied other migrations to staging meanwhile: rerun Step 0.
- Do not touch the other Supabase projects in the organisation (SEA AI Academy).

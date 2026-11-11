# Phases 1-4: integration and exact staging deployment sequence (status: PROPOSED, NOTHING EXECUTED)

Date: 2026-11-11. Target: Supabase project `udxzukodfqjzdukweygy` (mitra-staging). The CLI labels this project's environment `production`; it is the only MITRA project and holds 0 users and 0 organisations, but the label is a reason to treat every write step as needing approval. The other projects in the organisation (SEA AI Academy) are never touched: always confirm the ref in the first output line of each command.

Read-only re-check on 2026-11-11: hosted `schema_migrations` still holds exactly the 11 execution-time versions `20261110074212` to `20261110074243`; no local version `…0001` to `…0014` is recorded. Nothing has changed since the plan was written.

## 1. What is being deployed

Migration files, in version order, as they exist on branch `integration/phase1-4`:

| Version | File | Owner | Status on hosted |
|---|---|---|---|
| `…000001`-`…000011` | Phase 1-2 | Claude/Codex (done) | applied under other version numbers (history repair only, no SQL) |
| `…000012` `…013` `…014` | `p3_directory_schema`, `p3_listing_rpcs`, `p3_request_rpcs` | Phase 3 | to apply |
| `…000100` | `p3_request_board` | Phase 3 | to apply |
| `…000101` | `p3_ms_language` | Phase 3 | to apply |
| `…000102` | `p3_portfolio_fields` | Phase 3 | to apply |
| `…000103` | `p4_schema` (was `…000015`, content unchanged) | Phase 4 | to apply |
| `…000104` | `p4_workflows` (was `…000016`, content unchanged) | Phase 4 | to apply |
| `…000105` | `p3p4_referral_handoff` | Phase 3 | to apply |

Order rule: every version is above everything already applied, so a plain `supabase db push` accepts them and applies them once, in order. `--include-all` is never used.

## 2. Local evidence for this exact set (not hosted evidence)

Fresh local database, migrations 1-105 applied in one pass, then: pgTAP 12 files, 1,062 assertions pass (Phase 1-3 and 4 suites plus 40 hand-off assertions H1-H38); unit 301; integration 115 pass and 2 skipped; typecheck and lint (0 errors, 4 old warnings); production build. Browser run: see the report. All of this is local; none of it is hosted staging.

## 3. Preconditions (all must be true before step 1)

1. The project owner approves in writing: step 4 and 5 (history repair), step 7 (schema push) and step 9 (hosted smoke test). Each approval covers only that step.
2. One named person (or one CI job) is the only writer to staging for the window. The Supabase MCP `apply_migration` tool, other developers and Codex do not touch staging. Repeat the read-only list in step 2 immediately before step 4.
3. Branches: Phase 3 (PR #6) and Phase 4 (renamed to `…103`/`…104`) are on the branch that will be deployed, reviewed, and CI green on that branch. The deployed commit SHA is recorded.
4. Backup: check the project's backup/PITR tier. A schema dump is not a data backup; staging has no users, so the dump is the practical rollback source.

## 4. Sequence

Run from `platform/`, with `supabase` v3. `--remote` is the v3 spelling (`--linked` is deprecated). `--yes` is used only after approval.

```
# 0. identify the target (read-only). Repeat immediately before steps 4, 5 and 7: db push / migration repair do not print the ref.
supabase projects list                                    # the LINKED column must show udxzukodfqjzdukweygy
cat supabase/.temp/project-ref                            # must print udxzukodfqjzdukweygy (re-run `supabase link --project-ref udxzukodfqjzdukweygy` in this checkout; .temp is per checkout)
supabase <command> --help                                 # check that --remote exists for each command on the installed CLI; a wrong flag must not fall back to the local DB
# 1. snapshot (read-only; outside git)
supabase db query --remote --read-only "select version, name from supabase_migrations.schema_migrations order by version" > staging-history-before.txt
supabase db dump --remote -f staging-schema-before.sql
# 2. re-verify nothing moved
supabase migration list --remote                          # expect 11 remote-only versions 20261110074212..243 and nothing else
# 3. dry run of the push as it stands today (read-only): shows the problem
supabase db push --remote --dry-run                       # expected to refuse or list history mismatches: this is why the repair comes first. Never run without --dry-run before step 7.
# 3b. statements check (read-only): compare the `statements` of the 11 hosted history rows with the files 000001..000011 of THIS branch (whitespace-insensitive); require 11 of 11 identical before step 5.
# 3c. fresh-local dump (supabase db reset on a local stack) vs staging-schema-before.sql: require no semantic difference BEFORE step 7, not only after.
# 4. APPROVAL NEEDED. History repair, step A: remove the 11 wrong rows
supabase migration repair --remote --yes --status reverted 20261110074212 20261110074214 20261110074215 20261110074228 20261110074230 20261110074232 20261110074234 20261110074236 20261110074239 20261110074241 20261110074243
# Run 4 and 5 back to back; between them hosted history is empty. Save the step 6 dry-run output and check it mechanically against the nine versions.
# 5. history repair, step B: record the 11 filename versions as applied
supabase migration repair --remote --yes --status applied 20260701000001 20260701000002 20260701000003 20260701000004 20260701000005 20260701000006 20260701000007 20260701000008 20260701000009 20260701000010 20260701000011
# 6. verify the repair: schema unchanged, history relabelled
supabase migration list --remote                          # expect 11 matched pairs, 000012..000105 local-only (9 files, order shown below)
supabase db dump --remote -f staging-schema-after-repair.sql   # diff against staging-schema-before.sql: expect no difference
supabase db push --remote --dry-run                       # expect exactly: 000012 000013 000014 000100 000101 000102 000103 000104 000105, in that order
# 7. APPROVAL NEEDED. Apply the new schema (one pass)
supabase db push --remote
# 8. verify the schema (read-only, see section 5)
```

If step 6's dry run lists anything other than those nine versions, or a `000001`-`000011` entry, stop.

## 5. Verification after the push (read-only queries, all must hold)

Using `supabase db query --remote --read-only`:
- `select count(*) from supabase_migrations.schema_migrations` = 20 (11 + 9) and versions are the 20 file versions.
- Public base tables = 35; every table in `public`/`private` has `relrowsecurity` true (the S6.x checks of `01_rls_and_grants.test.sql`).
- `anon` can execute only `get_listing`, `list_published_business_reviews`, `search_listings` in `public`/`private`; `authenticated` can execute exactly the 62 RPCs listed in test `S7.6`; every SECURITY DEFINER function has `search_path` set to empty (S7.1-S7.3 of the same file).
- `public.referral_handoffs` exists with RLS on and a select policy only; `public.profiles` language check accepts `ms`.
- Grants on the new table: `anon` has none; `authenticated` has select only (`information_schema.role_table_grants` for `public.referral_handoffs`).
- Schema equality: `supabase db dump --remote` after the push compared with a dump of a fresh local database (`db reset`) has no semantic differences (ignore ordering/comment noise).
- Hosted security advisors (dashboard or `supabase db advisors` if available) show nothing new at error level.

## 6. Hosted smoke test (needs a deployed app: not possible yet)

Needs, per `docs/staging-readiness.md`: a hosting project (none exists), staging env vars, auth redirect URLs, SMTP, a cron secret, and a malware scanner (ClamAV) or a documented decision to keep document upload disabled. Then, with synthetic accounts only: sign-up and sign-in (EN/TA/MS); seller onboarding and listing review; buyer request (private and board); seller reply; quote and revision; referral proposal, buyer consent, recipient acceptance, hand-off conversation; reviews; admin moderation. Record the deployed commit SHA that serves the app, not only a green build.

## 7. Rollback and failure handling

- Forward-fix for the Phase 3 hand-off, prepared but not applied: a migration numbered with the next free version (not reserved here) that drops `public.open_referral_enquiry(uuid)` and `public.referral_handoffs` (and nothing else).
- Any other database (local, preview branch) that already recorded `…000015` or `…000016` from Codex's earlier numbering must be reset; it would otherwise see unknown versions.
- `supabase db dump` needs Docker on Windows.

- History repair (steps 4-5) is reversible with the opposite commands and the version list in `staging-history-before.txt`; it never changes tables.
- A failed `db push` stops at the failing file; earlier files stay applied, the failing file's transaction rolls back. Fix forward with a new, higher-numbered migration. Never edit an applied file and never delete one.
- Staging data is disposable only in the sense that it is empty today. Do not reset it without the owner's explicit instruction.
- Nothing in this plan changes the SEA AI Academy databases or any production system.

## 8. Decisions still needed from the owner

1. Approve steps 4-5 and 7 (separately), and name the single person/job that runs them.
2. Choose hosting (Vercel or other) and provide the staging environment variables, redirect URLs and SMTP, or accept that hosted smoke tests happen after that.
3. Scanner: provision ClamAV for staging or keep document upload off for the Friday demo.
4. Confirm the Phase 4 numbering above (`…103`/`…104`, then `…105`) and that Codex renames its two files itself.

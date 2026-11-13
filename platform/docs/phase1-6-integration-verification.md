# INOK Phase 1–6 local integration verification

The local integration branch `codex/integration-phase1-6` combines the latest
`feature/phase5-supplier-catalogue` (`a370105`), the Phase 4 account-erasure
merge on `integration/phase1-4` (`ee80544`), and Phase 6 (`b2aba4d`). No
commit from this branch has been pushed, merged remotely, deployed or applied
to hosted Supabase.

## Migration reconciliation

The Phase 4 integration branch supplied migration 106. Phase 6 had carried a
different local migration with the same version. The combined branch keeps
the authoritative 106 and applies the additional identity and audit redaction
as migration 107. Phase 5 migration 116 is retained unchanged. The resulting
sequence is 1–14, 100–107, 110–116, 150–153: 33 unique versions.

On a fresh isolated local Supabase project (`inok-phase1-6-check`, ports
58960–58969), all 33 migrations applied in order. The private
`verification-docs` bucket has a 10 MiB limit and allows PDF, JPEG and PNG.
RLS is enabled on all 14 Phase 6 sourcing tables.

The database suite exercises authenticated and anonymous grants, cross-organization
RLS, quotation immutability, participant erasure, audit redaction and sourcing
document cleanup. The browser and HTTP suites exercise private upload size and
type limits, scan quarantine and rescan, download authorization, product and
supplier moderation, and partner isolation. The Phase 5 review-fix test file
for migration 116 and its buyer, partner and admin browser journeys passed.

## Local test evidence

| Check | Result |
|---|---|
| Fresh migrations | 33/33 applied |
| Database pgTAP | 21 files, 2,161 assertions passed |
| Platform unit | 31 files, 806 tests passed |
| Platform integration | 17 files passed; 144 tests passed, 2 first-admin tests conditionally skipped on the already bootstrapped browser stack |
| Platform typecheck and build | Passed |
| Lint | Passed with 0 errors and 6 pre-existing test warnings |
| Astro check and build | Passed, 0 diagnostics |
| Playwright mobile | All 182 cases passed across eight sequential shards |
| Playwright desktop | All 182 cases have a passing run across eight shards; one worker exit in shard 6 was rerun alone and passed |
| Phase 5 HTTP integration | 15 tests passed against a running local app |
| Production dependency audit | `npm audit --omit=dev`: 0 vulnerabilities |

The first integration attempt lacked the ignored local stack environment file
and collected no tests. A later run suffered a Windows Vitest fork exit
(`3221226505`); its affected race-test file passed alone, and the full suite
passed with the thread pool and one worker. The Phase 5 HTTP suite was then
enabled against a running app. After the browser run, the MFA audit test exposed
an unbounded-history assumption: it looked for a newly written invitation in
an arbitrary first page of 50 audit rows. The test now filters by the exact
invitation ID. The full integration suite then passed with 144 tests and two
conditional first-admin skips. Those checks intentionally avoid altering an
already bootstrapped browser stack.

The initial unsharded Playwright attempts were not reliable: a Next process
stopped serving requests mid-run, causing cascading connection failures, and
one Windows Playwright worker exited with code `3221226505`. A separate fresh
browser stack was used so Playwright could create its own first administrator.
The complete mobile and desktop test inventories were then run as eight
sequential shards per viewport, giving each shard a fresh app process. All
182 mobile tests passed. Seven desktop shards passed outright; one desktop
shard had 19 passing tests and one worker exit before execution. The interrupted
partner inbox test passed alone. One other desktop shard lost its server after
18 passing cases, then passed all 27 cases on a fresh rerun. Thus each of the
364 distinct browser cases has a passing local run; a single uninterrupted
364-case process run has not passed. The E2E setup now fails early if a
bootstrapped local database lacks the matching admin state file.

## Deployment boundary

Hosted migration history, real hosted Auth and Storage behavior, scanner
connectivity, scheduled cleanup/reminders, and staging browser journeys still
require approval and separate staging verification. The Phase 5 and earlier
private Storage orphan-cleanup limitation remains documented in the Phase 6
architecture. Existing Phase 1–5 translation copy still contains MITRA
branding in places. Windows test-runner and app-process exits remain an
infrastructure stability concern for a single long CI run. The package install
reported nine moderate development-dependency advisories; the production-only
audit reported none.

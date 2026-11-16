# INOK Phases 1 to 7: integration and staging-readiness report

Date: 2026-11-16. Branch `integration/phase1-7` (worktree `MITRA-P17`), head `6796fdf`. Everything here is **local** evidence on one Windows 11 machine (Node 24.15, local Supabase stack, Docker). Nothing was pushed, deployed or run against a hosted database, and no hosted verification is claimed. `platform/supabase/config.toml` has a local port remap and is intentionally left uncommitted.

## 1. Git
- The branch merges the Phase 1-6 integration line (`516170a`) with the Phase 7 branch (`394ab82`) and the INOK redesign. The merge is `c23d89b`; the later commits are fixes and tests on top (37 commits after `516170a` in total).
- Conflict resolution (all re-checked programmatically; only expected differences remain): `NotificationList`, `notification-ui` (the ten Phase 6 `sourcing_*` kinds were added to the shared helper), `SiteHeader`, `i18n/messages.ts`, the e2e i18n loader, and the RLS/grant pgTAP lists (179 authenticated RPCs, 36 service-role functions, 87 tables).
- Commits after the merge: upgrade rehearsal scripts, admin workflow browser tests, branding (with migration 221), account-menu fix, documents, mobile layout fix, unit test.
- Working tree: only `supabase/config.toml` (local ports) is modified. Remote: nothing pushed; the two repositories share a remote, cross-repository fetch was done locally.

## 2. Database
- Fresh `supabase db reset` applies every migration; pgTAP: **29 files, 2416 assertions, all pass** (final head, including migration 222).
- Upgrade rehearsal on a disposable copy migrated to `...153` with synthetic Phase 1-6 data (users, organisations of every type, listing, request, enquiry, RFQ, claims, notifications), then upgraded: per-table row counts and hashes unchanged for every pre-existing table; pgTAP also passes on the upgraded database. Scripts: `supabase/dev/upgrade-rehearsal-*.sql`.
- Migration numbers 200-221 do not overlap 150-153; no duplicates found. Migration 221 only renames the operator organisation and replaces `bootstrap_first_admin` (body identical apart from one literal).
- **Row-level security performance (approved by the owner, applied locally only):** `audit_log_select` and `verification_events_select` called `private.has_platform_permission(...)` once per row (1.7 s for an unprivileged user with about 9.4k audit rows). Migration `20260701000222_rls_initplan_platform_permission.sql` recreates both policies with the same rules but `(select private.has_platform_permission(...))`, so it runs once per statement. pgTAP `28_rls_initplan.test.sql` (5 assertions) checks the policy text, that a user without the permission still sees no rows, and that the plan contains an InitPlan. Not applied to any hosted database.
- Hosted database: not touched. The hosted migration history reconciliation (`docs/staging-migration-reconciliation.md`) is still an owner decision.

## 3. Phase 7 (Government Assistance Navigator)
- Browser-verified locally: register source, propose settings, second administrator approves, manual entry, closing edit, archive, audit trail (`e82`, plus `e80`, `e81`, `e91`).
- Scheduler routes `/api/v1/jobs/gov` (bearer `GOV_WORKER_SECRET`, 404 when unset) and `/api/v1/jobs/rescan` (bearer `CRON_SECRET`): POST only, 60 s max duration, leases, backoff, `SKIP LOCKED` outbox. A concurrent-worker integration test proves two overlapping workers send one email and one in-app notification. No schedule is live.
- Source status (`docs/phase7-source-verification.md`): TEKUN and two page-monitor candidates work against the real pages (read-only, robots respected); SME Corp returns 403 and stays manual; a fresh catalogue has **no programmes**, so nothing is "verified" yet. A person must verify each record before publication.
- Notifications: 14-day and 3-day reminders, stale notices, preferences, deduplication and failed-delivery paths are covered by integration tests. A "required information is missing" notification was assessed and deliberately not built (documented as a non-blocking enhancement to avoid unnecessary alerts).
- Languages: Bahasa Melayu and Tamil have 0 missing keys, but **no human reviewer has approved the wording** (`docs/i18n-coverage.md`).

## 4. Testing (exact results, local, final head unless stated)
| Gate | Result |
|---|---|
| `tsc --noEmit` | clean |
| ESLint | 0 errors; 6 warnings (pre-existing). Two `no-explicit-any` errors in my new unit test were fixed |
| Production build | succeeds |
| Unit (`vitest --project unit`) | 38 files, **942 passed** |
| pgTAP | 29 files, **2416 passed**, fresh database (28 files / 2411 before migration 222) |
| Integration, process pool, one run | 18 files passed, 1 skipped; 158 passed, 15 skipped, **1 worker crash (exit 3221226505) on `scan-queue.test.ts`**. This run is **not clean**. |
| `scan-queue.test.ts` rerun alone (separate) | 2 passed |
| Integration, thread pool, full (separate run) | 19 files passed, 1 skipped; 159 passed, 15 skipped, no crash |
| Integration, thread pool, full, after migration 222 (separate run) | 19 files passed, 1 skipped; 159 passed, 15 skipped, no crash |
| Playwright desktop, full (210) | 206 passed, 1 skipped, **3 failed**: e27-staleness and e73 (worker crash 3221226505), e50-ms (`EADDRINUSE` ephemeral-port exhaustion in the test runner) |
| Desktop rerun of those 3 specs only (separate) | 11 passed |
| Playwright mobile, full (210) | 192 passed, 15 skipped, **3 failed**: real layout bugs at 360 px (e21 ta, e28 ta: width 367; e40: width 361) |
| Mobile rerun 1 after the tag fix, e21 + e28 + e40 only (separate) | 14 passed, 1 failed (e40, the Tamil directory search form 1 px too wide) |
| Mobile rerun 2 after the search-form fix, e40 only (separate) | 3 passed |
| Desktop e21 + e28 + e40 against the final CSS (separate) | 15 passed |

- The full desktop and mobile runs were not re-run end to end after the CSS fix; only the affected specs were. The CSS change is limited to `.tag` (wraps below 480 px) and `.dir-search` (min-width 0).
- An earlier full desktop run tested a stale server (old build, port still held) and was discarded.
- Security regression: RLS, grant and RPC pgTAP lists, `rpc-security`, hardening, MFA and upload/scan journeys are inside the suites above. They passed except as listed.

### The recurring crash 3221226505
Documented in `docs/test-runner-crash-investigation.md`. It is `STATUS_STACK_BUFFER_OVERRUN` (a fast fail), seen when a worker process starts. Process pool: 4 crashes in 12 full integration runs (a different file each time); thread pool: 0 of 4; unit suite: 0 of 40; bare Node: 0 of 1500. No diagnostic report, no Windows error entry. Not established: the fast-fail sub-code, and whether Defender, CET shadow stack or memory pressure (about 3 GB free, 58-64 Docker containers) is involved. No application code was changed to hide it. Follow-ups that need approval are listed in that document (WER dumps, Defender exclusion, CET test, Node 22 comparison).

## 5. Hosting (assessment only)
See `docs/phase1-7-staging-readiness.md`. Summary: the app needs Node features (`dns.lookup`, `node:https`, SMTP and clamd TCP sockets, Next 16 proxy on Node) that Cloudflare Workers does not fully provide. Recommended: Vercel (or a container host) for the app, Cloudflare for DNS and the existing `inok.my` landing page (not modified), and a Cloudflare Cron Trigger Worker that POSTs to the job routes. Vercel classic cron sends GET and Hobby is daily only, so it is not used for the 15-minute jobs. Staging domain must be DNS-only. Nothing was created or configured.

## 6. Deployment readiness
**Classification: Ready for staging with conditions.** (Local verification only; hosted staging is unverified.)

Blocking conditions before the first staging deploy:
1. Owner-approved reconciliation of the hosted migration history.
2. A real ClamAV (clamd) endpoint and private storage; uploads must not be served unscanned.
3. A mail provider (SMTP) with sender domain set up.
4. Hosted auth settings: the confirm and reset email templates and subjects ("Confirm your INOK account", "Reset your INOK password"), site URL and redirect allow-list. `config.toml` is local only.
5. All secrets set in the host (`GOV_WORKER_SECRET`, `CRON_SECRET`, Supabase keys, mail, scan).

Conditions that can follow shortly after:
6. Apply migration 222 (RLS performance, approved, local only) to staging with the other migrations.
7. Create the scheduler Worker only after approval; keep source monitoring switched off until a person has verified the sources.
8. Human verification of the programme records before publication; no programme is published today.
9. Native review of the ms and ta wording.
10. Crash follow-ups; keep the process pool in CI and use `--pool=threads` locally meanwhile.
11. Landing page: add links only after staging passes (no change made). Suggested navigation: Register Your Business, Sign In, Explore Businesses, Business Support. Do not label registration as official MITRA enrolment, and make no government-affiliation claims.

Nothing is pushed or merged. Waiting for approval for any remote change, deployment or hosted migration.

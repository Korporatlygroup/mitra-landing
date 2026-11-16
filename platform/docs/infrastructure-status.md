# INOK infrastructure status (2026-11-16, late evening; supersedes the earlier evening version below where they differ)

## Production, later the same evening (project created by you in the dashboard)
- **`inok-production`** (ref `tykdrzrszznwlcyxmgrg`, API https://tykdrzrszznwlcyxmgrg.supabase.co, Free plan, Postgres 17.11) is **ACTIVE_HEALTHY**. **Region is ap-northeast-1 (Tokyo), not Singapore** as planned; a region cannot be changed later, so keep it (about 70 ms further from Malaysia than Singapore; not measured here) or recreate it in Singapore while it is still empty.
- **Migrations applied: all 41 (through 224)**, one push, exit 0 (`production-push-2026-11-16.log`, outside git). Verified against the local database at the same head: 87 public tables, 3 private, RLS disabled on 0 public tables, 88 policies, 215 public and 113 private functions, 207 indexes, `anon` has 0 table grants, buckets `catalogue-media` and `verification-docs` private with the same limits. Hosted advisors: 193 warnings, 0 errors (same by-design findings as staging: 13 public and 179 authenticated security-definer functions, 1 permissive-policy note). **The database holds no data**: 0 users, 0 organisations, 0 audit rows. No fixtures, no test accounts, no staging data.
- **Auth** (`deploy/supabase-auth/production.toml`, pushed): **public sign-up OFF** (`signup_disabled` confirmed with a real request), Site URL `https://app.inok.my`, redirect list = `app.inok.my/auth/callback` plus the private Worker URL, password rule 10 characters with upper, lower and digit, email confirmation on, TOTP MFA on. Email templates not applied (Free plan, no custom SMTP).
- **`inok-app-production`**: **deployed privately** at https://inok-app-production.long-wind-0982.workers.dev (version `c2b66897`). Built with the production URL and key only (bundle contains 0 references to the staging project, 11 to production); own secrets (`SUPABASE_SECRET_KEY`, `CRON_SECRET`, `GOV_WORKER_SECRET`, `ACCESS_GATE_KEY`); same access gate as staging (401 without the key, 200 with it); no `app.inok.my` route, no scheduler. The production access key is in the scratchpad file `production-access-key.txt`.
- **Production checks done without creating data**: sign-up refused; anonymous `create_org` refused; anonymous read of `organisations` denied; the private bucket's public URL refused; the public directory function answers for anonymous callers (as designed). Not done on production, deliberately: any user journey (there is no production data and no test accounts).
- **Backups for production**: none yet (the Free plan has none; the database is empty). Run `deploy/backup/restore-test.sh` after the first real data, then on a schedule.
- The Supabase MCP server for this project was added to `.mcp.json` in the app worktree (project scope, not committed); it takes effect after the session restarts and you approve it.

## Update after the Free-plan decision (no paid resources)
- **Staging is now protected**: `inok-app-staging` is behind an access gate in the Worker (`cf-entry.mjs`): every page and API call except `/api/v1/health` and the two scheduler job routes (which have their own secret) answers 401 without the access key (HTTP Basic, any user name, the key as password; or the `x-inok-access-key` header). Verified from outside: 401 without the key, 200 with it, 401 with a wrong key. The key is a Worker secret; a copy for testers is in the session scratchpad file `staging-access-key.txt` (give it to browser agents through their secret store, not in scripts). Cloudflare Access can replace it later if you create the Access application.
- **Hosted tests: 11 of 11 pass** (`tests/hosted`): the 8 earlier checks plus quotation negotiation (seller replies and quotes, buyer requests a change, seller revises, buyer accepts, a stranger is kept out), the government programme journey (manual entry, second-administrator approval enforced in page and database, public page, business saves and tracks it, closing edit, archive, audit trail) and password recovery (link, weak password refused, new password works, old password and the link do not; the recovery token was generated with the admin API because no mail provider exists).
- **Backup and restore**: procedure and script in `backup-and-recovery.md`; actual restore test passed (staging data restored into a disposable database, 98 tables and 474 rows identical by content hash).
- **`inok-production`: NOT created.** The create command was blocked by the tool permission layer in this session (it denied `supabase projects create` twice, even with your instruction). The organization has a free slot (one active project, `mitra-staging`; three paused). Nothing was created, changed or charged. To proceed, either create the project in the dashboard (name `inok-production`, region Southeast Asia (Singapore), Free plan), or allow the command in the Claude Code permission settings and tell me. Then I apply migrations through 224, configure Auth (public sign-up off, Site URL `https://app.inok.my`), run the advisors, and deploy `inok-app-production` privately: its config (`wrangler.production.jsonc`) and a build guard that refuses the staging project are ready.
- **Malware scanner**: options and the safe state are in `malware-scanning-options.md`; nothing provisioned, uploads stay quarantined.
- Email templates and the transactional provider: untouched, as instructed.


Evidence below was produced against the real services (Cloudflare account, Supabase `mitra-staging`) unless marked "local" or "not done". No credential appears in this document.

## Source
- Repository `Korporatlygroup/mitra-landing`, branch `integration/phase1-7` (new branch, pushed without force; `main` and the landing Worker's branch are untouched). Contains Phase 1-7, migrations through 224, the Cloudflare adapter and Worker configuration, the Workers fetch transport, the layout and saved-form fixes.

## Cloudflare (account `e28ff6ab…`, one account)
| Item | Status |
|---|---|
| Wrangler authentication | **Connected** (OAuth, scopes limited to Workers, routes, KV, D1, tail, zone read). No Access, DNS-write or R2 scope. |
| `mitra-landing` (inok.my) | **Unchanged**: last deployment 2026-11-13, `inok.my` answers 200. |
| `inok-app-staging` | **Deployed and verified**: https://inok-app-staging.long-wind-0982.workers.dev (Worker start-up 15 ms, bundle 2,993 KiB gzip). Built against `mitra-staging` only (guard in `scripts/cf-build.mjs`). Secrets set: `SUPABASE_SECRET_KEY`, `CRON_SECRET`, `GOV_WORKER_SECRET`. Variable: `SITE_URL`. Not set (fail closed): SMTP, scanner, `GOV_WORKER_CONTACT`. **Currently publicly reachable: Cloudflare Access is not configured yet.** |
| `inok-scheduler-staging` | **Deployed**, service binding to the app, manual trigger (`/run/gov`, `/run/rescan`, own secret). One controlled execution: both job routes returned 200 end to end into the hosted database (the database switches are off, so no work was done). Cron triggers now enabled: every 15 min (gov monitor), every 10 min (rescan). |
| `inok-app-production` | **Not created**: it needs the `inok-production` project's URL and publishable key at build time. |
| `staging.inok.my`, `app.inok.my` | **Not attached.** Staging domain waits for Access (below); production waits for acceptance. |
| Cloudflare Access | **Blocked, needs you**: the OAuth login has no Access scope. Needs either an API token with Zero Trust: Access Apps and Policies (Edit) for this account, or you create the Access application in the dashboard for the staging Worker (hostname `inok-app-staging.long-wind-0982.workers.dev` now, `staging.inok.my` later) with an allow policy for named testers plus a service-token rule for browser agents. |

## Supabase
| Item | Status |
|---|---|
| `mitra-staging` migrations | **Done**: history repaired, 41 migrations applied (through 224); verified against local; advisors 0 errors. Details in `staging-migration-reconciliation.md`. |
| `mitra-staging` Auth settings | **Pushed**: Site URL and redirect list = the staging Worker, password rule (10 characters, upper, lower, digit), MFA (TOTP) on, email confirmation on. |
| Email templates | **Prepared, not pushed**: 8 INOK-branded responsive templates (English, Malay and Tamil bodies chosen by the `language` stored at sign-up; Malay and Tamil wording is a draft awaiting native review). The Supabase API refuses template changes: the organisation is on the **Free plan** with the default email provider (`entitlement_required`). They go live when a custom SMTP provider or a paid plan exists. |
| `inok-production` | **Not created: billing.** The organisation `korporatlygroup` is on the Free plan (the API says so). A production project needs a paid plan: Free projects pause when idle and have no backups. The actual price must be confirmed by you in the dashboard (billing page of the organisation); I did not create anything. |
| Storage | Migration 223 applied; both buckets are private, no storage policy for any API role; hosted test confirms anon, buyer and seller cannot list, read or write the verification bucket. Scanner not connected (see below). |

## Hosted tests (browser and API, real Worker, real staging database, disposable accounts)
8 of 8 passed (`tests/hosted/staging.spec.ts`): public pages and CSP on the Worker; buyer sign-in through the real form, session reload, sign-out redirect; seller creates a business organisation through the UI and owns it (hosted write); tenant isolation (the buyer sees no organisation, members, business profile or audit rows and cannot add themselves); anonymous and low-privilege callers refused privileged functions, the first-admin function and the admin console; private bucket closed for every API role; administrator through the browser with the TOTP step and console access, a session without the second step refused; token refresh works and a global sign-out revokes it.
**Not tested on hosted yet:** the full buyer-to-quotation and seller-response journeys, sourcing, government programme journeys with data, document upload and download, password-recovery and confirmation emails (no mail provider), the scheduled run doing real work. The local suites cover those journeys (Node: 209/210 and 195/210 browser tests pass, rest skipped by design).
Test accounts are staging-only and tagged `hosted-<run>@example.test`; their passwords exist only inside the test process and were not saved.

## Malware scanner (evaluation, nothing provisioned)
A Worker cannot run the ClamAV daemon. The application already speaks the clamd protocol over TCP (works from a Worker; tested). Options, all outside Cloudflare Workers: (1) a small always-on container running `clamav` (clamd on 3310, reachable only through a private tunnel or an allow-listed address), on Fly.io, a small VM, or Cloudflare Containers (needs the Workers Paid plan); (2) a hosted scanning API behind a small adapter. Expected cost for option 1 is the price of the smallest always-on instance with about 2 GB of memory (ClamAV needs roughly that for signatures); I did not verify current prices. Until one exists, uploads stay quarantined and unreadable (fail-closed, tested). I will not provision a paid scanner before you approve the monthly cost.

## Costs and approvals needed
1. Supabase paid plan for the organisation (and the production project's compute) before `inok-production` can be created and before the email templates can be pushed without custom SMTP.
2. Cloudflare Workers Paid plan if the account is on the free plan (the staging deploys succeeded; CPU-time limits on real load are unverified). Please check the account's plan in the dashboard.
3. A scanner host (option 1 above) when you choose one.
4. An email provider (last).

## Open defects and risks
- Worker exit code 3221226505 in the Windows test runners (about 5 of 13 process-pool integration runs): unexplained.
- The E10 locale redirect test failed once on Workers and passed 4 of 4 alone.
- Staging is public until Access is configured; signup is enabled but email confirmation is required (and confirmation emails cannot be delivered to arbitrary addresses by the default provider).
- The landing Worker's builds fail on non-production branches (the new branch will show the same red check); I cannot read its log without the build-log permission.

# INOK infrastructure status (2026-11-16, evening)

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

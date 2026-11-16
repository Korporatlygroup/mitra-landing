# INOK Phases 1 to 7: hosting recommendation, scheduler, staging checklist, landing-page plan

Status: PLAN, prepared 2026-11-15. Nothing here was executed against Cloudflare, Vercel, a hosted Supabase project, DNS or any mail provider. Verification so far is local only (see `phase1-7-integration-report.md`).

> **Superseded 2026-11-16.** Management standardised on Cloudflare and Supabase. The Vercel recommendation below is replaced by `cloudflare-hosting-evaluation.md`, which tested the application in the Workers runtime. The Node-feature analysis in this section is still the background.

## 1. Where the application can run

### What the code needs from its host
| Need | Where | Consequence |
|---|---|---|
| Node.js HTTP, DNS and TLS APIs with a pinned, validated IP | `src/server/gov/safe-fetch.ts` (`node:dns`, `node:https`, `node:net`, `node:zlib`) is the SSRF guard for the government monitor | Needs a real Node runtime. Cloudflare documents `dns.lookup` as "not implemented" on Workers, and this guard resolves and pins addresses itself. |
| Raw TCP to a ClamAV daemon | `src/server/scanner.ts` (`node:net`, INSTREAM protocol) | Needs outbound TCP to a reachable `clamd`. Possible on Node hosts; on Workers only through `cloudflare:sockets`, untested here. |
| SMTP | `src/server/mailer.ts` (nodemailer, `SMTP_URL`) | nodemailer needs Node `net`/`tls`. On Workers an HTTP email API would have to replace it. |
| Next.js 16.4.5 request proxy (`src/proxy.ts`: locale routing, per-request CSP nonce) | runs for every page | Cloudflare's OpenNext adapter lists "Node.js in Middleware" as not yet supported. The Next 16 proxy runs on Node by default. Needs checking against the adapter version before any attempt. |
| Server Actions with 16 MiB bodies, multipart uploads, streaming document downloads | catalogue, verification and sourcing uploads | Supported by a Node host. Body limits differ on Workers. |
| Bounded background routes (`maxDuration = 60`) | `/api/v1/jobs/gov`, `/api/v1/jobs/rescan` | Any host that allows a 60 second function. |

### Recommendation
- **Application: a Node.js host. Vercel is the first choice** (managed Next.js, preview environments, deployment protection for staging, per-environment variables). A container host (Fly.io, Render, Railway) is an equal fallback if cost or region matters. Do not migrate to Workers: it needs rewrites (SSRF guard, scanner transport, mailer, proxy) with no product benefit.
- **Cloudflare stays** for DNS and for the existing landing page at `inok.my`. Records pointing at Vercel must be **DNS only** (grey cloud): Vercel's documentation says a proxy in front of its records breaks verification and certificate issuance.
- **Scheduling: a tiny Cloudflare Worker with a Cron Trigger** (section 2). It needs no change to the app.
- Choose the Vercel function region nearest the Supabase staging project (the project's region was not checked from here). A mismatch adds latency to every page because pages call the database several times.

Not verified: no deployment was attempted, so Vercel plan limits, function region and the OpenNext statements above are from vendor documentation, not from a test.

## 2. Scheduler for the monitoring and rescan routes

### What the routes do (checked in code)
- `POST /api/v1/jobs/gov`: 404 unless `GOV_WORKER_SECRET` is set, 401 without `Authorization: Bearer <secret>` (constant-time compare). One bounded run per call: queue due sources, claim up to three jobs, robots check, guarded fetch with timeouts and size limits, extraction or page comparison, then reminders and notifications, then the weekly news digest. The database refuses all monitoring while `monitoring_enabled` is off.
- `POST /api/v1/jobs/rescan`: 404 unless `CRON_SECRET` is set, same bearer scheme. Rescans quarantined uploads (verification documents, supplier documents, product images), cleans sourcing documents and sends sourcing reminders.
- Only POST is implemented. A scheduler that can only send GET (Vercel's classic cron) cannot call these without a code change.

### Safety properties (and the evidence)
| Property | Mechanism | Evidence |
|---|---|---|
| No duplicate jobs | one queued job per source per interval bucket (`gov_enqueue_due_jobs` key) | pgTAP 21, integration `p7-worker` "Journey I" runs two workers at once |
| Overlapping runs are safe | jobs are claimed with a lease; an expired lease is recovered; one request per source per `60 / rate_per_minute` seconds | same |
| Retries | exponential backoff (60 s doubling to one hour, with jitter), honours `Retry-After`, dead-letter after the source's maximum attempts | pgTAP 21 |
| No duplicate notifications | event key per person, programme and version (`deadline:<programme>:<closes_on>:<offset>:<user>` for reminders); outbox rows are claimed with `FOR UPDATE SKIP LOCKED`; an email is marked sent only after the provider accepted it | `p7-notify` including a new test with three overlapping runs and a slow mail provider: one email, one in-app notification |
| A failure never edits a published programme | only `gov_decide_proposal` (a person) changes published data; failed fetches change job and source health | pgTAP 23, `p7-worker` |
| Crash between sending and recording an email | the row returns to the queue after 15 minutes (at most five attempts), so a delivery can repeat but never be lost | documented behaviour in `gov_dispatch_outbox` |

### Frequency
- A source's `refresh_interval_minutes` is between 15 minutes and 30 days (default one day). Backoff retries start at about one minute. Outbox delivery is limited by how often the route is called.
- Recommended: `*/15 * * * *` for `/api/v1/jobs/gov`, which matches the shortest allowed source interval and keeps notification delay under 15 minutes. Five minutes adds load without any benefit for a handful of daily sources.
- Recommended: `*/10 * * * *` for `/api/v1/jobs/rescan` so a document that was quarantined while the scanner was down is released or rejected within about ten minutes.
- Revisit after the first week of real use (source count, job duration).

### Exact configuration (Cloudflare Worker, to be created later; not created now)
`wrangler.toml` of a separate small repository or folder:
```toml
name = "inok-scheduler-staging"
main = "src/index.ts"
compatibility_date = "2026-11-01"

[triggers]
crons = ["*/15 * * * *", "*/10 * * * *"]

[vars]
APP_ORIGIN = "https://staging.inok.my"
```
`src/index.ts`:
```ts
export default {
  async scheduled(controller: ScheduledController, env: { APP_ORIGIN: string; GOV_WORKER_SECRET: string; CRON_SECRET: string }) {
    const gov = controller.cron === '*/15 * * * *';
    const res = await fetch(`${env.APP_ORIGIN}/api/v1/jobs/${gov ? 'gov' : 'rescan'}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${gov ? env.GOV_WORKER_SECRET : env.CRON_SECRET}` },
      signal: AbortSignal.timeout(55_000),
    });
    if (!res.ok) throw new Error(`job route answered ${res.status}`); // visible in Worker logs
  },
};
```
Secrets are stored with `wrangler secret put GOV_WORKER_SECRET` and `wrangler secret put CRON_SECRET` (separate values for staging and production). Production gets its own Worker with `APP_ORIGIN = "https://app.inok.my"`.

Alternatives and why they rank lower: Vercel Cron needs GET routes and a paid plan for anything more often than daily; a GitHub Actions schedule is best effort and can be delayed by many minutes; Supabase `pg_cron` with `pg_net` works but puts a secret inside the database.

Do not enable the schedule until staging is configured and approved. With the three database switches off (`monitoring_enabled`, `publishing_enabled`, `notifications_enabled`) a scheduled call does nothing.

## 3. Environment and secrets (confirmed against the code)
| Variable | Used by | Secret | Staging and production |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser and server, CSP allow-list | no (public) | different project per environment |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser and server | no (public, protected by RLS) | per project |
| `SUPABASE_SECRET_KEY` | `src/server/privileged.ts`, `scripts/bootstrap-admin.mjs` | **yes**, server only, never `NEXT_PUBLIC_` | per project, never shared |
| `SITE_URL` | email links, auth callback origin, cookie settings | no | `https://staging.inok.my` / `https://app.inok.my` |
| `SMTP_URL`, `MAIL_FROM` | mailer (mandatory when `NODE_ENV=production`) | `SMTP_URL` yes | staging sender must not be the production sender |
| `CLAMD_HOST`, `CLAMD_PORT` | upload scanner | no (but not public) | without it uploads stay quarantined and unreadable |
| `CRON_SECRET` | `/api/v1/jobs/rescan` | **yes** | 32 random bytes each |
| `GOV_WORKER_SECRET` | `/api/v1/jobs/gov` | **yes** | 32 random bytes each |
| `GOV_WORKER_CONTACT` | monitor user agent | no, but it is sent to agencies | an operations mailbox, never a personal address |
| `MITRA_BOOTSTRAP_CONFIRM` | one-time first administrator script | yes (confirmation value) | rename later; the variable name is an internal identifier |
Do not reuse any production value in staging. Variable names still read MITRA in one place on purpose (above); users never see it.

## 4. Staging prerequisites (checklist; every item is open)
| # | Item | Notes | State |
|---|---|---|---|
| 1 | Separate hosted Supabase staging project and variables | existing `mitra-staging` project history is described in `staging-migration-reconciliation.md` (11 rows stamped with execution time) | open, needs owner approval |
| 2 | Migration history reconciliation (repair the 11 rows), then `supabase db push --dry-run` | expected list: every version after `…011`, now through `20260701000221`; ordering rule: all new versions are higher than anything applied | open, hosted write, needs approval |
| 3 | Migration rehearsal | done locally: fresh 38 migrations and upgrade from the Phase 1 to 6 schema with data (section 5 of the integration report) | local only |
| 4 | Auth URL configuration | Site URL `https://staging.inok.my`; additional redirect URLs `https://staging.inok.my/auth/callback`; later the same for `https://app.inok.my`. The callback is outside the locale prefix. | open |
| 5 | Auth email templates and subjects | hosted projects do not read `supabase/config.toml`; set "Confirm your INOK account" and "Reset your INOK password" and the HTML in the project (dashboard or config push) | open |
| 6 | Private storage | buckets `verification-docs` (10 MiB, PDF/PNG/JPEG, private) and `catalogue-media` (migration 111). No API role has a storage policy; only the server key reads and writes. Verified locally by integration `storage-lockdown`. Check on the hosted project. | local verified |
| 7 | Malware scanning | **launch blocker**: a reachable `clamd` and a provider decision. Until then uploads are quarantined and nobody can open them (fails safe). Run `/api/v1/jobs/rescan` after connecting it. | open |
| 8 | Mail provider | verify the sender domain (SPF, DKIM, DMARC for `inok.my`), set `SMTP_URL`, send a test | open |
| 9 | Scheduler | section 2; create after staging is approved | open |
| 10 | HTTPS and domains | `staging.inok.my` and `app.inok.my` as DNS-only CNAMEs to the host; HSTS is already sent by the app (`max-age=63072000; includeSubDomains`) | open |
| 11 | Access protection for staging | host-level password or SSO protection for the staging deployment; staging should not be indexed | open |
| 12 | Logs and error monitoring | host logs for the app and the Worker; an error tracker is not chosen. The worker logs only error names, never content. | open |
| 13 | Backup and recovery | confirm the Supabase plan's backups or PITR before real data; a schema dump is not a data backup | open |
| 14 | First administrator | `scripts/bootstrap-admin.mjs` with the confirmation variable; the person must enrol an authenticator app at first sign-in | open |
| 15 | Government monitor switches | all three start off; register sources through the admin console; a second administrator approves enabling; run the route once by hand | open |
| 16 | Body-size limits | the app allows 16 MiB uploads; put an edge or WAF body limit in front (known residual risk noted in `next.config.ts`) | open |

## 5. Landing page and application integration plan (no change made)
`inok.my` stays as it is. The application lives on its own hosts, so both can be deployed independently.

### Exact application URLs (locale prefix `/en`, `/ms` or `/ta`; the default entry can be `/en`)
| Purpose | URL |
|---|---|
| Register | `https://app.inok.my/en/signup` |
| Sign in | `https://app.inok.my/en/login` (accepts `?next=/en/...` for same-origin paths only) |
| Password recovery | `https://app.inok.my/en/forgot-password`, then the emailed link to `https://app.inok.my/auth/callback?token_hash=...&type=recovery`, which lands on `/en/reset-password` |
| Email confirmation | `https://app.inok.my/auth/callback?token_hash=...&type=email&next=/` (no locale prefix) |
| Dashboard after sign in | the app chooses by role: staff `/en/admin`, business `/en/orgs/<id>/business`, partner `/en/orgs/<id>/partner`, buyer `/en/requests`, a user with no organisation yet `/en/orgs`. Link to Sign in, not to a dashboard. |
| Public business directory | `https://app.inok.my/en/directory` (no sign-in needed) |
| Public assistance catalogue | `https://app.inok.my/en/business-help`, guided finder `/en/business-help/find` |
| Product catalogue | `https://app.inok.my/en/catalogue` |

### Recommended landing-page navigation
1. **Register Your Business** to `/en/signup`. Wording rule: this creates an account and starts a listing review by INOK. It is not enrolment in any government programme and must not be labelled as official MITRA enrolment unless that is formally approved.
2. **Sign In** to `/en/login`.
3. **Explore Businesses** to `/en/directory`.
4. **Business Support** to `/en/business-help` (public, no login; shows that INOK is not a government agency).
Keep one language switch per site. Pass the visitor's language into the prefix (`/ms/...`, `/ta/...`).

### Constraints
- Session cookies are host-only to `app.inok.my`, so the landing page cannot show signed-in state; the links are static.
- Add `https://app.inok.my` to the landing page's own CSP and link allow-lists if it has them.
- No Cloudflare DNS or production navigation was changed.

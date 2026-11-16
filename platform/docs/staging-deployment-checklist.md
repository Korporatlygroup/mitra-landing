# Staging deployment checklist (`staging.inok.my`, Supabase `mitra-staging`)

Status key: **Local** = verified on the developer machine only. **Prepared** = files or text exist in the repository, nothing created or applied anywhere. **Open** = not started. **Needs you** = an account, credential, payment or decision only the owner can provide. Nothing in this list has been run against a hosted service. Evidence for the audit lines is in `staging-migration-reconciliation.md` and `phase1-7-integration-report.md`.

## A. Database (project `udxzukodfqjzdukweygy`, ap-southeast-1)
| # | Step | State |
|---|---|---|
| A1 | Read-only re-check on 2026-11-16: 11 history rows with execution-time versions (`20261110074212` to `…243`), names equal to files 001 to 011, 0 users, 0 organisations, 17 public tables, 1 private table, 1 private bucket (`verification-docs`), 18 policies, extensions citext, pgcrypto, uuid-ossp, pg_stat_statements, supabase_vault | Done (read-only) |
| A2 | Freeze other writers (MCP `apply_migration`, other developers) for the window | Needs you |
| A3 | Snapshot the 11 history rows and take a schema dump outside git | Open (hosted read) |
| A4 | `supabase migration repair` of the 11 rows (reverted then applied), exact commands in `staging-migration-reconciliation.md` | Prepared, **needs your approval** (hosted write to bookkeeping only) |
| A5 | `supabase db push --dry-run` must list exactly 29 versions, in order: `000012 000013 000014 000100–000107 000110–000116 000150–000153 000200 000201 000210 000220 000221 000222 000223` | Prepared |
| A6 | `supabase db push` of those 29 | **Needs your approval** |
| A7 | Post-push checks: every public table has RLS on, advisor run (security and performance), `verification-docs` and `catalogue-media` private, 223 is a no-op because the bucket exists | Open |
| A8 | Backup posture: confirm plan backups or PITR before real data | Needs you (plan decision) |

## B. Application host: Cloudflare Workers (decision 2026-11-16: Cloudflare and Supabase only)
Evidence and open items are in `cloudflare-hosting-evaluation.md`. Prepared files: `platform/deploy/cloudflare-app/`.
| # | Step | State |
|---|---|---|
| B1 | Cloudflare access for the work: scoped API token or someone runs the commands (list in the evaluation, section 1) | **Needs you** |
| B2 | Add the OpenNext adapter and wrangler as dev dependencies, the two config files, and the Workers fetch transport for the government monitor (code change with tests, local commit) | Prepared, **needs your approval** |
| B3 | Create Worker `inok-app-staging`, its R2 cache bucket (the adapter's documented cache setup), secrets set in Cloudflare, build project on this repository with root directory `platform` and build watch paths | **Needs you** (Cloudflare account; Workers Paid plan expected) |
| B4 | `staging.inok.my` as a Worker custom domain (a DNS change) with Cloudflare Access in front; no search indexing | **Needs you** |
| B5 | Health check: `GET /api/v1/health` | Prepared (route exists; 200 in workerd) |
| B6 | Rollback: Workers keep previous versions (roll back from the dashboard or `wrangler rollback`); database rollbacks are forward fixes | Prepared |
| B7 | Fix the failing Workers Builds on non-production branches of the landing Worker | Needs Cloudflare access |

## C. Supabase Auth for staging (hosted projects do not read `config.toml`)
| Setting | Value |
|---|---|
| Site URL | `https://staging.inok.my` |
| Redirect allow-list | `https://staging.inok.my/auth/callback` (the only callback route in the code, outside the locale prefix; the app builds `${SITE_URL}/auth/callback` for sign-up and for recovery). Nothing else. |
| Email confirmation | on |
| Password rules | minimum 10 characters, lower, upper and digits (as in `config.toml`) |
| Sign-ups | leave enabled only on staging; production stays off until you approve launch |
| Confirm template | subject "Confirm your INOK account", body `supabase/templates/confirmation.html` (link `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next=/`) |
| Recovery template | subject "Reset your INOK password", body `recovery.html` (type `recovery`, lands on the reset page) |
| Security notices | optional templates prepared: `password_changed_notification.html`, `email_changed_notification.html` |
| Custom SMTP | the provider in section E (never the built-in Supabase mailer for real users: it is rate limited) |
| Admin MFA | enforced by the application (administrators enrol an authenticator at first sign-in); also enable TOTP in the project |
State: **Prepared**. Sets all of it by the dashboard, or by a config push after you approve.
Limitations found: auth templates are English only; Supabase templates cannot pick a language from the app locale without storing the locale in user metadata, which the code does not do today. Tracked as a follow-up, not built.

## D. Environment variables (staging values, never shared with production)
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (public), `SUPABASE_SECRET_KEY` (secret, server only), `SITE_URL=https://staging.inok.my`, `SMTP_URL` (secret), `MAIL_FROM`, `CLAMD_HOST`, `CLAMD_PORT`, `CRON_SECRET`, `GOV_WORKER_SECRET`, `GOV_WORKER_CONTACT`, `MITRA_BOOTSTRAP_CONFIRM`. Generate the two job secrets as 32 random bytes each. Details in `phase1-7-staging-readiness.md` section 3. State: **Needs you** (keys come from the staging project; do not paste them in chat).

## E. Email (staging uses its own sender, for example `no-reply@staging.inok.my` or a test subdomain)
Recommended provider: **Resend** (simplest domain verification, SMTP and API) or **Amazon SES** (cheapest at volume, ap-southeast-1, needs production access request and bounce handling set up). Both work with the `SMTP_URL` the app already uses and with Supabase custom SMTP. Check the provider's current pricing and limits yourself before choosing; I did not verify them.
| # | Step | State |
|---|---|---|
| E1 | Choose the provider and create the account | **Needs you** |
| E2 | Verify the sending domain: SPF, DKIM (CNAME or TXT from the provider) and a DMARC TXT record `_dmarc.inok.my` (start with `p=none` and a reporting mailbox, tighten after a week) | Needs you (DNS change on `inok.my`; I will not touch DNS) |
| E3 | Put the SMTP credentials into the host variables and into Supabase Auth SMTP | Needs you |
| E4 | Send real tests to authorized mailboxes: confirm, recovery, enquiry, quotation, programme reminder; check delivery, links, spam folder, failed delivery path and notification preferences | Open (nothing is verified as delivered; the code paths are tested locally with a mock mailer) |

## F. Private storage and malware scanning
| # | Step | State |
|---|---|---|
| F1 | Buckets `verification-docs` and `catalogue-media`: private, no storage policy for any API role | Local verified (pgTAP 29, integration `storage-lockdown`) |
| F2 | A reachable `clamd` (container on a small VM, Fly.io, Railway or similar) with TCP 3310 reachable only from the app host; set `CLAMD_HOST`, `CLAMD_PORT` | **Needs you** (hosting decision and cost). **Launch blocker:** without it uploads stay quarantined and nobody can open them |
| F3 | Run `/api/v1/jobs/rescan` by hand once the scanner is reachable; EICAR test file must be rejected | Open |
| F4 | Edge body-size limit in front of the app (the app accepts 16 MiB) | Open |

## G. Scheduler (Phase 7)
Prepared files: `platform/deploy/scheduler/wrangler.toml` and `src/index.ts` (Cloudflare Cron Trigger Worker, POST with bearer secret, 15 minute cron for `/api/v1/jobs/gov`, 10 minute cron for `/api/v1/jobs/rescan`). Not created, no schedule live. Behind Cloudflare Access, call the app by service binding or bypass Access for `/api/v1/jobs/*`.
| # | Step | State |
|---|---|---|
| G1 | Create `inok-scheduler-staging` with `wrangler deploy --env staging`; add the two secrets with `wrangler secret put` | **Needs you** (Cloudflare account and approval) |
| G2 | Keep the three database switches off. First call by hand with curl: expect 200 and no work | Open |
| G3 | Register one source in the admin console, have a second administrator approve enabling it, run one full scheduled cycle, check the outbox sends exactly one email and one in-app notification, check the stale and 14-day/3-day reminders on a test programme | Open (the logic is verified locally, including two overlapping workers) |
| G4 | Programme data stays unpublished until a person has verified each record; SME Corp stays manual (HTTP 403) | Open |

## H. First administrator and acceptance run on staging
1. Bootstrap the first administrator with `scripts/bootstrap-admin.mjs` and the confirmation variable; enrol the authenticator app. (Needs you.)
2. Walk the user journeys in section I of the request: register, confirm email, sign in, reset password, business onboarding, directory, enquiry and quotation, sourcing, government assistance, admin review, document upload and scan, role isolation, English, Malay and Tamil, mobile, scheduler run, backup and restore drill.
3. Re-run the local regression suites against the same commit and record exact counts (they do not replace staging tests).

## I. What I need from you before any of this can start
1. Approval of the migration-history repair (A4) and push (A6) on `mitra-staging`.
2. A decision and account for the app host, the email provider, the malware scanner host and the Cloudflare Worker.
3. DNS changes for `staging.inok.my` and the email records (SPF, DKIM, DMARC), made by you or approved by you.
4. Staging keys entered directly into the host and Supabase dashboards, not into chat.

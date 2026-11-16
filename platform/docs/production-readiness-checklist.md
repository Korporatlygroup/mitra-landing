# Production readiness checklist (`inok-production` Supabase project, `app.inok.my`)

Status words (used strictly): **Configured** (set up on the real service), **Tested on staging**, **Production verified**, **Tested locally**, **Prepared** (repository files only), **Blocked** (cannot proceed without an owner action). As of 2026-11-16 **nothing is Configured, Tested on staging or Production verified**: no hosted resource was created or changed in this work. The only hosted action taken was read-only queries against `mitra-staging`.

## 1. Supabase project `inok-production`
| Item | Status | Notes |
|---|---|---|
| Organisation | **Blocked, needs you** | The signed-in Supabase CLI sees **two** organisations: `korporatlygroup` (holds `mitra-staging` and the paused `sea-*` projects) and `inok project` (no projects yet). The CLI can create projects, so permission is likely, but the plan, price and backups can only be confirmed in the dashboard. Your decision: which organisation. I will not touch the paused projects. |
| Cost and plan | **Blocked, needs you** | A plan that does not pause for inactivity is required (the free tier pauses idle projects). I have not queried prices; check current Pro pricing, compute add-on, and backup or PITR options in the dashboard and approve the monthly amount. Nothing is created until you do. |
| Region and version | Prepared | Singapore (`ap-southeast-1`), Postgres 17 (local stack and `mitra-staging` are 17). |
| Creation | Blocked | Needs the two items above. The CLI (`supabase projects create`) or dashboard can create it; I will use the CLI that is already signed in once you approve. |
| Admin access and ownership | Needs you | Confirm the owner account and a second owner for recovery. |
| Project reference and API URL | Open | Recorded here (no secrets) after creation. |
| Extensions | Prepared | `citext` and `pgcrypto` are created by migrations in the `extensions` schema. No others needed. |
| Network and database security | Open | Strong generated database password stored only in a password manager; consider restricting direct database access; SSL enforced. |
| Backups and recovery | Blocked on plan | Enable daily backups (and PITR if the budget allows). Run a restore drill into a scratch project before launch. |
| Data | Prepared | Clean schema only. No staging users, test fixtures, or LMS data. Reference data only if you approve a list. |

## 2. Migrations and database
| Item | Status | Evidence |
|---|---|---|
| Fresh local database from all 40 migrations | Tested locally | `supabase db reset` clean; pgTAP 30 files, 2421 assertions pass on the head that includes 222 and 223 |
| Upgrade from Phase 1 to 6 with synthetic data | Tested locally | per-table row counts and hashes unchanged (`phase1-7-integration-report.md`) |
| Migration 222 (RLS initplan) | Tested locally | pgTAP 28 (policy text, behaviour, plan contains an InitPlan); timing result recorded in the integration report |
| Migration 223 (`verification-docs` bucket) | Tested locally | pgTAP 29; closes a gap: the bucket existed only in local config and by hand on staging |
| Apply to `inok-production` | Blocked | only after the project exists and you approve; the order is the file order, applied by `supabase db push` from one named person or CI |
| RLS on every exposed table, ownership, public directory data, private documents and messages, admin-only records, grants for functions | Tested locally | pgTAP 01 (87 tables, 179 authenticated RPCs, 36 service-role functions) plus integration `rpc-security`, `hardening`, `storage-lockdown` |
| Security and performance advisors | Blocked | the hosted advisors run only against a hosted project; run both after the push and investigate every finding |

## 3. Authentication
Routes found in the code (not invented): sign-up, sign-in, recovery and reset pages under the locale prefix; the single callback `GET /auth/callback` (outside the locale prefix; verifies `token_hash` and `type`, recovery always lands on the reset page).
| Item | Status |
|---|---|
| Site URL `https://app.inok.my`; redirect allow-list `https://app.inok.my/auth/callback` only; staging and production keep separate projects and settings | Prepared (not set) |
| Confirm and recovery templates, subjects "Confirm your INOK account" and "Reset your INOK password" | Prepared (files) ; hosted copy Blocked |
| Password-changed and email-changed notices | Prepared (files); needs provider support check in the hosted project |
| Role-based redirects, protected routes, unauthorized handling, admin MFA | Tested locally (browser suites) |
| Register, confirm, sign in, onboard, reach the dashboard, password reset, session refresh on real email | **Blocked** until real email works on staging |
| Public sign-up enabled | **Do not enable** until you approve launch |

## 4. Email
Provider choice (Resend or Amazon SES) and the sender address are **owner decisions** (see `staging-deployment-checklist.md` section E). SPF, DKIM and DMARC for `inok.my` are DNS changes you must make or approve. Status: Prepared in code (SMTP is already the transport; the app refuses to start sending in production without `SMTP_URL`); **Blocked** for delivery verification. No claim of working production email is made.
Templates: auth confirm, recovery (and two notices) are prepared. Application emails (verification decisions, invitations, enquiry, quotation, programme reminders, digest) use the three-language message files already rebranded to INOK; real delivery, spam placement, failure and retry behaviour are Tested locally with a mock transport only.

## 5. Storage and documents
Private buckets, size and type limits, no storage policy for API roles, server-side authorization and short-lived download routes: Tested locally. Malware scanning fails closed (uploads stay quarantined while the scanner is down): Tested locally. A real `clamd` endpoint: **Blocked, needs you**. Retention and deletion policy for verification evidence: **needs your decision** (the erasure tooling from Phase 4 exists; the retention period is a legal and policy choice).

## 6. Phase 7 scheduler
Route compatibility, auth, bounded retries, leases, duplicate prevention, reminders: Tested locally. Cloudflare Cron Trigger Worker files: Prepared (`deploy/scheduler`). Staging full cycle: Blocked until staging exists. Production scheduling: **do not enable** until staging passes and you approve. Government data stays unpublished until a person verifies each record.

## 7. Hosting, domain, monitoring
| Item | Status |
|---|---|
| Host | Cloudflare Workers (OpenNext adapter) for the application, decided by management; builds and runs locally in workerd; one code change (government monitor fetch) and one required setting (R2 incremental cache) found. Not deployed. See `cloudflare-hosting-evaluation.md`. |
| `app.inok.my` and `staging.inok.my` as Worker custom domains (proxied by Cloudflare), HTTPS, HSTS (the app sends HSTS) | Blocked, DNS changes need your approval |
| Landing page links (`inok.my`): Register Your Business, Sign In, Explore Businesses, Government Assistance | Prepared in `phase1-7-staging-readiness.md` section 5. The live page is not modified. Government Assistance route is the public programme list under `/business-help`. |
| Logging, error monitoring, alerts | Open: host logs plus an error tracker to choose; uptime check on `/api/v1/health`; alert on scheduler failures |
| Rollback | Prepared: redeploy the previous host build; database fixes go forward as new migrations; restore drill from backup |

## 8. Release gates (all must be ticked by a named person)
- [ ] Staging acceptance passed on the exact commit to be released
- [ ] Production project healthy, all 40 migrations applied, advisors clean or explained
- [ ] SMTP delivery verified with real mailboxes; SPF, DKIM, DMARC pass
- [ ] `clamd` connected, EICAR rejected, documents released after clean scan
- [ ] First administrator created, MFA enrolled, second administrator exists
- [ ] Backups on, restore drill done
- [ ] Privacy policy and terms published and linked at sign-up (the consent versions in the sign-up flow must match the published documents)
- [ ] Malay and Tamil wording reviewed by native speakers
- [ ] Programme records verified by a person; no unverified record published
- [ ] Management approval to enable public registration and to change the landing page links

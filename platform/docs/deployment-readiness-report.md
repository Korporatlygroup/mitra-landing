# Deployment readiness report (2026-11-16, after the legal and privacy stage)

## Git
Branch `integration/phase1-7`, latest commit `6f45ce0` (this report is committed after it). `main` and the `mitra-landing` Worker's branch untouched. Uncommitted by design: `platform/supabase/config.toml` (local port remap), `.mcp.json`.

## Staging (`inok-app-staging` + `mitra-staging`)
- Code of `6f45ce0` deployed; migration 225 applied (42 migrations, staging only). Access key required for every page (401 without it).
- Policy routes answer 200 with the key: `/privacy`, `/terms`, `/marketplace-policy`, `/cookies`, `/government-disclaimer`, `/complaints` (en, ms, ta).

## Production (`inok-app-production` + `inok-production`, rechecked today)
- Worker gated (401 without key, 200 with), health open. Not redeployed with today's code, so it has no policy pages yet.
- Public sign-up refused (`signup_disabled`). Database: 0 users, 0 organisations, 0 audit rows, 41 migrations (**migration 225 not applied**). Government publishing, monitoring and notifications are off. No app.inok.my route; `inok.my` unchanged.

## Test results (actual)
| Layer | Result |
|---|---|
| Unit | 975 of 975 pass |
| Database (pgTAP) | 32 files, 2,461 assertions pass |
| Local browser, new spec `e92` (legal pages en/ms/ta, accessibility, cookies, sign-up consent, data requests, admin handling) | 22 of 22 pass (desktop and mobile, with the related E44 test) |
| Local browser, related regression (sign-up, auth errors, consent, orgs, security, Bahasa Melayu, redesign, form restore) | 100 passed, 14 skipped by design; the one regression it found (duplicate "Save" label) is fixed |
| **Hosted staging, first run** | 4 passed, 3 failed, 13 not run (a failure stops the rest of its group) |
| **Hosted staging, rerun with up to 2 retries** | 13 passed, **3 passed only on retry** (ms legal pages, sourcing journey, seller creates organisation), **2 failed** (cookie check; verification-document test timed out), 2 not run |

**Reading the hosted result honestly:** every hosted failure I inspected was a server error from the Worker (HTTP 503, Cloudflare "error code 1102", Next error page), not a wrong answer from the application. I did not obtain a clean full pass of the hosted suite after this stage, so the legal pages, consent and data-request flow are proven locally and on the database. On the hosted Worker they are **not proven**: within each serial group a failure skips or reruns the later tests, and I did not extract a per-test pass list for the new spec. Only the tests named as failed or flaky above are known.

## The main new finding: Worker instability on the Free plan
- Cloudflare returns **1102 (Worker exceeded resource limits)** on a small share of staging requests: 2 of 150 on `/en/terms`, up to 20 percent on earlier samples, on every kind of page including `/api/v1/health`; the failing request is usually the first after idle.
- The production Worker (older bundle, idle) answered 80 of 80 test requests, but has had no real traffic.
- **Correction (supersedes the earlier text here):** the 3 MiB bundle limit no longer exists, so size is not the cause. `wrangler tail` shows the cause: Workers Free allows 10 ms CPU per request, a rendered Next.js page costs about 15-50 ms, and some requests are cut (`exceededCpu`, 503). Full evidence, numbers and results: `cloudflare-worker-cpu.md`.
- What was done: scoped client messages and a public-page cache (commit `361729b`, staging only). Public pages are now reliable; signed-in pages, server-action responses and RSC navigations are not (the same build passed the 20-test hosted suite three times, then failed 3 of 20 desktop and 3 of 20 mobile).
- Impact: signed-in use on Workers Free is not reliable. Not acceptable for launch. Decision needed (see `cloudflare-worker-cpu.md`, last section). No plan was changed.

## Subsystem status
| Subsystem | Status |
|---|---|
| Database schema, RLS, roles (staging and production) | Implemented and tested (production: schema only, no data) |
| Authentication, sessions, MFA, recovery | Implemented and tested on hosted staging (earlier runs); intermittently disturbed by the Worker errors |
| Buyer, seller, supplier, quotations, sourcing, government journeys | Implemented and hosted-tested earlier; today's reruns passed only with retries |
| Document upload and malware scanning | Implemented; **Blocked** (no scanner): uploads stay quarantined and cannot be approved or downloaded |
| Legal pages (six, en and ms; Tamil pending) | Implemented, tested locally; **Requires management approval** (drafts) |
| Optional marketing consent, versioned terms and privacy consent | Implemented and tested locally; hosted result not proven (see above) |
| Data requests and admin queue | Implemented, tested locally and database; hosted journey not proven (see above); **not on production** |
| Seller disclosure fields (e-trade Regulations) | **Requires management approval** (scope depends on counsel); not implemented |
| Transactional email, SPF/DKIM/DMARC, template delivery | **Blocked** (your team, separate); templates prepared |
| Backups | Manual tested procedure (data, Auth, storage files, restore verified on staging); **production has none automatic**; no schedule |
| `app.inok.my` route and landing-page links | **Prepared but inactive** (`docs/app-domain-and-landing-integration.md`) |
| Government assistance catalogue | Publishing off; 0 published programmes on production, 3 archived test records on staging; publishing needs a person to verify each record |
| Incident response, privacy-request procedures | Drafted; roles unnamed; not rehearsed |
| Worker reliability on the Free plan | **Blocked** until the 1102 errors are explained and fixed |

## Release blockers (all)
1. Worker 1102 errors (above).
2. Malware scanner host (document verification cannot go live without it).
3. Transactional email and sender DNS, then re-test sign-up, recovery and notifications with real mailboxes.
4. Management approval of all legal text and the operator details (`docs/legal/management-information-required.md`); counsel's answers on the e-trade Regulations, data-controller registration and cross-border transfers.
5. Apply migration 225 and deploy the new code to production (only on your go-ahead).
6. Seller disclosure fields, if counsel says the Regulations apply.
7. First administrators on production, backup routine started once real data exists, and a rehearsed incident procedure.
8. Native-speaker review of the Bahasa Melayu text and a Tamil translation.

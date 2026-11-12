# Phase 2 report: Seller Onboarding and Verification

Scope: local development only. Branch `platform/phase2-seller-verification`, based on the Phase 1 integration branch (PR #3). Nothing from Phase 2 has been pushed, merged or deployed.

## Delivered
- Seller onboarding in five short steps (English and Tamil, mobile-first, "save and finish later"): business name and category (mandatory), registered or not, SSM details (only when registered), state and district (public), private street address and postcode, authorised representative (name, role, optional contact; no identity-card data).
- Unregistered businesses get a limited, clearly labelled, unverified profile.
- Claim-level verification (business registration, business location, representative authority): submit, withdraw, review, approve / reject / request more information with a mandatory reason, resubmission, version history, status and history views, in-app notifications and email to owners and managers.
- Private document uploads (PDF, PNG, JPEG, up to 10 MB): validation by extension, MIME and magic bytes, PDF active-content check (advisory), image metadata stripping, antivirus scan before storage (ClamAV `clamd` protocol), quarantine when the scanner is unavailable, private storage with no user access, every access authorised and logged, downloads served as attachments with `nosniff`.
- Admin verification dashboard (queue, claim detail, decision form), permanent conflict-of-interest rule for reviewers, audit trail for every decision and document access.
- Wording: only "documents reviewed by MITRA on <date> for <scope>". Nothing claims an official SSM or government check (wording lint in EN and TA).

## Evidence (local only; none of it is hosted or CI)
| Check | Result |
|---|---|
| `npx supabase test db` (pgTAP) | 9 files, 749 tests, pass; also passes on a deliberately dirty DB |
| `npx vitest run --project integration` | 110 of 110 on a fresh DB (2 bootstrap tests skip once a real first admin exists) |
| `npm run test:unit` | 15 files, 273 tests, pass |
| typecheck, lint, build | pass; lint 0 errors (4 warnings, unused variables in E2E files) |
| Root Astro build | pass |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm run test:e2e` (agent run) | 254 of 256, both failures Windows worker crashes |
| `npm run test:e2e` (my run) | 255 passed, 1 worker crash (that spec then passed 12 of 12) |

## Independent review
- Review 1: 1 high (conflict of interest bypass by leaving the organisation), 5 medium, 6 low. All high and medium findings fixed; D3 (10 MiB upload truncation) and D4 (360px queue overflow) fixed; D6 (rescan queue starvation) fixed.
- Re-review verdict: no critical or high findings open; Phase 2 may be signed off with the conditions below.

## Release checklist (required before real data)
1. Run a real ClamAV (`clamd`) and set `CLAMD_HOST` / `CLAMD_PORT`. Without it every upload stays quarantined (safe, but nothing can be submitted).
2. Schedule `POST /api/v1/jobs/rescan` (for example every 5 minutes) with `CRON_SECRET`.
3. Add edge or WAF request-size limits. The in-app guard only sees `Content-Length` and skips `/api` and `/auth`.
4. Decide retention for claim snapshots (addresses, representative names), decision reasons and events, and an erasure path (PDPA).
5. Approve a second-reviewer or break-glass procedure: a reviewer ever involved with a business can never review it, which can make a claim unreviewable with a small reviewer pool.
6. Legal review of the wording, Terms and Privacy drafts; native Tamil review.
7. Verify on a hosted non-production Supabase project: the auth-table triggers (Phase 1), storage bucket privacy, and the migrations.
8. Run the GitHub Actions workflow on the Phase 2 branch.

## Accepted residual risks
- Image stripping removes EXIF, XMP, comments and PNG text/time chunks only; other metadata segments survive and orientation is lost for rotated phone photos. No PNG dimension cap.
- The PDF check is a heuristic; ClamAV is the control. Documents flagged infected later are found only by a future re-scan job (none exists yet for already-clean files).
- An insider with submit rights can exhaust the per-organisation upload limit for an hour.
- Throttle and audit tables have no purge job; the per-user and per-org keys are bounded by real users.
- A bulk `service_auth_attempt` count-then-insert is not atomic (carried over from Phase 1).

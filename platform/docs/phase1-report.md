# Phase 1 report: Core Platform Foundation

Scope: local development only. Nothing has been pushed, merged, deployed or applied to a remote database.
Branch: `platform/phase1-foundation` (from `staging`). The Astro landing page and `main` are untouched.

## Delivered
- Database (6 migrations): profiles, organisations (business, buyer, partner, mitra), memberships with fixed role templates, static `role_permissions`, invitations (hashed tokens), consents, append-only `audit_log`, rate limiting; RLS deny-by-default; MFA (aal2) required for admin roles and partner owners; single-use first-admin bootstrap (service role only); DB-derived auth audit events.
- App (Next.js 16, English and Tamil): sign-up with email confirmation, login, MFA enrol/verify, forgot/reset password, account and consent, organisations, member and invitation management, admin users and audit pages, security headers with a per-request CSP nonce.
- Tests and tooling: pgTAP, Vitest unit and integration, Playwright E2E (mobile 360px and desktop 1280px), CI workflow (not executed), bootstrap and local-env scripts.

## Evidence (local only)
| Check | Result |
|---|---|
| `npx supabase test db` | 7 files, 346 tests, pass |
| `npm run test:unit` | 8 files, 128 tests, pass |
| `npx vitest run --project integration` | 37 of 37 on a fresh DB; 35 pass and 2 skip once E2E has used the single-use bootstrap |
| `npm run typecheck`, `npm run build` | pass |
| `npm run lint` | 0 errors, 3 warnings (unused variables in E2E files) |
| `npm run test:e2e` (agent run) | 132 of 132 pass |
| `npm run test:e2e` (my run) | 130 pass, 2 worker crashes (Windows 0xC0000409) in e3; that spec then passed 12 of 12 |
| `npm audit --omit=dev` | 0 vulnerabilities |

## Independent review
- Review 1 found 2 high, 5 medium and 6 low issues. All high and medium issues were fixed (migration 000006 plus app changes). Two more defects found by the test agent were fixed (banned users could read data; `rename_org` control characters). Earlier defects fixed: bootstrap RPC under PostgREST, user deletion, failed-invitation rate limiting, sign-up enumeration, language switcher accessible name.
- Re-review verdict: no critical or high findings open; Phase 1 may be signed off.

## Conditions and residual risks (accepted, documented)
1. **Cloud dependency (N1):** triggers on `auth.sessions` and `auth.mfa_factors` (login and MFA audit) work locally. Whether a hosted Supabase project allows them is NOT verified. Until verified on hosted staging, treat DB-derived login audit as a local-only control. The migration would fail on apply if creation is denied.
2. **Login lockout DoS (N2):** 10 attempts per 15 minutes per email hash, counted before the password check; an attacker can lock out a known email. Mitigation options (IP component, count failures only) deferred.
3. **Throttle and audit growth (N3, N4, L3):** `rate_limit_events` and `audit_log` have no retention or purge; throttle counting is not atomic. Retention periods need a owner/legal decision.
4. **Ownerless organisation (M4 remainder):** deleting a sole owner's auth user is allowed and audited; the organisation is left without an owner. Needs an admin recovery function (planned in the Administration module).
5. **CSP:** `style-src` keeps `'unsafe-inline'`.
6. **Flaky environment:** Playwright workers on Windows sometimes exit with 0xC0000409, and the app server died mid-run twice. All affected tests pass on rerun. CI uses `retries: 1`.
7. **Not verified:** the GitHub Actions workflow was never executed; Tamil text is a first draft pending native review; banned-user access, the sign-up throttle and the MFA throttle are covered at DB or unit level but not in the browser.
8. **Legal placeholders:** `/terms` and `/privacy` are drafts that need legal review. Consent version is `2026-07`.

## Local run
```
cd platform
npm install
npx supabase start          # needs Docker; ports 544xx
node scripts/write-local-env.mjs
npm run test:db && npm run test:unit && npm run test:integration && npm run test:e2e
```
Bootstrap the first admin (local only): sign up and confirm a user in the app, then `npm run bootstrap:admin -- --email <that email>`. It is single use and refuses remote URLs unless explicitly confirmed.

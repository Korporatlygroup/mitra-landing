# INOK production release: status checkpoint (2026-11-17)

Branch `release/inok-final` (from `test/multi-agent-journeys` 7050539, which is the code the staging suites ran against). No secret appears in this file.

## Done and verified on production (`inok-production`, `inok-app-production`)
| Item | Evidence |
|---|---|
| Baseline | `npm ci` clean; typecheck 0 errors; lint 0 errors (8 pre-existing warnings); 991 unit tests pass (local). The `p7-notify` integration tests need the local Supabase stack and were not re-run here: still unexplained, not dismissed. |
| Workers Paid | `wrangler deploy` accepted `limits.cpu_ms = 30000`, which the Free plan refuses. Worker start-up 15 ms. |
| Deploy | Worker version `d87883ca-663b-49fe-99b7-c070e681b2f3`, built from this branch against `inok-production` only (bundle guard passed: only `NEXT_PUBLIC_*` baked in). Rollback target: previous version `c2b66897-5472-404a-80c5-be4642207b69`. |
| Domain | `app.inok.my` attached as a custom domain; `SITE_URL=https://app.inok.my`; `ACCESS_GATE=required` still on (401 without key, health 200). `inok.my` untouched (200). TLS valid, no redirects. |
| Runtime | 33 gated requests (public, auth, directory, catalogue, health) x3 rounds: 0 x 5xx, 0 x 1102; max 1.9 s cold, ~50 ms for `/en/login`. Authenticated dashboards and the API under load are NOT yet measured on production. |
| Database | Backup taken first (data of public/private/auth/storage + schema + storage manifest, hashes verified) at `C:\Users\User\inok-backups\tykdrzrszznwlcyxmgrg-20261117T061846Z` (outside git; a copy off this machine and a restore into a separate project are NOT done). Migration 225 applied (42/42, latest 20260701000225); RLS on for every public table. Production holds 0 organisations. |
| Auth templates | The six INOK templates (plus the two security notifications) now use the token-hash link to `/auth/callback`. Live templates differed from the repo before this push, which is consistent with the earlier fragment-token failure. Sign-up stays OFF. |
| Auth callback | With synthetic users on production: invite, signup-confirmation and recovery links each verify, set the session cookie, land on `/account` or `/reset-password`, carry no tokens in the URL, work once only; an off-site `next` and a malformed token are refused. 17/17. Users removed afterwards. |

## Not done / needs a decision from you
1. **Email delivery was not proven.** The callback was tested with admin-generated links, not a delivered message: I will not send mail to an address you did not name. Give me a mailbox you control for the sign-up, invite and reset tests.
2. **Application notifications through Resend** need a separately restricted Resend API key (send-only, `mail.inok.my`) set as a Worker secret. The app uses SMTP via `nodemailer`; SMTP host `smtp.resend.com` with that key as the password is the minimal route. Not created by me.
3. **Public launch is blocked** until: legal operator details are real and approved, the gate is lifted, public sign-up is enabled, and the multi-user journeys have been run on production. None of these was done.
4. **One account for buying and selling:** the data model already supports it (a user can hold memberships in several organisations; both `buyer` and `business` organisations can post requests and quote). What is missing is the sign-up "Buy / Sell / Both" choice and a workspace switcher. That is new UI, not yet built; tell me to go ahead.
5. **Landing links** are prepared in `app-domain-and-landing-integration.md` but not published: the application is still behind the access gate, so a visitor would hit 401.
6. **Multi-user journeys on production** (agent suite) need production-specific personas and an admin path without direct SQL; not done.

---
## Update 2 (2026-11-17, later): email, Resend notifications, Buy/Sell/Both, landing, production journeys

### Production deployment now
Worker `inok-app-production` version `cfc4005f-3213-4f59-90bd-79474abdd1c4` (cron `*/2 * * * *`, `ACCESS_GATE=required`, `SITE_URL=https://app.inok.my`). Database: migrations through `20260701000226` (42 + 226 = 43 applied). Rollback targets: previous Worker versions `9e42e34f…` (Resend, before Buy/Sell/Both), `d87883ca…`, `c2b66897…` (original). Backups: `C:\Users\User\inok-backups\tykdrzrszznwlcyxmgrg-20261117T061846Z` (before 225) and `…T064351Z` (before 226); outside git, not yet copied off this machine, no restore into a separate project yet.

### Email delivery (authentication)
- SMTP config (Supabase Auth, production): custom SMTP enabled, sender `no-reply@mail.inok.my`, sender name INOK (read through `supabase config diff`; credentials never displayed). The six templates are the repo's token-hash templates (pushed in the previous step; the live ones had differed).
- Controlled invitation sent to the authorised test address through Supabase Auth: **accepted by Supabase** (SMTP hand-off succeeded, no error). **Delivery into the mailbox and the click-through are NOT yet confirmed**: at the time of writing the invited account is still unconfirmed. Resend logs are not readable with the send-only key, so only the mailbox can prove delivery.
- Callback route proven earlier with admin-generated links (17/17). Public sign-up stayed OFF.

### Resend business notifications (built, deployed, delivery to a real mailbox not yet exercised)
- Backend: nodemailer SMTP was the only mailer; added `createResendMailer` (HTTPS, `RESEND_API_KEY` secret, default sender `INOK <no-reply@mail.inok.my>`, `Idempotency-Key` header). `getMailer()` uses Resend when the secret exists, SMTP otherwise; all existing senders (invitations, verification decisions, partner invites, government digest) pick it up.
- `RESEND_API_KEY` is present on `inok-app-production` (secret name verified with `wrangler secret list`; value never read). Auth SMTP key and templates untouched by this work.
- Events: in-app notifications are created in one place (`private.notify_org`/`notify_platform`) for people holding the right permission in the right organisation. Migration 226 queues one email per notification (primary key = idempotent), skips opted-out people, unconfirmed addresses, reserved/test domains (`.test`, `example.*`), notifications older than 2 days, and caps 10 per person per hour; retries 5 times with growing delay, then `failed`. Government programme notices keep their own outbox. Emails say what kind of thing happened and link to the app; no names, prices, messages or document names; fixed subjects; en/ms/ta (ms/ta wording is draft).
- Preference: new "Email notifications" switch on the account page (`set_email_notifications`), default on.
- Delivery job: Cron Trigger every 2 minutes inside `inok-app-production` calls `/api/v1/jobs/notify` with `CRON_SECRET`. Delivery is therefore near-real-time (within about two minutes), not instant.
- Tests: 12 new unit tests (Resend request shape, refusal carries status only, content privacy, language, link safety, partial failure, no mailer); queue behaviour verified in SQL on the local database (enqueue, opt-out, lock, backoff, retry, no duplicate after sent, grants). **Not yet done:** a real notification emailed to the authorised address (needs the confirmed account), and Resend delivery/bounce statuses.

### Buy / Sell / Both (one account)
- The data model already allowed it (several memberships per user; `business` and `buyer` organisations may both post requests). Added: purpose chooser on `/orgs` for accounts without an organisation (buy -> individual buyer, sell and both -> a business), preselected form (`/orgs/new?purpose=`), "My requests" and "Post a request" in the business workspace, "Sell on INOK" in the buyer workspace; the existing organisation switcher changes workspace. No schema change; no UI redesign.
- Production run with three synthetic accounts: 30 checks pass (chooser, preselect, creation, a business starts a buying request, a buyer adds a business organisation, both survive sign-out, seller cannot read other accounts' rows in 8 tables or open their pages, 4 mobile pages at 390 px).

### Landing
The live landing page has no Get Started / Sign In / Explore / Register buttons (it is a programme page). Draft PR `Korporatlygroup/mitra-landing#12` adds them as data (nav desktop and mobile, hero button), not merged. Intent ("I want to sell") is not carried through sign-up.

### Not done / blockers
1. Mailbox confirmation of the invitation, password-recovery and notification emails (waiting on the authorised mailbox).
2. First production administrator: none exists. Needed for listing approval, verification review, directory visibility and the full buyer-seller-quotation journey on production. `bootstrap_first_admin` is one-time; I will not spend it on a synthetic address. Choose the real administrator's email.
3. Admin, supplier, quotation and messaging journeys on production, for the reason above (they were run on staging earlier).
4. Legal operator details, public sign-up, lifting the gate, off-machine backup and restore test.
5. Synthetic production data to remove after acceptance: users `inok-prod-{buy,sell,both}@example.test`, their 4 organisations, one draft request.
6. PR #11 CI: the one failing E2E test (E6 audit, `consent.withdrawn` assumed empty) failed identically on the base branch; fixed in the test (marketing opt-out since migration 225 writes such rows). Re-run pending.

## Update 3: business profile links, duplicate flags, join requests (migration 227)

Evidence is labelled by where it was verified.

- **Migration 227** (`20260701000227_business_links_duplicates_join_requests.sql`): additive. New `business_listings.live_links` / `live_hours`; links and hours on the listing draft, validated in the database (https only, host allow-list per link kind, no credentials or scripts, WhatsApp number normalised); duplicate flags by normalised SSM number and name (`private.business_duplicate_flags`, reviewer RPCs `list_duplicate_flags` / `resolve_duplicate_flag`, page `/admin/duplicates`); requests to join an existing published business (`org_join_requests`, RPCs `request_org_membership` / `list_join_requests` / `resolve_join_request`). The three re-declared functions differ from migration 102 only by the intended lines (diffed; production bodies match 102).
- **Backup before applying:** `C:\Users\User\inok-backups\tykdrzrszznwlcyxmgrg-20261117T073256Z` (schema, data, storage manifest; sha256 verified). Outside git, not copied off-machine, no restore test.
- **Production after applying:** 44 migrations, latest 227; RLS on every public table; the six new RPCs executable by `authenticated` only; helper functions not executable by users; `org_join_requests` readable only through its policy, no user write privilege; 5 organisations, 55 audit rows unchanged by the migration.
- **Worker** `45f1fa86-4ff5-4e9c-9a11-f42bf8dc6d27` (rollback `cfc4005f-3213-4f59-90bd-79474abdd1c4`). Gate holds: 401 without the key, `/api/v1/health` 200.
- **Local checks:** `tsc` and `eslint` clean; 1021 unit tests; full integration suite (21 new tests in `p8-links-duplicates.test.ts` cover links, publication snapshot, no private leak, duplicate flags, join requests); pgTAP `01_rls_and_grants` updated (it was also missing the migration 226 objects) and passing. `p7-notify` teardown fixed (left-over agency from an aborted run broke cleanup; the four tests themselves always passed). pgTAP 24 and 31 fail on the long-lived local database because of leftover rows (counts 2 instead of 1); not investigated further, CI uses a fresh database.
- **Production acceptance (synthetic accounts), `tests/production/02-links-duplicates.spec.ts`: 3 passed.** The same SSM number written two ways was accepted for two organisations and exactly one open flag was recorded; javascript:, wrong-site and bad WhatsApp values were refused with a visible message; valid links saved, came back normalised and rendered in the owner preview as `https` anchors with `target=_blank` and `rel=noopener`; the page fits 390 px; another account could not read the draft, join requests or flags. Regression: `01-buy-sell-both` 5 passed.
- **Not verified on production:** the published directory page with links (publishing needs an MFA administrator; covered by the local integration test), the duplicate notice and join request in the onboarding UI (it only appears for an already published match; covered by the local integration test), notification email for `join.requested` and `duplicate.flagged`.
- **Already existed (checked, not rebuilt):** service coverage (per-service areas or nationwide), minimum order, lead time, portfolio entries, preview, verification, resubmission. **Opening hours** are now a single text field.
- **Not implemented, by design:** logo, cover and gallery images. A public image bucket needs a working malware scanner and content checks first (see the phase 3 report), so images stay out; verification document upload stays quarantined as before. Carrying the "I want to sell" intent through sign-up is not done: the sign-up email template has a fixed `next=/` and the brief forbids changing the templates; after confirming, a person with no organisation sees the Buy / Sell / Both chooser.

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

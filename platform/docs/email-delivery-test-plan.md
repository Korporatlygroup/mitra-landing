# Controlled production email-delivery test (prepared; NOT run; approval needed before any account is created)

Goal: prove that a real registration email **reaches an inbox, the link works, and the person ends up signed in**, rather than only that Supabase accepted the request (all that has been shown so far: the 2026-11-17 invitation).

## Approval needed (all four)
1. The authorized company address to use (options below).
2. Approval to **create one production test account** through the real sign-up form.
3. The named person who reads that inbox and clicks the link while I watch the read-only database state.
4. The cleanup choice (keep as a QA account, or delete).

## Address options (pick one)
- **A. A named staff Google Workspace mailbox** with a plus-address (for example `name+inoktest1@korporatlygroup.com`; Google Workspace delivers plus-addresses to the same mailbox). No DNS change needed. Weakness: it does not exercise the `inok.my` inbound route.
- **B. `qa-buyer@inok.my`** after Email Routing is approved and live (see `email-routing-proposal.md`). Best end to end: it also proves inbound routing and becomes the permanent QA account.

Recommendation: A if the delivery test is needed before routing is approved; B for the permanent QA accounts.

## Preconditions (read-only checks I do first; no changes)
- Auth settings on production unchanged: custom SMTP enabled, sender `no-reply@mail.inok.my`, confirmation required, 30 emails per hour, re-send interval 1 minute, captcha disabled (all verified read-only on 2026-11-20).
- Resend dashboard (owner): the domain `mail.inok.my` shows **Verified**; note the plan (Free allows 100 per day); no failed sends listed.
- DNS: DKIM, SPF and bounce records still resolve.

## Procedure
1. The tester opens `https://app.inok.my/en/signup` in a normal browser (a phone if possible), fills the name "INOK Email Test", the chosen address and a strong generated password (stored only in the company password manager), ticks the two required consents, leaves marketing **unticked**, and submits.
2. Expect the "check your email" page. If the "cannot send confirmation emails" message appears instead, stop: that is a finding (PR 32).
3. Start the clock. Pass: the email arrives within 2 minutes from `INOK <no-reply@mail.inok.my>`, **in the inbox, not in spam**.
4. The tester saves the raw message headers (Gmail: Show original) and sends them to me. I check: `spf=pass`, `dkim=pass` with `d=mail.inok.my`, `dmarc=pass`, subject "Confirm your INOK account", and that the link host is `app.inok.my` (not a Supabase address).
5. The tester clicks the link on the same device. Pass: lands in the app signed in (or on the sign-in page with a success message), no error page.
6. The tester signs out and signs in again with the password. Pass: sign-in succeeds.
7. Optional second message: "Forgot password" for the same account; pass if the recovery email arrives with the same header checks and the reset link lets the tester set a new password.
8. I confirm from the database, read-only: the user exists, `email_confirmed_at` is set, `last_sign_in_at` is set, the two required consents are recorded with version 2026-07 and marketing is absent, no organisation exists, and the audit log shows the sign-in. Nothing other than the test address is read.

## Evidence to keep
Screenshots of each step, the raw headers (stored in the company folder, not in the repository), timestamps (sent to arrival), and the read-only query output (counts and flags only).

## Fail handling
- No email in 5 minutes: check spam; the Resend log (owner); the Supabase Auth logs (owner); the hourly limit (30) and the Resend daily cap (100 on Free). Do not retry more than once a minute (re-send interval).
- The link opens an error: record the URL pattern (never the token); check the callback route and the Site URL.
- Authentication results fail: fix the DNS (SPF or DKIM) before any launch.

## Cleanup
Keep the account as the permanent QA account (preferred if the address is `qa-buyer@inok.my`), or delete it in the Supabase dashboard (Auth > Users). A user with no organisation has no agreements, so deleting it does not hit the open erasure limitation.

## What this proves and does not prove
Proves: registration email delivery, link function, sign-in, consent recording. Does not prove: notification emails, volume behaviour, other mail clients, Malay or Tamil email text (the templates are English only).

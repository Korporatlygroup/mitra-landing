# Production email: activation plan (prepared, nothing configured)

Email is the last external dependency before public launch. Everything below is ready to switch on the day management provides the service. No DNS, provider or Supabase setting has been changed.

## What the application needs
| Need | How the code works today | Provider-side requirement |
|---|---|---|
| Supabase Auth mail (confirm, recovery, security notices) | Supabase sends it through the project's custom SMTP setting | SMTP host, port 465 or 587, user, password, sender `no-reply@<domain>` |
| Application mail (verification decisions, invitations, enquiries, quotations, programme reminders, digests) | `src/server/mailer.ts` uses `SMTP_URL` (nodemailer) and `MAIL_FROM` | the same SMTP account, or an HTTPS API (see the Workers note below) |

Workers note (tested, see `cloudflare-hosting-evaluation.md`): nodemailer over a direct TCP connection to the SMTP server is the part of the application most likely to be fragile inside a Worker, so the plan keeps the code path unchanged and tests it first on staging. If that fails, the smallest change is an HTTPS send (Resend's API, or Cloudflare Email Service if available on the account) behind the existing mailer function. That is a code change that needs your approval.

## Choosing the provider (management decision)
- **Resend**: shortest path, SMTP and HTTPS API, easy domain verification.
- **Amazon SES** (ap-southeast-1): cheapest at volume, but needs sandbox exit and bounce and complaint handling set up.
- **Cloudflare Email Service / Email Routing**: Email Routing only receives and forwards; it does not send transactional mail. Check whether sending is available on the account before counting on it.
I have not verified current prices or limits; management should compare them.

## Sender identity and DNS (all records come from the provider's dashboard; values are not invented here)
Use a sending subdomain so the root domain's mail setup stays untouched, for example `mail.inok.my`, with `no-reply@mail.inok.my` for the application and a separate staging subdomain (for example `staging-mail.inok.my`) so staging can never send as production.
| Record | Where | Purpose |
|---|---|---|
| SPF (TXT) | the sending subdomain | authorises the provider; provider gives the exact value |
| DKIM (TXT or CNAME, provider gives name and value) | the sending subdomain | signs mail |
| Return-path / bounce (MX and TXT on a provider subdomain, where the provider asks) | the sending subdomain | bounce handling |
| DMARC (TXT) | `_dmarc.inok.my` | start with `p=none` and an `rua` reporting mailbox, move to `quarantine` after about two weeks of clean reports |
Before adding records, read the existing `inok.my` zone: the landing page's mail (if any) must not break. These are changes to a live DNS zone, so each needs your approval.

## Settings to switch on (in this order)
1. Supabase project (staging first, then `inok-production`): Auth, SMTP settings: host, port, user, password, sender name "INOK", sender address. Rate limits raised appropriately. The built-in Supabase mailer must not serve real users.
2. Auth email templates and subjects from `supabase/templates/`: confirmation ("Confirm your INOK account"), recovery ("Reset your INOK password"), password-changed and email-changed notices. The links use `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=…`, so **Site URL** must be exactly the application origin (`https://staging.inok.my`, later `https://app.inok.my`) and the redirect allow-list must contain `https://<origin>/auth/callback` and nothing broader.
3. Application variables on the Worker: `SMTP_URL` (secret), `MAIL_FROM`. Staging and production use different senders.
4. Send real tests to authorised mailboxes only: confirmation, recovery, enquiry, quotation, programme reminder. Check delivery, spam folder, link and callback, a deliberate bounce, a retry (the outbox only marks a mail sent after the provider accepted it; a failure is retried), and the notification preference that turns a mail off.
5. Only after all pass: record the result in `production-readiness-checklist.md` as "Tested on staging", and later "Production verified" after a controlled real send.

## Not done / limits
- Auth templates are English only (Supabase templates cannot choose a language unless the locale is stored in user metadata; not implemented).
- No claim is made that any mail has been delivered by a provider. Local tests use a mock mail catcher.

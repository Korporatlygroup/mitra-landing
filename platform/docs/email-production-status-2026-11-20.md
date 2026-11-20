# Production email: verified status, gaps and exact setup steps (2026-11-20)

Owner decision 2026-11-20: SMTP first. **Nothing was changed in production, DNS, Supabase, Cloudflare or any provider for this document.** Every check was read-only. This replaces the older `email-activation-plan.md`, which said nothing was configured; that is no longer true. I also withdraw my statement of earlier today that confirmation emails could not reach ordinary users: it rested on that stale document and on Supabase's default-sender rule, and production does not use the default sender.

## 1. What is configured today (verified read-only)
| Item | Finding | How checked |
|---|---|---|
| Auth mail (confirmation, recovery, invitation, security notices) | Custom SMTP **enabled**: host `smtp.resend.com`, port 465, user `resend`, sender `INOK <no-reply@mail.inok.my>`; email-changed and password-changed notices on; confirmation required; re-send interval 1 minute | `supabase config diff` against `inok-production`; credentials are not shown by that command and were not read |
| App notification mail | Worker `inok-app-production` has the secret `RESEND_API_KEY`; code sends through the Resend HTTPS API; queue, opt-out, retries, 10 per person per hour; cron every 2 minutes; queue currently empty | `wrangler secret list` (names only); code; read-only count |
| DNS for sending | `resend._domainkey.mail.inok.my` (DKIM) present; `send.mail.inok.my` has the bounce MX and an SPF record; `_dmarc.inok.my` = `v=DMARC1; p=none;` | public DNS lookups |
| Redirects and site URL | `https://app.inok.my` and the callback allow-list are correct | config diff |
| Public sign-up | open (`disable_signup: false`); site gate is off | Auth settings endpoint; Worker config |

## 2. What is missing or unproven (exactly)
1. **No observed delivery.** The only recorded production send (an invitation, 2026-11-17) was accepted by Supabase but nobody confirmed it reached a mailbox. Whether the Resend domain `mail.inok.my` shows "verified" in the Resend dashboard, and which Resend plan the key belongs to, cannot be read with a send-only key.
2. **Plan limits.** Resend Free allows **100 emails per day** (published pricing table; Pro, $20 per month, has no daily limit and 50,000 emails per month; Scale $90). Supabase Auth limits email sending on custom SMTP (the documentation says a low default of 30 per hour until adjusted); that limit is not readable here. A burst of sign-ups (or bots) could exhaust either, and legitimate people would then not get their link; the app shows "too many tries" for the Supabase limit.
3. **No inbound mail.** `inok.my` has no MX record and no root SPF: nobody can write to `support@`, `privacy@`, `complaints@` or any address on the domain, replies to `no-reply@` bounce, and the legal pages promise contact addresses that do not exist yet.
4. **DMARC is monitoring-only and blind:** `p=none` without an `rua` reporting address, so failures are never reported and spoofing of `inok.my` is not blocked.
5. **No abuse protection on sign-up** beyond Supabase's per-IP limit (30 sign-ups or sign-ins per 5 minutes in the live config) and the app's per-email throttle. No captcha.
6. **Templates are English only** (Auth templates cannot select a language without the locale in user metadata).
7. **Recovery and notification emails** have never been exercised end to end in production.

## 3. Can the existing company email infrastructure be used?
Findings: `korporatlygroup.com` (the company group, DNS at Squarespace) runs **Google Workspace** (MX `smtp.google.com`, SPF `include:_spf.google.com`). `inok.my` DNS is at Cloudflare and has no mail records except the Resend ones above.
| Option | What it solves | Cost (published, 2026-11-20) | Verdict |
|---|---|---|---|
| **A. Keep Resend for sending** (already integrated, DKIM/SPF in place) | Auth and notification mail | Free: 100/day, 3 domains. Pro: $20/mo, 50,000/mo | **Keep.** Confirm the plan; move to Pro before a public campaign. |
| **B. Google Workspace SMTP as the sender** (`smtp.gmail.com` with an app password) | could replace Resend | no extra licence cost; limit **2,000 messages per day per user**; needs 2-Step Verification and an app password tied to a person's mailbox; Google recommends its SMTP relay (`smtp-relay.gmail.com`) for apps | **Not recommended** as primary: ties production mail to one person's account, From address is the authenticated account unless the domain is a Workspace alias, no per-message delivery log, and Resend is already working. Keep as an emergency fallback only. |
| **C. Google Workspace for inbound on inok.my** (add `inok.my` as a **domain alias** or secondary domain to the existing Workspace, create Google Groups `support@`, `privacy@`, `complaints@`, `qa-buyer@`, `qa-seller@`) | inbound mailboxes, replies from the right address, uses infrastructure the company already pays for | alias domain and Groups are included in Workspace per Google's help; **confirm in the Admin console that no extra licence is charged** (I did not verify the billing page) | **Recommended if staff need to reply from inok.my addresses.** Needs: domain verification TXT, one MX record at the root (`smtp.google.com`, priority 1, as the group domain already uses), DKIM key from Admin console, root SPF `v=spf1 include:_spf.google.com ~all`. The sending subdomain `mail.inok.my` is separate, so Resend is unaffected. |
| **D. Cloudflare Email Routing** (free, inbound only) | forwards `support@` etc. to existing mailboxes | **$0**, unlimited inbound | **Simplest and free if forward-only is enough.** Adds root MX and an SPF TXT automatically (Cloudflare manages DNS for `inok.my`). Replying from the address needs a "send as" setup (Gmail can send through Resend SMTP after the root domain or the address is verified in Resend). Cannot be combined with C on the same root MX: pick one. |
| **E. Cloudflare Email Sending (Beta)** | outbound from Workers/SMTP | needs **Workers Paid**; 3,000 emails/month included then $0.35 per 1,000 | Not needed; beta; revisit later. |
| **F. Amazon SES** | outbound | pay per use (about $0.10 per 1,000; **not re-verified today**), sandbox exit and bounce handling to build | Not needed while Resend works. |

**Recommendation:** keep Resend (A); add inbound with **C** (if the team wants real replies from inok.my addresses) or **D** (if forward-only is enough); add DMARC reporting; no new paid provider is required to launch. Expected added cost: **$0** now; **$20 per month** if the Resend Free daily cap becomes a risk (a decision, not a requirement yet).

## 4. Exact setup steps (all need approval; none done)
Owner of each step in brackets. DNS is a live zone: take a copy of the current records first (`inok.my` at Cloudflare).
1. **Confirm provider facts** [owner, Resend dashboard]: the domain `mail.inok.my` shows "Verified"; note the plan (Free or Pro); create a second API key named "inok-prod-notifications" only if rotating; check the Resend log shows no failures.
2. **Choose inbound route C or D** [management].
   - **Route D (Cloudflare Email Routing):** Cloudflare dashboard > `inok.my` > Email > Email Routing > Enable (it adds the MX and SPF records). Create custom addresses `support`, `privacy`, `complaints`, `dmarc`, `qa-buyer`, `qa-seller` and set each destination to a company mailbox; each destination must be verified by clicking the link Cloudflare emails to it.
   - **Route C (Google Workspace):** Admin console > Account > Domains > Manage domains > Add a domain > User alias domain `inok.my`; add the TXT verification record at Cloudflare; then add the MX record (`smtp.google.com`, priority 1) and SPF TXT at Cloudflare; generate and publish the DKIM key; create Groups with the five addresses above (allow external senders), members = named staff.
3. **DMARC reporting** [management + DNS]: change `_dmarc.inok.my` to `v=DMARC1; p=none; rua=mailto:dmarc@inok.my; fo=1` (needs the inbound address from step 2). After about two weeks of clean reports move to `p=quarantine`, later `p=reject`.
4. **Controlled delivery test** [owner, approves; I run it]: one Auth email (password recovery or an invitation) to one named company mailbox, plus one application notification. Pass criteria: arrives within a minute, not in spam, headers show SPF pass, DKIM pass (`d=mail.inok.my`) and DMARC pass, links open the app callback and sign the user in or reset. Record the evidence (headers, screenshot).
5. **Limits** [owner]: decide Resend plan (stay on Free until the pilot, Pro before a public launch campaign); in Supabase Auth > Rate Limits raise "emails sent per hour" to what the pilot needs. Both are settings changes: approval required.
6. **Sign-up abuse protection** [management; see section 5].
7. **Contact addresses** [management]: tell me the final `support`, `privacy` and complaints addresses so the legal pages and `OPERATOR` placeholders can be filled (nothing is invented).
8. **Templates** later: Malay and Tamil subjects and bodies need the user's language in metadata; not built.

## 5. The risk of open public registration (no change made)
Today anyone can submit the sign-up form; if delivery fails they hit a dead end (now with a clear message, PR 32), and bots can burn the Resend daily cap or the Supabase hourly limit. Options, cheapest first:
1. **Prove delivery first** (step 4), then leave sign-up open for a pilot of known people: acceptable risk at current volume; per-IP and per-email throttles exist.
2. **Cloudflare Turnstile captcha** (free) on the sign-up and recovery forms plus Supabase Auth's captcha setting: the right control before a public launch. Needs a small code change (widget and token pass-through, tested locally) and a Supabase auth setting change on production: approval for the setting; I can prepare the code on a branch.
3. **Temporarily close sign-up** (Supabase "Allow new users to sign up" off, or `ACCESS_GATE=required` and redeploy): one-click and reversible, but blocks the QA registration route; use only if abuse appears.
4. **Invitation-only** accounts for the pilot (the invitation flow exists for organisation members, not for first accounts).
Recommendation: 1 now, 2 before any announcement. Not changed.

## 6. Two company-controlled QA accounts (to prepare once email is approved and proven)
Addresses `qa-buyer@inok.my` and `qa-seller@inok.my` (aliases from step 2, each delivered to a named staff mailbox). Register through the real form; display names "QA Buyer", "QA Seller"; synthetic organisation names; strong generated passwords in the company password manager (never in chat or the repository); keep a QA register (owner, created date, removal date); no published listing; no agreement or order on production until the erasure policy exists. Test script: `production-authenticated-testing-plan.md` section 5. **Not created.**

## 7. Decisions needed from management
1. Inbound route: Google Workspace alias domain (C) or Cloudflare Email Routing (D)?
2. Which named staff mailboxes receive support, privacy, complaints, DMARC reports and the two QA addresses?
3. Resend plan: stay on Free (100 per day) for the pilot or move to Pro ($20 per month) now?
4. Approve the one-time controlled delivery test (step 4) and the DNS changes in steps 2 and 3.
5. Sign-up: leave open for the pilot, add captcha before launch (my recommendation), or close it now?
6. Supabase Auth hourly email limit to set.
7. Final contact addresses for the legal pages.

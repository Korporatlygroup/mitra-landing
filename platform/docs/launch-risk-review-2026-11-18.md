# Launch risk review (2026-11-18)

Scope: the risks that remain before public launch of app.inok.my. Sources: the code at release/inok-final 9cad859, the repo checklists (`launch-checklist.md`, `production-readiness-checklist.md`, `email-activation-plan.md`, `editorial-process.md`), read-only checks of the live site on 2026-11-18, and local test runs. **Nothing here was changed in production.** "Unverified" means I could not check it without a signed-in production session or a provider account.

## Summary

| # | Risk | Rating | State |
|---|---|---|---|
| 1 | Business identity verification: standard, staffing and queue | High | Controls exist in code; operating procedure and staffing not evidenced |
| 2 | Fraud and abuse reporting: triage and takedown | High | Reporting forms and admin queues exist; no written procedure or response time |
| 3 | Government-content publication controls | Medium | Controls strong in code; production state and human verification not confirmed |
| 4 | picomatch advisory exception expires 2027-01-15 | Medium | 58 days left; no patched version exists yet |
| 5 | Email delivery (sign-up confirmation, password reset, notices) | High | Repo records say not configured; unverified in production |
| 6 | Empty marketplace at launch | Medium | Production shows 0 businesses and 0 products |
| 7 | Authenticated production workflows | High | Not tested: needs the owner to sign in |

## 1. Business identity verification

What exists (verified in code and local tests): a seller sends documents; a reviewer decides each item with a written reason; every decision is written to the audit log; public pages say plainly that "being listed here is not an official registration check" and show "review in progress" or "not reviewed" until documents are approved. There is no automated registry lookup, by design.

Gaps and recommendations:
- Write the verification standard: which documents count for which business type, what makes a rejection, how a seller appeals, how long a review should take. Without it, two reviewers will decide differently.
- Name who staffs the queue and how many reviewers are needed. The repo checklist still lists "first and second administrator exist with MFA" as unchecked; confirm both exist in production.
- The document virus scanner (`clamd`) is unchecked in the launch checklist; documents should not be released to reviewers until it is connected and an EICAR test file is rejected.
- Keep the wording honest as it is. Do not let marketing copy turn "documents reviewed" into "verified business".

## 2. Fraud and abuse reporting

What exists: a report form on each public business page, product reports on the catalogue, and admin queues for reports (`/admin/reports`, `/admin/catalogue/reports`). Admin actions need a written reason and are audited.

Gaps and recommendations:
- There is no written triage procedure. Define: who reads new reports, within what time, what evidence to keep, when to hide a listing pending review, when to suspend, and how the reporter and the business are told.
- Add a published way to reach INOK urgently (complaints page exists; confirm it states a real contact and expected response time).
- Test the full report-to-takedown path once as an administrator in production-like conditions (staging, with a synthetic listing). I tested listing approval with a reason locally; I did not test takedown of a reported listing.

## 3. Government-content publication controls

What exists (tested locally): a programme is proposed by one person and published only after a different administrator approves with a written reason; nothing publishes automatically; statuses that cannot be confirmed show as "not confirmed"; monitoring and notification switches default to Off; every step is audited. `editorial-process.md` sets a manual 14-day review against official sources.

Production state (read-only, public pages): 4 real programmes and 14 news items are published and none carries demo markers. Not confirmed: that a person verified each against its official source (checklist item still unchecked), the current state of the Publishing, Monitoring and Notifications switches (needs an admin session), and native-speaker review of the Bahasa Melayu and Tamil wording.

Recommendations: have the editor sign off each published record in writing; confirm Monitoring and Notifications are Off; keep the disclaimer page linked from programme pages.

## 4. picomatch audit exception

Advisory GHSA-fc5q-39xc-vjpf (picomatch up to 4.0.7). On 2026-11-18 npm still reports 4.0.7 as the latest version, so no patched release exists. The approved exception covers only this advisory id and expires on 2027-01-15, 58 days from today; after that date the audit gate fails closed and CI goes red unless the dependency is patched or the owner renews the decision. picomatch is not in the deployed Worker bundle (see the risk assessment document). Action: re-check for a patched release weekly; put the expiry date in the owner's calendar for early January; do not widen the exception.

## 5. Email delivery

`email-activation-plan.md` is headed "prepared, nothing configured": a production SMTP provider, sender domain, SPF, DKIM and DMARC are listed as management decisions and DNS changes needing approval. The launch checklist still shows "SMTP delivery verified with real mailboxes" unchecked. Until mail works, sign-up confirmation, password reset and quotation or verification notices cannot be relied on. I did not trigger any production email (that would send real mail). To verify: after the provider is set up, use a password reset on an account the owner controls and check the inbox, spam placement and the SPF/DKIM/DMARC results. This is the main blocker for opening public sign-up.

## 6. Empty marketplace

Live, read-only: the directory shows 0 results and the catalogue shows 0 products. Programmes and news are populated. Visitors who open Find a business or Products from India today see empty pages. Onboard and verify the first real businesses and approved partner products before launch, or keep sign-up gated and say "coming soon" where pages are empty. Do not seed fictional listings in production.

## 7. Authenticated production workflows

Not tested. The built-in browser is not signed in to app.inok.my, and entering a password is not something I do. Once the owner signs in there, I can walk the read-only paths (home, notifications, requests, settings, admin overview, verification queue, reports, programme switches) without creating data. Until then, sign-in, MFA, role permissions and admin views are verified only locally and in CI.

## Also open from the launch checklist (as recorded in the repo, not re-verified)
Staging acceptance on the exact release commit; production backup and a restore drill; privacy policy and terms linked at sign-up with matching consent versions; management approval to enable public registration; the landing navbar release (a separate PR).

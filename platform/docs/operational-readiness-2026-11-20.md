# Operational readiness review (2026-11-20)

Scope: business verification, transactional email, complaint handling. Method: repository and migrations, plus read-only checks of production (settings endpoint, counts, response headers). Status words: **Works** (in code and tested locally), **Needs configuration** (code ready, an external service or setting is missing), **Needs procedure** (people and rules, not code), **Gap** (not built). No production setting was changed.

## 1. Business verification
| Item | Status | Detail |
|---|---|---|
| Claims and review flow | Works | Seller submits claims (registration, authorised person, address and so on) from onboarding; staff review and decide; decisions recorded with notes; conflict-of-interest rule keeps a reviewer who was involved with an organisation away from its decision (tested). |
| Document handling | Works | Uploads go to the private `verification-docs` bucket: no public links, short-lived access for authorised staff only, type and size checks, evidence hashes. Verified by pgTAP 29 and hosted tests. |
| Malware scanner | **Needs configuration** | No scanner is connected (`CLAMD_HOST` unset). The app fails closed: every upload stays **quarantined** and cannot be approved or downloaded, so **document-based verification cannot complete in production**. Options and the free-tier limits are in `malware-scanning-options.md` (clamd on an always-on host reached by a Cloudflare Tunnel is the lowest-cost route that needs no code change). VirusTotal was rejected for privacy reasons. The Privacy Notice says this. |
| Staff permissions | Works | `admin_review` and `admin_super` can review and decide; `admin_ops` and `admin_super` can view reports; `admin_super` handles data requests (`privacy:handle`); all administrator roles require a second factor. **Production has exactly one staff membership**, so there is no second reviewer: separation of duties and the conflict-of-interest rule cannot operate in practice, and one lost account would remove all staff access. |
| Review standards | **Needs procedure** | No written standard exists (what evidence is acceptable, who may approve, turnaround, what to do with a doubtful document, how to handle identity cards: the Privacy Notice tells users not to send them). Listed as unwritten in `launch-risk-review-2026-11-18.md`. |
| "Verified" wording | Works | The product says INOK "reviewed documents for"; it never claims official or SSM verification (unit-tested wording lint). |

## 2. Transactional email
| Item | Status | Detail |
|---|---|---|
| Registration confirmation and password recovery | **Configured, delivery unproven** | Supabase Auth on production uses custom SMTP via Resend (verified read-only; credentials not displayed). DNS for the sending subdomain `mail.inok.my` is in place. What is missing: a delivery test to a real mailbox, a DMARC reporting address, inbound mailboxes, a decision on the Resend plan limit, sign-up abuse protection. See `email-production-status-2026-11-20.md`. (Correction: an earlier version said no SMTP was configured.) |
| Application notifications (verification decisions, invitations, enquiries, quotations, reminders) | Works in code; delivery unproven | `src/server/mailer.ts` sends through the Resend HTTPS API when `RESEND_API_KEY` exists (it does on the production Worker), otherwise SMTP; queue `private.notification_email_queue` (0 rows: no activity yet) with opt-out, retry and a 10-per-person-per-hour cap; delivered by a cron every 2 minutes. In-app notifications need no email. |
| Templates | Gap (partial) | Confirmation, recovery and security-notice templates exist in `supabase/templates/`, **English only**; Supabase cannot pick a language without the locale stored in user metadata (not implemented). |
| Provider, DNS (SPF, DKIM, DMARC), sender, bounce handling | Mostly done; gaps remain | Resend DKIM, SPF and bounce records exist for `mail.inok.my`; DMARC at `_dmarc.inok.my` is `p=none` with **no reporting address**; the root `inok.my` has no MX (it cannot receive mail, so no replies, support or privacy mailboxes). |
| Sign-up when mail cannot be sent | **Fixed in this branch** | Previously "Something went wrong" or a "check your email" page with nothing arriving. Now a plain message in English, Malay and Tamil. Unit-tested; no setting changed. |
| Decision needed now | | Approve the delivery test and the inbound-mail setup in `email-production-status-2026-11-20.md`; decide on sign-up abuse protection before any launch campaign. Production sign-up is open today; no change was made. |

## 3. Complaint handling
| Item | Status | Detail |
|---|---|---|
| Reporting | Works (partial) | A signed-in user can report a listing, product, review or buyer request (reason plus a short note, one open report per user per item). Agreement issues: the buyer can report an issue with a reason and description (WP5). Data requests: My account, "Your data requests". |
| Fraud, disputes, anything else | **Gap** | The policy says "email the support address", which is a placeholder: **no complaints mailbox exists yet**. |
| Staff view | Works | Listing and request reports in `/admin/reports`; agreement issues in `/admin/issues` (read-only); data requests in `/admin/privacy-requests` with status and due date (21 days). |
| Assignment, response times, escalation | **Gap + procedure** | Reports have status, handler and note only: no assignee, no due date, no reminder, no escalation level, no evidence upload. Agreement issues have no resolution workflow, no reply and no deadline. Targets in the policy (acknowledge in 3 working days, reply in 14) are proposals. |
| Evidence handling | **Needs procedure** | No attachments for reports. Decide what evidence staff may ask for, how it is stored, and for how long. The conversation and agreement history is the only evidence the platform holds. |
| Escalation | **Needs procedure** | Who decides on suspension, who contacts police or KPDN, who notifies the PDP Commissioner after a breach (`docs/legal/incident-response.md` exists as a draft). |
| Seller response to an issue | Gap (recommendation) | The seller is notified but cannot reply or acknowledge in the platform. |

## 4. Safe code defects fixed on a dedicated branch
`feature/legal-drafts-readiness`: sign-up error handling for undeliverable confirmation email (above). Reviewed and found no further safe, reproducible defect in verification, email or complaint code; the remaining items need configuration, procedures or new features (listed above and not built, as instructed).

## 5. Readiness checklist (what must be true before a real-business pilot)
- [ ] Production email delivery proven with real mailboxes (confirmation, recovery, notification) and inbound addresses working
- [ ] Sign-up abuse protection (captcha or invitations) before launch; today it is open
- [ ] A second staff member (reviewer) with a second factor; a recovery owner for the Supabase and Cloudflare accounts
- [ ] Malware scanner connected (or document verification explicitly not offered)
- [ ] Written verification standard and fraud/complaint procedure; complaints mailbox and who reads it
- [ ] Complaint targets approved; where to record assignment and outcome until a feature exists (a shared sheet is acceptable)
- [ ] Backups: daily backups or PITR enabled (see `backup-options-2026-11-20.md`)
- [ ] Legal drafts approved and company details filled in (`legal-audit-2026-11-20.md`)
- [ ] Erasure policy decided and implemented (`erasure-option-c-proposal.md`)
- [ ] Authenticated production test with company-controlled QA accounts (`production-authenticated-testing-plan.md`)

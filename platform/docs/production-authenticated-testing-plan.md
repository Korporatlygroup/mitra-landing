# Production authenticated testing: findings and plan (2026-11-20)

**Nothing authenticated has been verified on production.** No production account, order, enquiry or payment was created for this review. Every check below that touched production was read-only.

## 1. Findings (read-only)
| Question | Answer | Evidence |
|---|---|---|
| Is account creation enabled on production? | **Yes, open to anyone.** | Supabase Auth settings endpoint of `inok-production`: `disable_signup: false`, `mailer_autoconfirm: false`, email provider on. The site is public (`ACCESS_GATE` is "off", lifted by the owner on 2026-11-17). `docs/production-readiness-checklist.md` still says "Public sign-up: do not enable until you approve launch", so the checklist and the live setting disagree. |
| Do confirmation emails work? | **Configured, delivery not yet proven.** (CORRECTION 2026-11-20: an earlier version of this page said no SMTP was configured; that was based on a stale plan document.) | Read-only `supabase config diff` of `inok-production`: custom SMTP **enabled**, host `smtp.resend.com`, port 465, sender `INOK <no-reply@mail.inok.my>`; the Worker holds a `RESEND_API_KEY` secret; DNS for `mail.inok.my` has the Resend DKIM, SPF and bounce records. Earlier release notes record one controlled invitation that Supabase handed off without error but whose arrival in a mailbox was never confirmed. No end-to-end delivery has been observed. Details: `email-production-status-2026-11-20.md`. |
| What happens to a person who signs up? | They should receive a confirmation email from no-reply@mail.inok.my; if the provider refuses (unverified domain, revoked key, outage, daily limit) the app now says so plainly (PR 32). | Unproven until a real inbox test is done. Limits that can bite: Resend Free allows 100 emails per day; Supabase Auth allows about 30 emails per hour on custom SMTP unless raised. |
| Existing users and staff | 6 users, all confirmed; 1 staff (INOK) membership; 7 non-staff organisations; 0 published listings; 0 queued emails. | read-only counts, no personal data read |
| Can an existing administrator provision QA accounts? | **Not from the application.** | `/admin/users` lists users and changes roles; it has no "create user" action. Accounts can be created only by sign-up (needs email), or by a person with Supabase dashboard access (Auth > Users > add user, optionally pre-confirmed). That is a production change and needs approval. |
| Do password reset and invitations work? | Same dependency on email. Unverified. | |

## 2. Company-controlled QA accounts (SMTP-first route, chosen by the owner 2026-11-20; nothing created yet)
Email is already configured through Resend (section 1), so the QA accounts can go through the **real sign-up and confirmation path**, which is the best test of registration. Plan, in order, each step needing approval before it is done:
1. Set up inbound mail for the inok.my domain (options and exact steps in `email-production-status-2026-11-20.md`), so that two company-controlled addresses exist: `qa-buyer@inok.my` and `qa-seller@inok.my`, each forwarding to a named company mailbox.
2. Prove delivery once with a controlled message to one company mailbox (headers must show SPF, DKIM and DMARC pass).
3. Register the two QA accounts through the normal form (display names "QA Buyer", "QA Seller"; synthetic organisation names such as "QA Buyer Co (test)"; strong generated passwords kept in the company password manager, never in chat or the repository), confirm by email, accept the real terms.
4. Rules: owned by named staff, listed in a QA register with a removal date, no published listing, and no agreement or order until the erasure policy exists (agreements cannot currently be erased).
Fallbacks if email still fails: add two company mailboxes to the Supabase team, or create pre-confirmed users in the Supabase dashboard.

## 3. What can run on production without writing test data
(Already done unless marked.)
- Public pages, routes and redirects in en/ms/ta; sign-up form structure, consent inputs, language row (done after each deploy).
- Mobile (375 px) rendering of public pages, no sideways scroll (done).
- Build identity: Worker version, bundle strings (done at deploy).
- Read-only database facts: migration list, function grants, counts (done).
- Response headers, cookies set for visitors (done: only `NEXT_LOCALE`).
Not possible without an account: everything behind login.

## 4. What must stay on the isolated local stack
Full transaction tests with realistic seeded data (already automated, desktop and phone, three languages): registration and consents, quick start, business review by staff, directory and enquiry, messaging, quotation with booking terms, revision, acceptance, locked agreement, order progress, issue report, staff issues list, permission isolation (a stranger and another seller see nothing), sourcing, government assistance. Latest local run on the released code: 56 + 32 + 36 end-to-end tests passed (see release reports), full pgTAP passed (2493 tests).

## 5. Production authenticated test plan (to run only after the approvals in section 2)
Preconditions: two QA accounts, a named tester, a rollback of nothing (read-mostly), a list of every row created (so it can be removed).
| # | Area | Steps | Expected | Writes to production |
|---|---|---|---|---|
| 1 | Registration | Open /signup, fill the form (three consents shown separately), submit | "Check your email" page; email arrives; link opens /auth/callback and signs in | creates the QA user |
| 2 | Confirmation failure path | Sign up with an address that cannot receive mail | Clear "cannot send confirmation emails yet" message (this branch) | none |
| 3 | Login, logout, wrong password | Sign in/out, wrong password | identical generic error; session works | none |
| 4 | Password reset | Request reset for the QA account | email, reset page, new password works | password change of QA user |
| 5 | Onboarding | Seller: quick start, 3 steps (name, state, one service) | listing sent for review, not published; next steps shown | creates a QA organisation and a draft listing; do not publish |
| 6 | Staff review | An INOK admin opens the listing queue | QA listing appears; reject or leave pending (do not approve: it would publish) | none if left pending |
| 7 | Messaging | Buyer asks a business for a quote from a profile | needs a published business: **skip on production** unless a real business exists; use an enquiry between the two QA organisations only if both are unlisted | an enquiry and messages |
| 8 | Quotation and agreement | Seller sends a quotation with booking terms; buyer requests a change, then accepts | terms visible before accepting; agreement created with locked terms | quotation, agreement, events (cannot be deleted later: see erasure limitation) |
| 9 | Order viewing | both sides open the agreement | terms, status, history; stranger gets 404 | none |
| 10 | Issue reporting | buyer reports an issue with a reason | status "Issue reported"; seller notified; staff list shows it | an event and a notification |
| 11 | Mobile and languages | repeat 1, 5, 8, 10 at 375 px in en, ms, ta | no clipping, labels translated | none |
**Warning for steps 8 and 10:** agreements and events cannot currently be erased (the open privacy limitation), so they would remain in the production database permanently. That is a reason to prefer running steps 7 to 10 only locally until the erasure policy is implemented, and on production only steps 1 to 6 and 9 to 11 read-only, or one agreed set of QA agreements that is accepted as permanent.

## 6. What I changed to help (this branch)
- PR 32: sign-up shows a plain message when the confirmation email cannot be sent (unit-tested, three languages). No Supabase, auth or provider setting was changed.

## 7. Decisions for you
1. Approve the inbound-mail setup and the one-time delivery test (see the email document); name the company mailbox that receives the QA addresses.
2. Whether production sign-up stays open until captcha or invitations exist (no change was made; it is open today).
3. Whether to accept permanent QA agreements on production before the erasure policy exists (recommended: no, keep transaction tests local).

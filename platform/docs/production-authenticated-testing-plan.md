# Production authenticated testing: findings and plan (2026-11-20)

**Nothing authenticated has been verified on production.** No production account, order, enquiry or payment was created for this review. Every check below that touched production was read-only.

## 1. Findings (read-only)
| Question | Answer | Evidence |
|---|---|---|
| Is account creation enabled on production? | **Yes, open to anyone.** | Supabase Auth settings endpoint of `inok-production`: `disable_signup: false`, `mailer_autoconfirm: false`, email provider on. The site is public (`ACCESS_GATE` is "off", lifted by the owner on 2026-11-17). `docs/production-readiness-checklist.md` still says "Public sign-up: do not enable until you approve launch", so the checklist and the live setting disagree. |
| Do confirmation emails work? | **Not for ordinary users, as far as can be determined.** | `docs/email-activation-plan.md`: no SMTP provider is configured and nothing was switched on. Supabase documentation: without a custom SMTP server Auth refuses to email any address that is not a member of the project's organisation team, and the built-in sender is limited to 2 messages per hour. So a stranger can submit the form but cannot receive the link. I did not test it live because that would create an account. |
| What happens to that person? | A confusing dead end (before this branch: "Something went wrong", or "check your email" with nothing arriving). | `signUp` mapped delivery errors to a generic error. Fixed in this branch (message says confirmation emails cannot be sent yet). |
| Existing users and staff | 6 users, all confirmed; 1 staff (INOK) membership; 7 non-staff organisations; 0 published listings; 0 queued emails. | read-only counts, no personal data read |
| Can an existing administrator provision QA accounts? | **Not from the application.** | `/admin/users` lists users and changes roles; it has no "create user" action. Accounts can be created only by sign-up (needs email), or by a person with Supabase dashboard access (Auth > Users > add user, optionally pre-confirmed). That is a production change and needs approval. |
| Do password reset and invitations work? | Same dependency on email. Unverified. | |

## 2. Safest ways to get company-controlled production QA accounts (each needs your approval)
Ranked by safety. None has been done.
1. **Team-address sign-up (no configuration change).** Add two company mailboxes (for example a "QA buyer" and a "QA seller") as members of the Supabase organisation team; Supabase will then deliver Auth mail to those addresses even without custom SMTP. Register them through the normal sign-up form, confirm by email. This exercises the real registration, confirmation, login and consent path. Cost: two team seats (check the plan); accounts are real users that stay in production.
2. **Dashboard-created, pre-confirmed users.** A project owner creates the two users in the Supabase dashboard (Auth > Users) with a generated password kept in the company password manager. Fast, but does not test email, and password handling is outside the app. Use only if option 1 is not possible.
3. **Configure custom SMTP first** (the email activation plan), then register QA accounts with `qa-buyer@` and `qa-seller@` company mailboxes. This is the proper long-term fix and also required for real users; it needs a provider, DNS records (SPF, DKIM, DMARC) and your approval.
Any of these must follow the rules: QA accounts are labelled (display name starts with "QA"), owned by named company staff, use only synthetic business names, are never given a published listing, and are listed in a register with an owner and a removal date.

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

## 5. Production authenticated test plan (to run only after approval of option 1, 2 or 3)
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
- Sign-up now shows a plain message when the confirmation email cannot be sent (unit-tested, three languages). No Supabase, auth or provider setting was changed.

## 7. Decisions for you
1. Which QA account route (1, 2 or 3), and which two company mailboxes.
2. Whether production sign-up should stay open before email works (Supabase dashboard setting `Allow new users to sign up`, or restore the access gate). This is a production configuration change: not made.
3. Whether to accept permanent QA agreements on production before the erasure policy exists.

# 1. Feature inventory (Phase A)

Built from the repository at branch `test/multi-agent-journeys` (from `optimize/cf-free-render` e48f8c6): 112 page routes under `src/app/[locale]`, 6 API route groups, 26 service modules, 74 public tables, the Phase 1-7 reports, and the staging database. Status words: **Implemented** (code present and exercised in this run or the earlier suites), **Partial**, **Disabled by design** (built, switched off or fail-closed on purpose), **Missing** (no code). "Exercised here" means the agent suite in this report drove it through the browser on 2026-11-17.

Prerequisites common to everything: a confirmed Supabase Auth account (staging has no mail provider, so confirmation is done with the Auth admin API for test accounts), an organisation of the right type, and for privileged work an administrator session with TOTP.

| # | Module | Pages / entry points | Status | Prerequisites and test data | Exercised here |
|---|---|---|---|---|---|
| 1 | Registration, login, sign-out, recovery | `/signup`, `/signup/check-email`, `/login`, `/forgot-password`, `/reset-password`, `/auth/callback` | Implemented. Confirmation and recovery **emails are not delivered** (no provider) | Email links need a mail provider; recovery tested earlier by generating the link with the Auth admin API | Sign-up and login validation, no enumeration, redirects; recovery by earlier `tests/hosted` |
| 2 | MFA (TOTP) | `/mfa/enrol`, `/mfa/verify` | Implemented; **required for administrator roles** only | Admin account with a TOTP factor | Admin and second admin sign in with TOTP |
| 3 | Organisations, members, invitations | `/orgs`, `/orgs/new`, `/orgs/[id]/members`, `/invite/[token]` | Implemented. Invitation **delivery is by email only** (undeliverable on staging) | Signed-in user | Org creation for 4 personas through the form. Invitation acceptance **blocked** (no mail) |
| 4 | Business onboarding (5 steps) | `/orgs/[id]/business/onboarding` | Implemented | Business org | Steps 1-5 and validation |
| 5 | Business verification (claims, documents, admin decision) | `/orgs/[id]/business/verification`, `/admin/verification` | Implemented; **document path disabled by design while no malware scanner exists** (uploads are accepted but quarantined, claims cannot be sent) | Scanner or the local ClamAV stub | Upload and quarantine verified; approval path recorded as disabled |
| 6 | Business listing (public profile) | `/orgs/[id]/business/listing`, `/preview`, `/admin/listings` | Implemented | Business org with onboarding data | Edit, preview privacy, send for review, admin approval, publication |
| 7 | Public directory, search, filters, profiles | `/directory`, `/directory/[slug]`, `/search` | Implemented | A published listing | Search, empty state, hostile input, 404s, profile privacy |
| 8 | Buyer requests (5-step), matching, invitations | `/requests/*`, `/orgs/[id]/business/requests` (+ board) | Implemented | Buyer org, an approved listing in a matching category and state | Full flow |
| 9 | Enquiries, messaging, quotations, negotiation | `/enquiries`, `/enquiries/[id]` | Implemented | An enquiry (created from a listing, request invitation or referral) | Reply, draft, send, change request, version 2, accept, outsider refused |
| 10 | Leads and reviews | `/orgs/[id]/business/leads`; reviews moderation `/admin/reviews` | Implemented | Accepted quotation | Lead appears for the seller |
| 11 | Referrals between businesses | integrated into enquiries | Implemented (earlier suite e46) | Two businesses | Not driven here |
| 12 | Catalogue partner workspace (suppliers, products, import, requests) | `/orgs/[id]/partner/*` | Implemented; media and supplier documents need a scanner for release | Partner org **approved by MITRA** | Gate, wizard step, screens |
| 13 | Products from India catalogue (buyer side): browse, compare, save, price request | `/catalogue/*` | Implemented | Approved supplier with a published product | Screens and empty states; no approved product exists on staging |
| 14 | Catalogue administration (partners, suppliers, products, reports, imports) | `/admin/catalogue/*`, `/admin/products` | Implemented | Admin session | All pages open |
| 15 | Sourcing / RFQ (buyer and partner) | `/sourcing/*`, `/orgs/[id]/partner/sourcing`, `/admin/sourcing` | Implemented; **attachments refused without a scanner** | Buyer plus an approved partner | Screens and validation; full journey covered by earlier `tests/hosted/sourcing-uploads.spec.ts` |
| 16 | Government assistance navigator ("Business help") | `/business-help/*`, `/admin/business-help/*` | Implemented. **Publication off until records are verified against official sources**; monitoring off | Published programmes (none are verified) | Eligibility profile, find, saved, settings, empty states |
| 17 | Training and course discovery | only as the "training" need inside Business help and a dashboard training list | **Partial** (no course catalogue) | n/a | Filter page opens |
| 18 | News and bulletins, saved items, digest | `/news`, `/admin/news` | Implemented; digest email undeliverable | Published posts | List and 404 |
| 19 | Notifications | `/notifications` | Implemented in-app; email only after provider acceptance (not available) | Events | Page and content |
| 20 | Account, consents, privacy requests | `/account`, `/admin/privacy-requests` | Implemented | Account | Page, weak-password refusal |
| 21 | Legal pages (privacy, terms, cookies, marketplace policy, complaints, government notice) | `/privacy` etc. | Implemented as **unpublished drafts** (placeholder text per Message B) | n/a | Render in 3 languages, accessibility |
| 22 | Languages en / ms / ta | everywhere | Implemented; ms and ta machine-assisted, need native review | n/a | All public pages x 3 languages |
| 23 | Admin console: users and roles, audit, reports, listings, verification, reviews | `/admin/*` | Implemented; role-gated by permission | Admin | Every console page opens; role gate checked |
| 24 | Scheduler and gov workers | `/api/v1/jobs/gov`, `/jobs/rescan` | Implemented; secret-protected; gov switches off | Worker secrets | Not driven (not a user journey) |
| 25 | **Business Readiness Passport** | none | **Missing**: no code, route or message in the repository | n/a | Recorded as missing |
| 26 | Payments, orders, checkout | none | **Missing / out of scope**: INOK is a directory and enquiry platform; quotations record an agreement but no money moves | n/a | Recorded |
| 27 | Real-time chat, push notifications | none | Missing (messaging is per-enquiry, page refresh) | n/a | Observed |
| 28 | Email (all kinds) | `mailer.ts`, templates prepared | **Disabled: no provider** | SMTP provider | Recorded |

API routes: `/api/v1/health`, `/api/v1/documents/[id]` (private download; scanner-gated), `/api/v1/catalogue-media/[id]`, `/api/v1/products/[id]/media`, `/api/v1/suppliers/[id]`, `/api/v1/sourcing/[rfq]`, `/api/v1/jobs/gov|rescan`.

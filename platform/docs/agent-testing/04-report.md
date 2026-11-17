# Multi-agent user-journey test: report (2026-11-17)

Branch `test/multi-agent-journeys` (from `optimize/cf-free-render` e48f8c6). Environment: `mitra-staging` Supabase and the staging Worker `inok-app-staging` (running `e93ac199`). Production, `inok-app-production`, `inok.my` and the Cloudflare plan were not touched. Staging access protection stayed on. Companion files: `01-feature-inventory.md`, `02-roles-and-permissions.md`, `03-test-personas.md`, `generated-coverage.md` (machine-generated check list), suite in `tests/agents/`.

## How the evidence is split (important)
The Free Worker cannot serve signed-in traffic reliably (see `docs/cloudflare-worker-cpu.md`), so a Worker-only run cannot show whether the application works. Two runs were therefore made, never merged:
- **Worker run (target `worker`)**: the full suite against the staging Worker, one runner, no retries on actions, sign-in retried only after a Worker 5xx. Every 5xx is logged in `hosting-events.jsonl`.
- **Control run (target `control`)**: the same code, built from this worktree and served locally, against the **same mitra-staging database and Auth**. No Worker CPU limit applies, so a failure there is an application, database or test defect. This is an addition to the brief, not a replacement for the Worker run; it used the staging keys at run time only (never printed or written).

## Results
| | Checks | Pass | Fail | Notes |
|---|---:|---:|---:|---|
| Worker run | 145 | 135 | 5 | 4 of the 5 failures coincided with Worker 5xx (hosting); 9 of 28 tests passed, 6 failed, 13 did not run because a serial scenario stopped after its first blocked step |
| Control run | 190 | 155 | 16 | Of the 16: 7 are test-script defects found and fixed (selector or old markup) and not all were re-run; 9 are product findings or observations below |

Coverage of Phase D modules: public discovery, three languages, legal pages, sign-up/login/recovery validation, organisations, seller onboarding, listing, admin review, request board, enquiries, quotation negotiation, notifications, sourcing screens, Business help, news, account, language, mobile, accessibility, isolation and authorisation were driven. Not driven end to end: supplier and product approval (blocked, F-04), catalogue buyer price request (no approved product exists), full RFQ journey (covered by the earlier `tests/hosted/sourcing-uploads.spec.ts`), government programme records (publication is off), invitation acceptance and email-based recovery (no mail provider).

## Coordinated journey (control run, passed)
Buyer A posts a five-step request, invites the seller; the seller signs in independently, shows interest, replies, drafts and sends a quotation; Buyer A asks for a change, the seller sends version 2, Buyer A accepts; the seller sees the accepted state and the lead; neither can repeat the decision; Buyer B (outsider) is refused the request, enquiry, quotation list and messages. Re-reads were made through the UI in each persona's own browser context.

## Security and tenant isolation (F)
All passed on both targets (22 to 25 checks): Buyer B read none of Buyer A's rows in 20 tables through the real PostgREST API with its own session; Buyer B and the seller were refused `create_invitation`, `set_member_role`, `remove_member`, `bootstrap_first_admin` and an admin decision function; anonymous users read none of 9 sensitive tables and cannot insert organisations, memberships or audit rows; no API role can list, read or upload to the private verification bucket; the document route answers 404 for unknown ids; no secret or service-role key appeared in any response a signed-in buyer received (the live secret key value was searched for). Admin console: a buyer and a seller see only "You do not have access" (no data); `admin_review` is refused the user console while `admin_super` is not; administrators need TOTP. **No P0 or P1 security defect was found.** Scanner-dependent flows stay closed: uploads are accepted but quarantined, the claim cannot be sent, attachments to sourcing are refused.

## Findings (prioritised)
| ID | Sev | Class | Finding | Reproduce |
|---|---|---|---|---|
| F-01 | P2 | Application | **Send quotation fails with "Someone changed this item while you were reading it"** after the draft is saved a second time without reloading; a reload then sends. The Send form keeps a stale draft version. | Seller opens an enquiry, saves a draft, saves again, presses Send quotation. Recorded by the suite as UX-QUOTE-STALE. |
| F-02 | P2 | Application / product gap | **Partner (supplier) route is a dead end for a self-registered organisation.** `/orgs/new` offers type "Partner", but the admin partner list does not show it, and the partner wizard never opens. The documented route is that MITRA provisions partners and emails the owner an invitation, which cannot be delivered on staging. Either remove the option from the sign-up form or explain it. Not conclusively isolated: the control run's partner screens redirected instead of showing the gate (needs a human check of the intended redirect). | Create a Partner organisation, open `/en/orgs/<id>/partner/suppliers/new`. |
| F-03 | P3 | Application | **Denied admin pages return HTTP 200** with an in-page message. No data leaks, but 403 is correct for monitors and crawlers. | Buyer opens `/en/admin/verification`. |
| F-04 | P3 | Application | **Two `<main>` landmarks** on `/admin/sourcing` and `/sourcing` (a nested `<main>` in the page, `admin/sourcing/page.tsx:13`). Accessibility defect. | Open either page. |
| F-05 | P3 | Hosting-adjacent / product | **Sign-in is throttled to 10 attempts per 15 minutes per email** (counting successes). Correct as a protection, but a person signing in from several devices or after a bad day can be locked out with only a generic "Too many tries" message and no time hint. Also the Auth service rate-limits per source address. | Sign in 10 times in 15 minutes. |
| F-06 | P3 | Application | **A buyer is capped at 5 open requests** ("You already have 5 open requests. Close one first.") with no link to the open ones in the message. Works as designed; usability note. | Post a sixth request. |
| F-07 | P3 | Test infrastructure | Staging carries 63 `admin_super` memberships from earlier hosted runs (TI-01). Clean before staging data is reused or copied. | Query memberships. |
| F-08 | Info | Missing features | **Business Readiness Passport** has no code. **Training/course discovery** exists only as the "training" need inside Business help. No payments or ordering, no real-time chat, no email of any kind. | Inventory, section 1. |

Observations from usability review (enhancements, not defects): the seller board opens a side drawer and the enquiry link text differs by state ("Open the enquiry" vs "Open the full page"); the header after sign-in shows "My business" for buyers too; the sign-up form shows the browser's own English validation tooltip and has two separate mandatory consent boxes plus an optional one; invitations and recovery depend entirely on email, so there is no in-app fallback for a person without mail.

## Hosting and runtime failures (reported separately, G)
Worker run, 46 logged 5xx or navigation failures, none recovered by simple retry: **30 × 503 on the login form post**, 8 × 503 on `/orgs/:id/partner`, 4 × 503 and 4 × 500 on `/api/v1/documents/:id`. The same requests succeeded on the control host (the document route answered 404 as designed). They match the known Cloudflare Free CPU limit and the poisoned-isolate behaviour documented in `docs/cloudflare-worker-cpu.md`; Worker logs were not re-collected in this run, so the class is "hosting (inferred from control-host success)". Consequence: on the Worker, sign-in itself fails often enough that persona journeys stop at their first step (13 tests did not run). Pages served from the public cache passed (all 54 public renders and accessibility checks).

## Test infrastructure notes
Per-email login throttle and the Auth rate limit forced waits (150 s) and made the control run take about an hour of wall time; the suite logs each wait. A serial scenario stops at its first blocked step by design (`must`), so a hosting failure hides later steps in the same file. The suite is idempotent against reuse of the personas but accumulates open requests (capped at 5).

## Readiness assessment
- **Application logic and isolation: good.** The main business journey works end to end for both sides, access isolation held on every check, and the defects found are P2/P3.
- **Hosting: not ready.** On the Free Worker the signed-in product cannot be exercised reliably, so it cannot support real users. This is the single blocker for launch and is independent of the application defects.
- **Not verifiable yet:** supplier and catalogue journeys (F-02), email-dependent flows, government programme records, malware-scanned documents.
- Recommendation: fix F-01 and F-02 before launch, move hosting off the Free CPU limit (a zero-cost alternative was not tested), then rerun this suite against the new host.

## Recommended product improvements (for review, not implemented)
Return 403 on denied admin pages; refresh the quotation form version after each save; hide or explain the "Partner" organisation type; show remaining lock time on login throttling; link the five open requests in the limit message; add an in-app way to accept an invitation when email is down; remove the nested `<main>`.

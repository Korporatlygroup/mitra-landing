# Phase 3 report: directory, customer requests, matching

Scope: local development only. Branch `feature/phase3-directory`, based on Phase 2 `adc8c96` (PR #5, stacked on PR #3, both still open). Nothing is pushed, merged or applied to hosted staging. Contract for Phase 4: `docs/contracts/phase3-phase4.md` (`p3p4-contract/1.0`).

## Delivered
- **Seller:** public page editor (headline, description, chosen public contact, up to 10 services with areas, minimum order, lead time and capacity notes, up to 8 text examples), preview, send for review, withdraw, unpublish and republish, a "busy" switch, review history, MITRA's reasons. Editing never changes the approved public version.
- **Buyer:** public directory (search, category, state, paging, zero-result help), business page with in-app enquiry and report, five-step request wizard with save and resume, My requests, request page with explained matches, invite (max 10), search wider, close or withdraw.
- **Seller inbox:** invited requests (New, Replied, Closed), reply Interested / Ask a question / Cannot take it, customer contact shown only after a reply and only with the buyer's consent.
- **Admin:** listing review queue (approve, ask for changes, reject with reasons), suspend and reinstate, reports queue for listings and requests, history, audit. Reviewers with any past involvement with an organisation are blocked.
- **Enquiry seam:** `enquiries` rows with immutable participants, created only by RPCs; a read-only enquiry page. Messages and quotes are Phase 4.
- **Matching:** deterministic (category, service area, published and accepting, minimum order, lead time), reason and caution codes saved per match.

## Files
Migrations `20260701000012`, `…013`, `…014`; pgTAP `10_phase3_directory_requests.test.sql` (plus updated `01_` and `02_` inventories); `src/server/services/directory.ts`, schemas, permissions mirror, `buyer-orgs.ts`; pages under `directory`, `requests`, `enquiries`, `admin/listings`, `admin/reports`, `orgs/[id]/business/{listing,requests}`; `ListingView`; EN and TA messages; `e40-directory-requests.spec.ts`, `p3-http.test.ts`.

## Evidence (all LOCAL, on a separate local Supabase stack; not CI, not hosted)
| Check | Result |
|---|---|
| pgTAP (`supabase test db`) | 10 files, 942 tests pass (749 Phase 1-2 + 193 Phase 3) |
| Unit | 15 files, 273 pass |
| Integration | 114 pass, 2 skip (first-admin bootstrap, as before) |
| Browser E2E (Playwright, 360px and 1280px) | 262 of 262 pass, including 3 new Phase 3 journeys, axe checks and Tamil pages |
| typecheck, lint, platform build | pass; lint 0 errors (4 warnings, none new) |
| root Astro build | pass |

## Independent review
- Review 1: 1 high (never-invited candidate sellers could read a request after it ended), 2 medium, 11 low or plausible. All high and medium and the low items worth fixing were fixed with new tests.
- Review 2: no critical or high; all fixes confirmed; 4 residuals, 2 fixed (inbox consistency for suspended buyers, contact served only while the request is open), 2 documented in the contract.

## Limits and not done
- Hosted staging, hosted migration, CI run, push: not done. The hosted migration-history mismatch is unresolved.
- Portfolio is text only (no public image bucket). No public request board (`visibility` allows only `private_invite`).
- Anonymous search has no DB rate limit (needs an edge limit). A user can create up to 200 draft rows an hour.
- Tamil is a machine draft needing native review. The whole app is `noindex`, including the directory.
- Not tested: real email delivery of the new notifications (in-app only), real users on phones.
- Local database note: the shared local stack (ports 54421-54429) holds two unrelated migrations (`directory_listings`, `customer_requests`) that match no branch. Rebuild any local database from the committed migrations.

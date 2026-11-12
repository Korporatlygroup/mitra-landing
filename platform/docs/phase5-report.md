# Phase 5 implementation report: India-Malaysia supplier catalogue (2026-11-12)

Branch `feature/phase5-supplier-catalogue` (local; not pushed, not merged, nothing applied to hosted staging). Baseline: `integration/phase1-4` at `e0781e2` (PR #7, draft). Contract `p5p6-contract/1.0` (`docs/contracts/phase5-phase6.md`; RPC list `phase5-rpc-reference.md`; app layer `phase5-app-reference.md`). Every result below is LOCAL, on isolated Supabase stacks. No CI run, no staging, no human security review.

## Migrations
`000110` partners and suppliers, `000111` catalogue (products, immutable revisions, live items/variants/tiers, media), `000112` import, `000113` buyer (search, compare, saved, sourcing requests, reports), `000114` admin reports and stats, `000115` review fixes. `000106` (Phase 4 erasure fix) is reserved and is NOT in this branch: it lives on `fix/phase4-account-erasure` (`5f5d876`, unreviewed by Codex). Every Phase 5 foreign key has an explicit delete rule; Phase 5 RPCs are `security definer`, `search_path = ''`, default-deny grants.

## Screens and workflows
- Partner dashboard (`/orgs/[id]/partner`): Home, Suppliers (4-step wizard, evidence upload, submit, withdraw, revisions keep the approved version live), Products (variants, price tiers with live checks, images, preview, submit/publish/unpublish), Import Catalogue (CSV/XLSX, templates, preview, rejected-rows CSV, confirm, history, same previewed file returns the same job), Buyer Requests (acknowledge, ask for clarification), Notifications, Settings.
- Buyer (`/catalogue`): search and filters, detail, compare (no currency conversion), saved products, Request Price (stored request with a snapshot of the terms the buyer saw), My requests.
- Admin (`/admin/catalogue`, MFA required): overview with real counts, partner provisioning and invitation, supplier and product review with decisions and reasons, reports, import totals.
- English, Tamil, Bahasa Melayu (parity tested). Browser tests at 360px and 1280px with axe.

## Real versus synthetic
All data in tests is synthetic. The database layer, permissions, workflows, import engine and file handling are real and database-backed. No real partner, supplier, product or buyer data exists. Tamil and Bahasa Melayu text is machine-assisted and needs native review. Malware scanning used a stub scanner in tests.

## Test evidence (local, final head with migration 115)
| Layer | Result |
|---|---|
| pgTAP | 18 files, 1,977 assertions pass (incl. `14`-`19`) |
| Unit | 791 pass (SUPABASE_* env unset) |
| Integration | 143 pass; `p5-http` 15 pass against a running app |
| Typecheck / lint / build | pass; 0 lint errors (6 warnings) |
| Browser (360px and 1280px, axe), 5 shards | all spec files have a passing run; 2 Windows worker crashes (exit 3221226505) passed on one retry; 2 specs (e52, e73) were stale against migration 115 and were updated (`91d141c`); the four affected specs were rerun (30 pass), the full run was NOT repeated after that |
Not tested: real concurrent sessions (the sourcing-snapshot lock is checked by source and normal paths only), a real PostgREST anonymous run beyond `p5-http`, a real malware scanner, hosted staging.

## Independent review
One read-only model review (no human). No critical; one high (a suspended supplier could be lifted by a review decision) and seven mediums, fixed in `000115` with 62 pgTAP assertions, except the items below. A second review of the fixes has NOT been done.

## Limitations and decisions needed
- Uploaded evidence and images are not deleted from storage by erasure or removal (no sweeper); they stay private and unreachable. Needs an owner.
- No malware scanner on staging: uploads stay inaccessible until one is provisioned.
- Accepted lows: reinstating a supplier puts its published products back on sale; no throttle on anonymous search; the buyer organisation is named after the person; sourcing events keep the actor id after erasure; leading `-` in text is refused.
- Viewers no longer see supplier contact/registration data (decision for the owner).
- Partner home counts come from list calls; no sort control or supplier dropdown in buyer search (RPC limits); no bulk submit of imported drafts; no admin list of all published products or all import jobs.
- Phase 4 erasure fix (`000106`) must be reviewed and merged before this branch can go to staging.

## Missing partner information
No named Indian partner organisations, supplier lists, categories or price conventions, verification checklist wording approved by MITRA legal, catalogue sample files, contact/escalation owners, or response-time targets have been supplied. Verification text states only what MITRA checked and when.

## Staging dependencies
Approval of the history reconciliation and deployment order (`staging-migration-reconciliation.md`), hosting project and env vars, auth redirect URLs, SMTP for partner invitations, malware scanner, rescan cron, native-language review.

## Phase 6 contract
Phase 6 starts at `000150`; it may add tables and columns but must not change contract section 4 columns. Interface: `sourcing_requests` and `sourcing_request_items` (identity, participants, statuses, line items). Phase 6 adds Request Any Product, multi-product requests (`request_kind`), supplier matching, quotation negotiation, samples and repeat sourcing. No payments, escrow, shipping, customs or supplier APIs.

## GitHub status
Nothing pushed. PR #7 (Phases 1-4) is draft with Auto-fix on. Branches local only: `feature/phase5-supplier-catalogue`, `ci/optimize-platform`, `fix/phase4-account-erasure`.

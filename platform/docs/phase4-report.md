# MITRA Phase 4 local integration report

Date: 2026-11-11 (Asia/Kuala_Lumpur). Branch: `feature/phase4-preparation`. This report covers local work only.

## Source and contract

- Preserved the prior independent Phase 4 rules in commit `4731734` before integration.
- Fetched Phase 3 directly from `C:\Projects\MITRA\MITRA-Claude`, verified commit `6ef9f01af9903960b07418d449eab0f79fa21c5b`, and merged it locally in `ee73f24` without conflicts. Phase 3 migrations are `20260701000012`–`14`.
- Read the finalized `p3p4-contract/1.0` at `docs/contracts/phase3-phase4.md` (SHA-256 `64E054F30248E8CBD258F39871FC3489078097C9089FC66F70661E3E3E80741B`; Git blob `a90ac260eeaa65b1f81ee91a6540b4c3a2c68e5c`). Phase 4 follows the single Phase 3 `enquiries` model and uses migrations `20260701000015`–`16`. The provisional client enquiry key was replaced by Phase 3's unique open-pair rule. No Phase 3-owned table or migration was recreated or altered.

## Delivered locally

Phase 4 adds RLS-protected messages, seller-only quotation drafts, immutable sent versions and line items, quote negotiation and version-bound acceptance, private lead stages/notes/follow-ups, consent-gated referral proposal and recipient response, moderated buyer reviews and seller responses, a buyer comparison page, and seller analytics from stored enquiry and quote records. English and Tamil screens are included. Selection is explicitly not recorded as payment or delivery; wins and losses are business-reported.

The reviewer identified and we corrected: direct Phase 4 insertion into Phase 3 `enquiries`; business-viewer access to private lead notes; absent conflict checks for review moderators; a missing review moderation/public journey; comparison overlooking offers after the fourth; referrals remaining actionable after a request closes; and seller responses appearing publicly before moderation. The public review RPC exposes moderated text and rating without buyer or author IDs. Direct review rows remain organization-scoped.

## Verification evidence

| Check | Result |
|---|---:|
| Clean application of migrations 1–16 on isolated Supabase | Passed |
| pgTAP database/RLS/security suite | 976 passed, 11 files |
| Unit suite | 289 passed, 20 files |
| Integration suite on fresh isolated DB | 117 passed, 14 files |
| Playwright mobile and desktop, six sequential shards | 264 passed (45 + 44 + 43 + 45 + 44 + 43) |
| Typecheck and production build | Passed |
| ESLint | Passed with four pre-existing unused-variable warnings in E2E files |

Browser coverage includes buyer request to seller invitation/enquiry, messages, quote draft/send, revision, latest-version selection, private lead note isolation, review and seller-response moderation, authentication/MFA, permissions, storage, upload scanning, accessibility and both languages. A dedicated integration race test holds two concurrent quote sends and confirms one immutable version wins while the stale sender receives `PT409`. The database tests also cover cross-org denial, seller viewer denial, referral consent order, review moderator conflicts, and public review redaction.

The unsharded Playwright runner lost its local Next server after approximately 65 cases. Six sequential shards each started a fresh app process and collectively executed the same 264 mobile and desktop tests successfully. One initial browser run lacked the isolated SMTP URL; rerunning with `SMTP_URL=smtp://127.0.0.1:55525` and `MAIL_FROM` resolved the reviewer-email failures. An E25 test had a hardcoded shared-stack API fallback; it now uses the shared test environment helper and passed in both viewports.

## Isolation and migration history

The local test stack is `.p4-local/supabase`, project ID `mitra-phase4-isolated`, ports 55520–55529. Only this stack was reset. The shared stack at 54421–54429, the hosted MITRA staging project, SEA AI Academy databases and production were not modified. No real documents were used. Local `supabase_migrations.schema_migrations` contains versions 1–16 in order, ending with `20260701000015_p4_schema` and `20260701000016_p4_workflows`.

## Remaining integration and deployment dependencies

1. **Referral handoff:** after buyer consent and recipient acceptance, Phase 4 records the referral but does not open a new enquiry. The frozen contract says Phase 4 must never insert into `enquiries`, and Phase 3 exposes no referral-opening RPC. Claude/Phase 3 needs to provide that interface or the product owner must explicitly defer this handoff. The recipient can currently be contacted through its published listing.
2. **Hosted migration history:** the staging project has a pre-existing migration-version mismatch noted in the Phase 3 report. Reconcile it by reviewed, non-destructive history work before any hosted CLI deployment. No hosted Phase 3 or Phase 4 migration was applied here.
3. **Authorization:** pushing, merging, hosted staging migration and deployment remain subject to the user's separate approval. Friday's staging target depends on the above reconciliation and approval.

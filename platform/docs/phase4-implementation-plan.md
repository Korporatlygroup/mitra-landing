# MITRA Phase 4 local integration and deployment plan

Status: implemented and under final local regression on `feature/phase4-preparation`. No push, remote merge, hosted migration or deployment has occurred.

## Baseline and contract

Phase 1 supplies organization identity, membership, permissions, audit, consent and MFA. Phase 2 supplies business profiles, verification, notifications and private storage. Phase 3 was fetched directly from `C:\Projects\MITRA\MITRA-Claude` and verified as commit `6ef9f01af9903960b07418d449eab0f79fa21c5b`, then merged locally in `ee73f24`. Its migrations are `20260701000012`–`14`.

The finalized shared contract is `docs/contracts/phase3-phase4.md`, version `p3p4-contract/1.0`, SHA-256 `64E054F30248E8CBD258F39871FC3489078097C9089FC66F70661E3E3E80741B` (Git blob `a90ac260eeaa65b1f81ee91a6540b4c3a2c68e5c`). Phase 3 owns `enquiries`, buyer requests and opening RPCs. Phase 4 consumes the immutable enquiry identity and drives later status/version transitions. The earlier proposed enquiry idempotency key is superseded by Phase 3's unique open pair. Phase 4 creates no Phase 3 tables and does not insert into `enquiries`.

## Implemented scope

Migrations `20260701000015_p4_schema.sql` and `20260701000016_p4_workflows.sql` add organization-scoped messages, seller-only quote drafts, immutable quotation versions and line items, private lead activities, consent-gated referrals, and moderated reviews. RPCs enforce permissions and expected versions, calculate MYR totals in SQL, notify participants and write audit events. A public review RPC returns only moderated content without buyer identity. Seller responses require a separate moderation decision before public display.

The buyer and seller enquiry workspace supports conversation, quote drafting/preview/sending, revision requests, version-bound selection, lead stages, private notes, follow-up dates, referral proposal/consent, reviews and seller responses. Buyers can compare displayed offers for currency, unit, quantity, scope and validity differences. The seller lead page calculates counts and response time from persisted data; reported wins/losses are explicitly self-reported.

## Security and review

An independent read-only reviewer examined the integrated Phase 3–4 code. Findings corrected locally: a Phase 4 referral insertion into Phase 3 `enquiries`, viewer access to private lead notes, moderator conflicts of interest, absent review moderation/public display, comparison ignoring a fifth offer, closed-request referral actions, and unmoderated public seller responses. Regression tests cover these permission and workflow cases. The remaining Phase 3 contract dependency is a referral-opening RPC after both buyer and recipient consent; Phase 4 records acceptance but cannot create that enquiry under the frozen contract.

## Local verification environment

All database work uses `.p4-local/supabase` with project ID `mitra-phase4-isolated`, ports 55520–55529. The unexplained shared stack on 54421–54429 and hosted staging were not reset or migrated. Only synthetic test accounts and content are used. Local migration history has versions 1–16 in order. Final test counts and any failures belong in the handoff report after the full run.

## Deployment gate

Before Friday's staging deployment, reconcile the existing hosted migration-history version mismatch without reset/reapply, obtain the Phase 3-owned referral-opening interface (or explicitly defer referral handoff), review the final diff and tests, then seek the user's authorization for hosted migrations and any push or merge. Production remains untouched.

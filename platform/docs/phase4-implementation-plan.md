# MITRA Phase 4 implementation plan

Status: in progress. Baseline `adc8c9663080c69a680c43099392c401655cc579` on `feature/phase4-preparation`. The proposed enquiry seam is in `docs/contracts/phase3-phase4-proposal-v1.md`; it is not frozen.

## Existing implementation audit

Phase 1 provides `organisations`, organization-scoped `memberships`, profiles, permissions, audit, consent, MFA and RLS. Phase 2 provides `business_profiles` keyed by organization, categories, private contact fields, representatives, verification claims/documents, notifications and private storage. Phase 4 reuses these identities and permissions. No Phase 3 enquiry/request tables are in this branch. Hosted Phase 1/2 migration history versions differ from file prefixes, blocking automated hosted `db push` until reviewed reconciliation.

## Integration seam

Claude owns `buyer_requests`, `request_seller_matches`, `enquiries` and authorized opening/read services. Codex consumes one stable `enquiries.id`, immutable buyer/seller organization IDs, optional request ID, status and version. Freeze schema, roles, opening moment, idempotency, transitions and API types in a versioned file acknowledged by both sides before dependent database work. No second conversation or Phase 3 SQL edits.

## Delivery order

1. Independent rules: exact decimal MYR quote calculation, guarded transitions and comparison that exposes currency, quantity, unit and scope differences. Implemented provisionally with unit tests.
2. After Phase 3 transfer, integrate locally. Add P4-only migrations for messages, quotations, immutable versions/items, lead activities, referrals and reviews. RLS and RPCs authorize active organization participants and use atomic expected-version transitions. Sent versions are immutable; seller notes are seller-only. Audit actions and queue notifications with honest delivery status.
3. Implement typed services and EN/TA screens: buyer enquiries/thread, quote detail/comparison, seller leads/thread, quote builder/preview, follow-ups, reviews/moderation and performance. Simple primary fields precede expandable advanced fields. Support 360px and desktop, keyboard and accessible feedback.
4. Test cross-org denial, forged IDs, role separation, suspended/removed actors, expired/withdrawn/superseded offers, duplicate and concurrent actions, review eligibility and referral consent. Run pgTAP, unit, integration, Playwright E2E, lint/typecheck/build and Astro regression. Independent reviewer examines integrated diff and security evidence.

## Product decisions

Confirm quote tax treatment, currencies beyond provisional MYR, unit vocabulary, expiry limits, legal wording of offer selection, review qualification, moderation ownership, referral consent and notification delivery policy. Selection implies neither payment nor delivery. Wins/losses are self-reported. Metrics derive from stored events only.

## Current evidence and blockers

Independent calculation, transition and comparison tests pass (10/10); typecheck passes. No Phase 3 branch/PR appeared in the remote ref check on 2026-11-10, and no transferred contract/migrations are in this checkout. No P4 migration, UI, integrated E2E, CI or independent review is complete. No hosted change, push, merge or deployment was made.

## Contract snapshot review (2026-11-10)

Read Claude's `platform/docs/contracts/phase3-phase4.md` version `p3p4-contract/1.0`, SHA-256 `2123C9F07F2192F1CCCA42B116C9A1FA96FF319ADAE4BE18D88053632606E1A1`, together with uncommitted migrations 000012–000014 in `MITRA-Claude`. This is an acknowledgement of the read-only working snapshot, not a Git commit SHA or final freeze. It confirms Claude owns the single `enquiries` table and P4 starts at migration 000015. My proposal's client idempotency key for enquiry opening is superseded by P3's one-open-pair unique index. P3 opens on listing contact or an invited seller's `interested`/`question` response; `declined` creates none. A business org may be the buyer. P4 owns enquiry status/version after opening. Hidden resources return 404. The contract and schema agree on the stable ID, immutable participants, status vocabulary and helper. No blocking incompatibility with the independent quote modules was found. Recheck SHA and migration diff after Claude commits its review fixes.

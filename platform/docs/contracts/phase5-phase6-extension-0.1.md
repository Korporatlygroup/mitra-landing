# Phase 5–6 sourcing interface extension

**Version:** `p5p6-phase6-extension/0.1-draft`

**Source inspected:** Phase 5 local commit `00a72011ffb7191d7a03f4502cf0e5569beaee96`, contract `p5p6-contract/0.2` (SHA-256 `549469D07062C83975EAD93063A697ADD33DDEA40CC885C3B45ED0CCCF34F844`).
**Status:** Proposal for Phase 5 owner confirmation. No Phase 6 migration or hosted change has been made.

## Stable Phase 5 inputs

| Phase 6 need | Phase 5 interface | Rule |
|---|---|---|
| Buyer identity | `organisations.id` of type `buyer` or `business`; `request:post` | Reuse memberships, consent and MFA checks. |
| Partner identity | `organisations.id` of type `partner`; approved `partner_profiles` | Partner owner needs MFA; suspended partners cannot receive new RFQs. |
| Supplier identity | `suppliers.id`, `partner_org_id`, approved status | Supplier is a partner-managed record, not an auth user. |
| Product and variation | `products.id`, `catalogue_items.product_id`, `catalogue_variants.id` | Only published products of approved suppliers and partners are eligible. |
| Price snapshot | `sourcing_request_items.snapshot`; live `catalogue_price_tiers` and `catalogue_items` | Quote comparisons retain original currency; product edits never rewrite a submitted RFQ. |
| Initial request | `sourcing_requests.id`, `reference`, `buyer_org_id`, optional `partner_org_id`/`supplier_id`, `sourcing_request_items` | Current submit RPC accepts 1–20 items from one supplier. |
| Notifications/audit | `private.notify_org`, `private.write_audit`, `audit_log` | Events must carry IDs, not confidential text or document paths. |
| Media | `verification-docs`, `catalogue-media`, scanned private routes | RFQ attachments need a distinct authorized access contract. |

## Decision requested from Phase 5 owner

**RFQ identity:** Phase 6 proposes a separate RFQ header linked optionally to one Phase 5 `sourcing_requests.id`. The Phase 5 request remains a single-supplier enquiry with its own status and immutable item snapshots; a new multi-product RFQ can contain catalogue products from several suppliers and custom lines. Linking instead of mutating the Phase 5 request avoids changing its existing one-supplier submit RPC, idempotency key and partner visibility. A buyer may explicitly promote a Phase 5 request into a draft RFQ, copying only item descriptions, quantities, unit, destination and the original snapshot reference; the buyer reviews and submits again. **No Phase 6 schema that depends on this choice will be added until Claude confirms it.**

**Quotation issuer:** The proposed issuer is the approved partner organization, with `supplier_id` as the represented supplier. The partner must prove it manages that supplier; the supplier has no Phase 5 auth account. A quotation is informational until the buyer selects a preferred version. Visibility is limited to its buyer and issuing partner; other partners and suppliers never see private terms. MITRA administrative access requires a recorded case or an existing scoped operational permission, not blanket table SELECT.

**Lifecycle boundaries:** An unpublished or repriced product keeps its RFQ submission snapshot but becomes ineligible for new matching. An issued quotation keeps its immutable historical prices and terms. Withdrawal blocks new selection; expiration is checked at selection time. Cancellation closes future actions but does not erase the commercial audit trail. User erasure nulls author IDs; organization erasure cascades owned RFQs and attachments through a coordinated storage cleanup process.

**State machines to confirm:** RFQ: `draft -> submitted -> under_review -> matching -> sent_to_partner -> awaiting_quotes -> quotes_received -> negotiating -> preferred_selected -> closed`, with `cancelled` from any active state. Each transition uses an expected version and server authorization. Quote: `draft -> submitted -> viewed -> clarification_requested -> revised -> preferred|rejected|withdrawn|expired`; every submitted revision creates a new immutable version. Sample: `requested -> under_review -> approved|rejected -> preparing -> dispatched -> received -> closed`, with explicit cancellation rules. Labels for buyers are simpler than internal states.

**Migration ownership:** `000106` is the separate Phase 4 erasure fix; `000107`–`000109` are integration reserves; Phase 5 owns `000110`–`000149`; Phase 6 starts at `000150` after the final Phase 5 contract and branch are available. No number is reserved here beyond that range.

## Open contract points

1. Confirm linked RFQ versus upgrading the Phase 5 request, and the exact promotion RPC/response.
2. Confirm whether one RFQ may invite multiple approved partners and how buyer consent limits exposure.
3. Define partner assignment authority and visibility for custom products with no listed supplier.
4. Confirm product price and variant snapshot fields for multi-supplier lines.
5. Specify certificate evidence visibility: Phase 5 `review_checks` is a review scope, not a product certification guarantee.
6. Define attachment bucket/path, scanning limit and cleanup owner.
7. Confirm notification kinds, audit entity IDs, and erasure behavior after Phase 4 migration 106.

Until these are settled, Phase 6 work is limited to pure validation, deterministic matching rules, UI design and tests that do not write Phase 5 tables.

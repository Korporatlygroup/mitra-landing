# Phase 3 / Phase 4 enquiry seam — proposal v1

**Status: proposed, awaiting Claude's acknowledgement and owner/integrator approval.** This file records Codex's requested interface. It is not a frozen migration contract and must not be applied to staging.

## Ownership

Claude (P3) owns `buyer_requests`, `request_seller_matches`, `enquiries`, their migrations, invitation response and idempotent enquiry opening. Codex (P4) owns messages, quotations/versions/line items, seller activities, referrals and reviews in subsequent separate migrations. Neither agent creates a second conversation identity. A designated integrator controls migration sequencing and shared TypeScript types.

## Proposed enquiry identity

`enquiries.id uuid` is the stable identity used by every P4 row and API. `buyer_org_id` and `seller_org_id` are immutable references to existing `organisations.id`; they must differ. `buyer_request_id` is optional and references one P3 request. `origin` distinguishes approved-listing contact from request invitation. `created_by` references `auth.users.id`. `status` and integer `version` support guarded transitions. Closing and organization suspension prohibit new quote/message writes unless a specific reopening rule is approved.

Opening through an approved listing requires an active, published seller and authorized buyer context. Opening through a private request requires a valid invitation/response to that seller. Retry with the same idempotency key returns the same enquiry; an unrelated seller cannot create or discover one by guessing IDs. P3 should publish an authorized participant read service returning enquiry ID, org IDs, request summary fields approved for that seller, status and version. It must not expose buyer private contact or Phase 2 private business fields by default.

## Decisions requested from Claude and integrator

1. Exact opening moment: buyer contact, invite acceptance, or first seller response; duplicate key scope and retention.
2. Exact enum/status vocabulary and whether status tracks next respondent or thread lifecycle; permitted transitions.
3. Whether a business organization may act as buyer using its existing organization context, and which memberships may open/respond.
4. Shape of the authorized request summary, status event and TypeScript service signatures, including hidden-resource error behavior.
5. Migration ownership and order, with Phase 3 migration IDs preceding Phase 4 IDs; local test fixture contract.

Until these are acknowledged in a versioned shared file, Codex implementation remains limited to P4 domain logic without P3 database references.

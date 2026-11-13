# INOK Phase 6 implementation record

Phase 5 authority: `p5p6-contract/1.0` at `c9c094b`, including subsequent review migration 116 at `a370105`; integrated locally without changing migrations 110–116. Phase 6 extension: `p5p6-phase6-extension/1.0`.

## Data and permission boundary

- Migration 150 owns multi-product sourcing requests, explicit partner invitations, private threads, immutable quotation revisions and preferred selection.
- Migration 151 owns counters, samples, templates, repeat requests, timelines, matching and operational reads.
- Migration 152 owns scanned thread attachments and a retryable private-object cleanup queue.
- Migration 153 owns rate-limited operational reminders for accepted partners without an offer.
- Phase 5 single-supplier requests remain separate. A Phase 6 request may link one with `source_request_id` but does not modify its tables or RPCs.
- Buyers choose up to five approved partners. A partner accepts before messaging, quoting, countering or handling samples. One partner cannot read another partner's messages, quotations, counters, samples, event details or documents.
- Every persisted quote revision stores exact line and total calculations in SQL. Counters bind to the current revision; a later revision or quote status change supersedes an open counter. Final selection uses a locked RFQ version and rechecks partner approval.
- Erasing a user redacts author FKs. Erasing a partner cascades its threads and offers; an affected preferred request safely loses its preferred reference. Partner-scoped timeline events never become global after erasure.

## Storage

Attachments reuse the private `verification-docs` bucket. The route validates file type, content and size, strips image metadata, requires a clean ClamAV result, then uploads a random-path object and registers it through a service-only RPC. Download requires a signed-in buyer or the accepted receiving partner and is audited. Deleted records queue object paths; the existing authenticated rescan job retries deletion. Scanner failures fail closed, so unscanned sourcing files are not stored.

The Phase 5 and earlier private Storage paths retain their existing cleanup limitations. Staging needs the bucket, scanner and scheduled job before Phase 6 attachments can be enabled.

## Deployment order

Apply reviewed migrations 1–14, 100–107, 110–116, then 150–153 in order. No hosted staging migration has been applied from this branch. Verify the hosted migration history and bucket settings before applying any new migration. GitHub push and deployment require separate authorization.

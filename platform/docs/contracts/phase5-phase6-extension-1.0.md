# INOK Phase 5–6 sourcing interface extension

**Version:** `p5p6-phase6-extension/1.0`
**Phase 5 authority:** `p5p6-contract/1.0`, commit `c9c094b` on `feature/phase5-supplier-catalogue`.
**Status:** Phase 6 implementation contract for local development. No hosted migration has been applied.

## Boundary

Phase 5 `sourcing_requests` remains a single-supplier price request. Phase 6 `sourcing_rfqs` is a separate buyer-owned, multi-product request with optional `source_request_id` to a Phase 5 request. The new request takes its own immutable product and price snapshots. Phase 5 tables and RPC signatures are unchanged.

Phase 6 migrations begin at `000150`; `000106` is the separate participant-erasure fix and `000115` is the final Phase 5 review migration. The local migration order is 1–14, 100–106, 110–115, 150–153. Versions 107–109 and 116–149 remain reserved.

## Agreed decisions

| Decision | Phase 6 rule |
|---|---|
| Any product | Buyer may submit 1–20 catalogue or custom lines. Custom lines have a name, quantity, unit and optional category/specification. |
| Multiple recipients | Buyer explicitly checks 1–5 approved, active sourcing partner organizations. Only checked partners receive notifications and request access. |
| Quote issuer | The approved partner organization issues a quote, optionally naming one of its approved managed suppliers. Several suppliers under one partner may have separate quotes. |
| Partner isolation | Other recipients cannot read a partner's messages, offers, counteroffers or samples. Buyer sees all of its own threads. Declining ends partner access. |
| Pricing | The database recalculates each line, rounds to two decimals, validates charges and discount, and stores the currency with every immutable quote revision. No currency conversion. |
| Matching | Suggestions use published catalogue products of approved suppliers and active, approved partners. Unit, category and MOQ must match. Export capability, certificates and live stock remain unknown unless evidence is added in a later reviewed contract. |
| Repeats | A repeat returns editable product snapshots; the buyer must review recipients and submit a new request. Templates store buyer-owned snapshots. |
| Audit and deletion | Event metadata records IDs and action names, never document paths or private message text. User FK redaction and organization cascades are tested. |
| Attachments | Each accepted buyer–partner thread can carry scanned PDF/JPEG/PNG files up to 10 MiB. The existing private `verification-docs` bucket stores random-path objects; only checked server routes download them. Deleted metadata queues retryable object cleanup. |
| Reminders | The authenticated maintenance job creates in-app reminders only for accepted, active partners with no offer after two days; it waits seven days between repeats. |

## Security and limits

All new public tables have RLS and SELECT policies; no direct authenticated write grants. Mutations use checked RPCs with pinned `search_path`, organization permission checks, consent, audit, and optimistic versions for quote revisions and final selection. Partner approval is checked again at write time.

Phase 6 object cleanup runs in the existing authenticated `/api/v1/jobs/rescan` job. Staging deployment must confirm that the private bucket exists, ClamAV is available, and this job runs with `CRON_SECRET`. The Phase 5 and earlier storage paths retain their separately documented cleanup limitation; Phase 6's queue only covers `sourcing/` objects.

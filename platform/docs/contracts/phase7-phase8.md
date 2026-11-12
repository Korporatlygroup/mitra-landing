# Phase 7 to Phase 8 contract: `gov-events/1.0`

Phase 8 (bulletins, announcements, newsletters) consumes verified programme events. It does not need to re-implement fetching, review or notification delivery.

## Interface
Table `public.gov_programme_events` (append-only, immutable by trigger; select for staff with `gov:view`; service role reads it for a Phase 8 sender).

| Column | Meaning |
|---|---|
| `id` | monotonically increasing; use it as the cursor (`where id > :last`) |
| `contract` | always `gov-events/1.0`; a breaking change creates `gov-events/2.0` rows, never rewrites old ones |
| `kind` | `programme_discovered`, `programme_verified`, `programme_opened`, `programme_updated`, `deadline_changed`, `programme_closed` |
| `programme_id` | `gov_programmes.id` |
| `version_no` | the published version this event belongs to (null for an archive) |
| `at` | when the event was recorded |
| `payload` | `name`, `agency`, `application_status`, `closes_on`, `flags` only. No private business data, ever |

Today the database emits `programme_verified`, `programme_updated`, `deadline_changed`, `programme_opened` and `programme_closed` (an approved change, or an archive). `programme_discovered` is reserved: a candidate that is not yet reviewed is not announced.

## Rules for consumers
- Events exist only after a human approval. A consumer must not claim anything the programme version does not say.
- Public text must carry the independence notice (INOK is not an agency) and link to the official source (`gov_get_programme(slug)` returns the verified version and provenance).
- Idempotency: key your own sends on `(id)`. The Phase 7 notification outbox already de-duplicates per user with `event_key`; do not send a second copy of a Phase 7 notification.
- Do not read `gov_saved`, `gov_assistance_profiles` or `gov_outbox` for audience building without a new consent purpose.

# Phase 7 plan: Government Assistance Navigator (2026-11-12)

Branch `feature/phase7-assistance-navigator`, worktree `C:\Projects\MITRA\MITRA-Phase7`, baseline `43c9fa1` (`platform/phase2-seller-verification`, Phases 1-5 merged). Nothing pushed, nothing applied to hosted staging.

## 1. Baseline audit (what exists, what does not)
- Organisations/memberships: `organisations(type business|buyer|partner|mitra)`, `memberships(role)`, `role_permissions`, `private.has_permission`, MFA (aal2) enforced for admin roles and partner owners (`private.requires_mfa`). Reuse as is.
- Business data: `business_profiles`/`business_listings` (category, state, district, services). No employee count, registration status, operating history or turnover: matching must ask for these (voluntary, stored per organisation).
- Notifications: `public.notifications(user_id, kind, entity_type, entity_id, read_at)` is in-app only, no outbox, no channel, no preferences. Phase 7 adds its own outbox and preferences; in-app rows reuse this table.
- Audit: `audit_log` append-only, reuse via existing helpers. Mailer: `src/server/mailer.ts` (nodemailer, SMTP_URL/MAIL_FROM mandatory in production).
- Scheduling: there is NO pg_cron, pg_net or Edge Function in the repo. The spec's "Supabase Cron + Edge Functions" needs a hosting decision (see section 5). Design keeps the worker logic in a runtime-neutral TypeScript module (`src/server/gov/`) invoked by a protected HTTP route, so cron can come from Supabase Cron, GitHub Actions or the host.
- Migration registry: Phase 6 uses `000150-000152` so far. Phase 7 range proposed: `000200-000249`. `000153-000199` stays reserved for Phase 6. Confirm with the Phase 6 owner before the first migration.

## 2. Verified external facts (fetched 2026-11-12)
- Open Data API: `GET https://api.data.gov.my/data-catalogue?id=<dataset>`; no token documented; 4 requests/minute, 429 on excess; CC BY 4.0. There is no list endpoint; dataset ids are found on data.gov.my. The only id seen in the docs is `fuelprice`. No grant or financing programme dataset was found; the catalogue page itself was not yet read. Result so far: Open Data is NOT a programme feed; record that limitation.
- Portal Manfaat (MOF): official aid directory, about 102 programme pages at `/bantuan/{AGENCY-CODE}-{NNN}`, sitemap at `/sitemap.xml`, robots allows all HTML and disallows `/api/`. Listing content is client-rendered. Its disclaimer (`/penafian`) prohibits reproduction, redistribution and retrieval of its content for other sites without permission. This is the main source risk (decision A).
- TEKUN robots: only `/wp-admin/` and `/imunify-bot-check` disallowed; WordPress sitemap exists. SME Corp robots returned 403 to our fetch, so its status is unknown.
- No source has a documented programme API. Type A is therefore not usable yet; Types C and D carry Phase 7.

## 3. Architecture
Tables (all RLS, default-deny, writes through SECURITY DEFINER RPCs, explicit ON DELETE): `gov_agencies`, `gov_sources` (allowlist, schedule, rate policy, health, enabled flags), `gov_fetch_jobs` (lease, attempts, idempotency key), `gov_fetch_results` (hash, status, evidence reference), `gov_programmes` (stable id, verification_status, application_status separate), `gov_programme_versions` (immutable), `gov_programme_rules` (published conditions), `gov_change_proposals` (+ review decisions with reasons), `gov_business_assistance_profile` (per organisation, voluntary fields), `gov_saved` and `gov_tracking` (user-reported statuses), `gov_notification_prefs`, `gov_outbox` (unique event key), `gov_event_feed` (versioned Phase 8 events), `gov_alerts`. Roles: source admin, reviewer, publisher, viewer, as new permissions on existing admin roles, MFA required for publish and source change, two-person rule for source URL changes.

Workers: claim jobs with `FOR UPDATE SKIP LOCKED` and a lease; backoff with jitter; per-host token bucket; honour 429/Retry-After; response limits, HTTPS only, exact host allowlist, redirect re-validation, DNS-resolved private-IP refusal (SSRF); no user-supplied fetch URLs. Failure never alters a published version. Material change creates a proposal, never auto-publishes.

Matching: deterministic rules, four result labels from the spec, no ethnicity or nationality inference, no approval wording. Languages EN/ta/ms, 360px and 1280px, axe.

## 4. Build sequence and gates
Stage 2 database and pgTAP; Stage 3 one source adapter end to end with offline fixtures plus a separate live smoke test that publishes nothing; Stage 4 review and publication; Stage 5 matching; Stage 6 UI; Stage 7 notifications; Stage 9 integration, concurrency and recovery tests, regression on Phases 1-5, independent review. Status labels in the final report stay separate: implemented, verified locally, verified live, ready for staging, deployed.

## 5. Decisions needed from the owner
A. First real source: Manfaat's terms restrict bulk retrieval. Options: obtain written permission from MOF/GovTech; start with TEKUN (permissive robots, public pages) and register Manfaat as admin-verified (Type D) links only; or both.
B. Scheduler: Supabase Cron + Edge Functions (needs the hosted project, still undecided) or an HTTP worker route driven by an external cron.
C. Migration range `000200-000249` agreed with the Phase 6 owner.
D. Which business-profile fields users may be asked for (employees, registration type, years operating) and retention period.

# INOK Phase 6 local verification

**Branch:** `codex/phase6-international-sourcing`
**Phase 5 baseline:** `c9c094b` (`p5p6-contract/1.0`)
**Phase 6 extension:** `p5p6-phase6-extension/1.0`
**Environment:** isolated local Supabase `inok-phase6-finalcheck` on ports 58730–58739; synthetic accounts and documents only. No hosted migration, push, merge or deployment.

## Implementation

Migrations 150–153 follow migration 106 (Phase 4 erasure) and 110–115 (Phase 5 catalogue). They add buyer-owned multi-product and custom-product price requests, explicit partner invitations, private messages, immutable supplier quotations and revisions, counteroffers, preferred selection, samples, repeats/templates, matching, timeline, reporting, notifications, scanned private documents, and deduplicated operational reminders. Phase 5 tables and RPCs are unchanged.

The UI provides catalogue-to-request and custom-product entry points, buyer and partner request dashboards, offer comparison, messaging, negotiation, sample status, document sharing and an admin overview in English, Tamil and Malay. Matching uses approved partners/suppliers and published available catalogue items; category, unit and MOQ must fit. Export eligibility, certificates and real-time stock remain unknown.

## Security and erasure

All Phase 6 public tables use RLS with no direct authenticated writes. Partner reads and actions are scoped to an accepted invitation, and confidential threads are isolated between partners. Buyer selection and quote revisions use locked versions; counters are bound to their quote revision. Partner erasure clears affected preferred offers and prevents another partner from reading scoped events. User erasure redacts author references.

Documents use the existing private `verification-docs` bucket. File type and content validation, image metadata removal and a clean ClamAV result are required before Storage upload. The route writes a durable cleanup entry before upload; a successful metadata transaction clears it. Deleted or abandoned objects are retried by the authenticated rescan job after a ten-minute grace period. The download route rechecks membership/organization status and audits access; direct object access is not granted.

## Verification evidence

| Check | Result |
|---|---|
| Fresh local migrations through 153 | Passed on `inok-phase6-finalcheck` |
| pgTAP database/RLS tests | 19 files, 2,063 assertions passed |
| Unit tests | 31 files, 806 passed |
| Integration tests | 16 files passed, 1 skipped; 129 passed, 17 skipped on final stack with one worker |
| Phase 6 browser journey | 6 passed: mobile/desktop × en/ta/ms; persisted requests, private documents, messages, samples, counters, revisions, selection, cleanup, accessibility and horizontal scroll |
| Full platform browser suite | 363/364 passed on the first complete run; the one Playwright worker exited with Windows code `3221226505`, and its two authorization cases passed in an isolated rerun. The final Phase 6 journey passed 6/6 on the fresh stack and latest build. |
| Typecheck, lint, platform and Astro builds | Platform build and typecheck, Astro check and build passed; lint has no errors and six pre-existing test warnings |
| Independent security review | No remaining critical or high findings after fixes |

The complete browser suite used the isolated `inok-phase6-locked` stack through migration 152. The first attempt lost its Next server during a high-volume upload test under several simultaneous local stacks. The upload spec then passed separately, 14/14, after old isolated stacks were stopped with data backups. The second run passed 363 cases; the sole failure was a Windows Playwright worker exit during an authorization test. That test and its paired viewer case passed alone, 2/2. The newer migration 153 and latest template UI were then tested against the fresh `inok-phase6-finalcheck` stack: pgTAP 2,063/2,063 and Phase 6 browser journeys 6/6. The full 364-case browser suite was not rerun after the template fix.

A parallel integration run also saw worker exit `3221226505` in a different test file. A standalone run with one worker passed 16 files and 129 tests; 17 tests were skipped by suite conditions. These worker exits did not produce application assertions and were not reproducible in isolated reruns, but remain a Windows test-runner stability issue.

## Deployment dependencies

1. Confirm the hosted Phase 1–5 migration history and apply reviewed 150–153 in order only after separate authorization. This branch has not modified hosted staging.
2. Confirm `verification-docs` is private with 10 MiB and PDF/JPEG/PNG limits, ClamAV connectivity, and a scheduled call to `/api/v1/jobs/rescan` with `CRON_SECRET`.
3. Test real staging Auth, Storage and browser flows with synthetic accounts after deployment approval.
4. Phase 5 and earlier private Storage paths still have their separately documented orphan-cleanup limitation. The Phase 6 queue handles only `sourcing/` paths.
5. The existing Phase 1–5 translation copy still refers to MITRA in places; the shared app name and Phase 6 flows say INOK. A separate platform-wide branding review is required before public launch.

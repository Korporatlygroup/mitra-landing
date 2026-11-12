# Phase 7 report: Government Assistance Navigator (2026-11-12)

Branch `feature/phase7-assistance-navigator` (worktree `C:\Projects\MITRA\MITRA-Phase7`). Baseline `43c9fa1` (`platform/phase2-seller-verification`, Phases 1-5 merged). Nothing is pushed, merged or deployed; hosted staging and its database are untouched. Plan: `phase7-plan.md`. Phase 8 contract: `contracts/phase7-phase8.md`.

## Status of each claim (these are different things)
| Status | State |
|---|---|
| Implemented | Yes, for the TEKUN source and the whole user and admin journey (below) |
| Verified locally | Yes: isolated stack, synthetic data plus saved copies of real TEKUN pages |
| Verified against live official sources | Partly: one opt-in smoke test read TEKUN robots, the SPUMI scheme page and its conditions page with the real fetcher and extractor, and extracted them. Nothing was published. No scheduled live run has happened |
| Ready for staging | No (blockers below) |
| Deployed to staging / ready for production | No |

## Migrations
`000200_p7_gov_core` and `000201_p7_gov_user`. Range `000200-000249` is proposed; `000153-000199` stays with Phase 6 (it uses `000150-000152` so far). Confirm with the Phase 6 owner before merging. No existing migration was changed. Phase 1/5 inventory tests (`01`, `02`) were updated for the new tables, RPCs and permissions.

## Database design (all RLS, default-deny, writes through SECURITY DEFINER RPCs with `search_path = ''`)
Registry and monitoring: `gov_agencies`, `gov_sources` (exact hosts, https URLs, schedule, rate, freshness, health), `gov_source_changes` (two-person rule), `gov_fetch_jobs` (lease, attempts, idempotency key), `gov_fetch_results` (hash, bounded evidence text), `gov_settings` (three independent switches, all off).
Programmes: `gov_programmes` (verification status and application status are separate), `gov_programme_versions` (immutable), `gov_change_proposals` (diff, flags, reasoned decision), `gov_events` (append-only operations log).
User side: `gov_assistance_profiles`, `gov_saved` (saved plus user-reported tracking), `gov_notification_prefs`, `gov_outbox` (unique event key), `gov_programme_events` (Phase 8 feed).
Permissions added: `gov:source_admin`, `gov:review`, `gov:publish`, `gov:view` (admin roles, MFA enforced by the existing rule) and `assist:manage` (owner, manager, staff).

## Sources and APIs
| Source | Result |
|---|---|
| TEKUN Nasional (`www.tekun.gov.my`) | Integrated. Server-rendered WordPress pages; robots allow them; sitemap has per-page lastmod. Adapter `tekun` reads a scheme page and its "Syarat-syarat" page |
| Malaysia Open Data (`api.data.gov.my`) | Documented as `GET /data-catalogue?id=`, 4 requests/minute, CC BY 4.0, no token documented. No programme-level grant or financing dataset was found (only the fuel-price dataset id appears in the docs; the full catalogue was not read). Not integrated |
| Portal Manfaat (MOF) | Official aid directory. Robots allow HTML, but its disclaimer forbids reproduction, redistribution and bulk retrieval without permission, and listings are rendered in the browser. Not integrated. Needs written permission from MOF/GovTech, or admin-entered links only |
| SME Corp | robots.txt returned 403 to our fetch: treated as unknown, not integrated |
| MITRA, BNM | Not examined |
No source has a documented programme API, so Type A (API) is unused. Type D (administrator-verified) is supported by the same review pipeline but has no entry screen yet.

## Monitoring architecture
`POST /api/v1/jobs/gov` (404 unless `GOV_WORKER_SECRET` is set; constant-time bearer check). One bounded call: enqueue due sources, claim up to 3 jobs with a lease, process them (robots, guarded fetch, extraction, submit candidate), then run notifications. Overlapping calls are safe. Any scheduler can drive it (Supabase Cron with pg_net, GitHub Actions or the host); no scheduler is configured and none is enabled. The database refuses all work while `monitoring_enabled` is off.
Retries: exponential backoff with jitter (60 s base, 1 h cap), `Retry-After` honoured, 5 attempts then dead-letter, expired leases recovered, source health becomes degraded after 3 failures and failing after 6.
Fetcher: https only, exact allowlisted hosts, port 443, no credentials, manual redirects (3) re-validated per hop, address checked at connect time (private, loopback, link-local, CGNAT, mapped and NAT64 ranges refused), 15 s timeout, 1.5 MB cap, gzip bomb guard, text/html/xml only, UTF-8 only.

## Verification and publication rules
- A new programme, any changed field, a new application link, an incomplete extraction or a possible closure becomes a proposal; nothing is published automatically.
- An unchanged recheck updates only "last checked" and never "last verified".
- A source failure, a layout change or a missing page never changes a published programme (a vanished programme becomes "unconfirmed" and stays published with its evidence).
- Approval needs `gov:publish`, MFA, the publishing switch on and a written reason; a stale proposal and an application link outside the source's allowed hosts are refused; the second administrator on one change is refused.
- "Open" or "upcoming" is shown only while the last check is inside the source's freshness window; otherwise "Not confirmed".

## Matching
Deterministic, in `src/lib/gov-matching.ts`. Rules are the agency's own published conditions kept as quoted rules (the extractor never invents one; unrecognised lines become "only the agency can assess" notes). Labels: Potential match, More information needed, A published requirement is not met, Programme not confirmed. Unknown, "prefer not to say" and missing answers are never treated as satisfied. Ranking: label, declared need, open before others, nearest published deadline. Community and citizenship are used only when the programme published such a rule (SPUMI does) and only from voluntary declarations; they are never a ranking input. Sensitive answers are sent by POST, never put in a URL.

## Screens (English, Tamil, Bahasa Melayu; 360px and 1280px; axe)
Business owner: `/business-help` (five large choices), `/business-help/find` (need, a little about the business, matched results), `/business-help/[slug]` (INOK summary kept apart from the agency's words in the original language, requirements, documents, terms, how to apply, official link), `/business-help/saved` (saved programmes with self-reported tracking, clearly not agency updates), `/business-help/settings`. Admin: `/admin/business-help` (switches, source health, review queue, programmes with pause/resume) and `/admin/business-help/review/[id]` (extracted data, before/after, evidence text, reason-required decisions).
Notifications: in-app always (existing notifications list); email only after the mail provider accepts; neutral subject; pause, per-category, daily/weekly cap and unsubscribe honoured; duplicate events never create a second message.

## Test evidence (all LOCAL, isolated stack; never staging)
| Layer | Result |
|---|---|
| Fresh database, 30 migrations | applies cleanly |
| pgTAP (clean database) | 22 files, 2,186 assertions pass (111 new: `21` 46, `22` 65) |
| Unit | 860 pass (new: fetcher/SSRF/robots, TEKUN extractor on real saved pages, matching, banned wording) |
| Integration | 146 pass, 17 skipped (the existing HTTP file that needs a running app); new: worker 13, notifications 3, review races 4 |
| Browser, Phase 7 spec e80 | 12 pass (6 tests at 360px and 1280px) incl. axe in en/ta/ms |
| Full browser regression, Phases 1-5 | see "Final results" below |
| Typecheck, lint, production build, Astro build | pass; 0 lint errors |
| `npm audit` (production) | 0 vulnerabilities |
| Secret scan of tracked files | nothing found |
| Live smoke (opt-in, `GOV_LIVE=1 npx vitest run --project live`) | passes against TEKUN; publishes nothing |
Known test-environment notes: Windows worker crashes (exit 3221226505) occur occasionally and are retried once; pgTAP assumes a freshly reset database (run `db reset` after browser tests).

## Not verified / not done
- No real scheduled run, no real email provider, no real concurrency test across processes beyond the database-level races above.
- Only TEKUN and only schemes of the same page layout; other TEKUN schemes were not run through the extractor. Programme descriptions are Malay; Tamil and English summaries are not machine-translated on purpose (legal meaning).
- Application status for TEKUN schemes is "unknown" by design: the site menu says online applications are open, the SPUMI conditions page says branch only. A reviewer must decide.
- Type D (manual) programme entry screen, source registration screen and a stale-programme audit job are not built (sources are registered through the RPC `gov_register_source`).
- Reminders and deadline notices are queued by the same run; there is no separate schedule configuration table beyond per-source refresh interval.
- Tamil and Bahasa Melayu text is machine-assisted and needs native review. No human security review.
- Programme versions are retained for audit; erasure of an organisation removes its profile, saved items and outbox rows (ON DELETE CASCADE) but programme data is not personal.

## Staging deployment (needs owner approval; none done)
1. Confirm migration numbers with Phase 6; reconcile hosted history first (`staging-migration-reconciliation.md`).
2. Deploy database and app with all three switches off, `GOV_WORKER_SECRET` unset.
3. Verify RLS and admin access (MFA) on the hosted project; register TEKUN with `gov_register_source` (disabled); a second administrator approves the enable change.
4. Set `GOV_WORKER_SECRET`, `GOV_WORKER_CONTACT`, `SITE_URL`, SMTP; turn `monitoring_enabled` on; run the route once by hand; review candidates; publish one real programme (publishing switch on); check it appears for a test business user.
5. Only then schedule the route (every 5-15 minutes), enable notifications, and widen sources.
Rollback: switch the three settings off (instant, no redeploy); archive a programme with a reason; the worker route can be disabled by unsetting its secret.

## External services and cost
Supabase (existing), an SMTP provider (existing requirement), a scheduler. No paid AI and no new infrastructure.

## Phase 8
`contracts/phase7-phase8.md`.

## Independent review (one read-only model review, no human) and what was done
No critical issue. Findings and outcome (fixes are in migrations 200/201 and the app; verified as listed under "Final results"):
- High 1 (worker sleeps could outlast the 60 s route limit and burn attempts): in-job pause is now at most 3 s (the per-source rate is enforced between jobs by the database). Fixed.
- Medium 2 (one 404 downgraded a published record and reset its freshness clock): three consecutive misses are needed, `last_checked_at` is not advanced by a miss, and the source returning with the same content restores "verified". Fixed.
- Medium 3 and 4 (decisions on "needs more checks" proposals always failed; `p_expected_status` was free text): the review page sends the real status, the database accepts only `pending` or `needs_info`. Fixed.
- Medium 5 (a programme with nothing checkable was labelled "Potential match"): now "Programme not confirmed". Fixed.
- Medium 6 (host parsing could be fooled by `host:x@evil` and the information page was not host-checked): strict parser, both links checked, flagged programmes cannot be approved. Fixed.
- Medium 7 (no-mailer runs burned email attempts; a crash after the provider accepted left a row queued forever): no-mailer no longer counts an attempt; rows queued for 15 minutes are offered again (at most 5 attempts). A crash right after acceptance can still cause one repeat email (at-least-once). Fixed, limit stated.
- Medium 8 (impossible dates or lone surrogates raised raw errors and lost the candidate): safe date check and text sanitising. Fixed.
- Low: total request deadline (30 s), IPv4-compatible/6to4/site-local addresses refused, older pending proposals superseded when the source returns to the published content, editing a note no longer clears the "information changed" banner (explicit checkbox), closed/removed wording, first-save race (advisory lock), reason length and audit on source registration, the card shows "Apply officially" only for an online channel, non-staff get 404 on the admin page. Fixed.
- Accepted/not done: daily/weekly frequency defers but does not build a digest; the per-source rate counts jobs, not the up to three requests inside one job (about 3 requests within 6 s per job); the email has no one-click unsubscribe link (settings page only) and a fixed `/en/` link; the quadratic script-tag regex only matters for a hostile source; review notes and extraction status are hashed but not diffed.

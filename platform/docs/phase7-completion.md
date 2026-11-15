# Phase 7 completion (2026-11-15), local verification only

Branch `feature/inok-redesign`. Nothing pushed, merged or deployed. Hosted staging and its database were not touched. Supersedes the "not done" list in `phase7-report.md`. Official source research: `phase7-official-sources.md`.

## Feature checklist
| Feature | State |
|---|---|
| Source registry, job queue, lease, backoff, SSRF/robots guards | Complete and tested locally (existed; re-verified) |
| Conditional requests (ETag / Last-Modified, 304) | Complete and tested locally (unit + integration); real server support unverified |
| Page-monitor adapter (no API/feed sources): change detection, admin review queue | Complete and tested locally against fixtures; live sources not run |
| TEKUN extractor | Complete (existed); unconditional by design (two-page dependency) |
| Programme catalogue fields (category, audience, sectors, states, documents) | Complete and tested |
| Display status model (open, upcoming, dates not confirmed, under review, stale, closed, archived) | Complete and tested (unit) |
| Manual (administrator) programme entry/edit, second-editor rule, before/after, versions kept | Complete and tested (pgTAP + browser) |
| Admin: source registration, schedule/enable proposals approved by a second person, history, extraction errors, attention panel, check-now | Complete, browser-tested in part (registration/schedule forms exercised only by build + typecheck) |
| Explainable matching (per requirement: outcome, information used, reason, official source; organisation-only excluded) | Complete and tested |
| Dashboard (recommended, new, closing soon, saved, my applications, training) | Complete and tested |
| Saved programmes, 7 self-reported stages | Complete and tested |
| Reminders at 14 and 3 days (per person), confirmed dates only, once; recheck notice | Complete and tested |
| In-app notifications; email only after provider acceptance; opt-out | Complete (existing) and tested; no real mail provider run |
| "Required information missing" notification | Partial: covered by the personal reminder date and rule-change notice, no dedicated event |
| English / Bahasa Melayu / Tamil | Complete; ms/ta machine-assisted, need native review |
| AI-assisted extraction | Not implemented on purpose (deterministic extraction suffices) |
| Scheduler | Blocked: route exists, no scheduler configured (needs hosting decision) |
| Hosted execution | Not verified |
| "Genuine programme records verified against official sources" | Partial: TEKUN SPUMI from saved real pages; others need a human reviewer on the live pages |

## Architecture
Worker route `POST /api/v1/jobs/gov` (bearer `GOV_WORKER_SECRET`, 404 when unset): enqueue due sources, claim up to 3 jobs, robots check, guarded fetch (conditional for `page_monitor`), adapter (`tekun` extracts a candidate; `page_monitor` stores normalised text and compares hashes), then reminders and notifications. Failure never changes published data. Changes become proposals or page-change items; people publish. Migration `20260701000220_p7_navigator_completion.sql` (no existing migration modified).

## Environment
`GOV_WORKER_SECRET`, `GOV_WORKER_CONTACT` (user agent contact), `SITE_URL`, SMTP settings (existing). Switches `monitoring_enabled`, `publishing_enabled`, `notifications_enabled` start off. Scheduler: any caller of the route every 5 to 15 minutes (Supabase Cron + pg_net, GitHub Actions or host cron).

## Staging prerequisites
Reconcile migration history with Phase 6 (range 000150-000199 reserved); confirm migration numbers; register sources through the admin console (disabled), a second administrator approves enabling; set secrets; run the route by hand once; review; only then schedule.

## Test evidence (local stack, Windows, Node 24)
| Run | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | clean |
| Lint | `npx eslint .` | 0 errors |
| Build | `npx next build` | ok |
| Unit | `npx vitest run --project unit` | 35 files, 914 passed |
| Database | `npx supabase test db` | 26 files, 2,321 assertions passed |
| Integration | `npx vitest run --project integration` | 18 files, 153 passed, 17 skipped (an HTTP file needing a running app); clean in 2 of 3 forks runs and 1 threads run |
| Browser, full desktop | `npx playwright test --project=desktop` | 205 tests: 202 passed, 1 skipped, 2 failed (see below) |
| Browser, rerun of the 2 failed specs alone | e8-server-authz + e80-business-help | 13 passed |

The 2 full-run failures were `worker process exited unexpectedly (code=3221226505)` (Windows 0xC0000409) in e8 and e80, not assertion failures; the rerun is a separate run, not merged into the 205. The same code also hits vitest forks at worker start on random files (3 occurrences across runs, different file each time). Likely a Node 24 / Windows process crash, not app code, but the root cause is not established.

New tests: pgTAP 25 and 26; unit `gov-status`, `gov-fetch-conditional`, `gov-page-monitor`, extended `gov-matching`; integration page-monitor cases in `p7-worker`; browser `e81-p7-journeys` (A public discovery, B+C matching and tracking, D source update with second approver and page change, E reminders, F security, G languages) and `e91-form-restore`.

## Known gaps
Check-now exists, but there is no force-run for sources already inside their interval bucket beyond it; SME Corp blocks automated fetches (403); no real scheduler, mailer or hosted run; no human security review; ms/ta need native review; the agency-language label on detail pages is a small heuristic.

# Government assistance sources: verification status (2026-11-15)

Scope: what is known about each candidate official source and each programme record. Local evidence only. No hosted database was read or written, no source was enabled, no scheduler runs, and nothing here is a published programme. INOK is not a government agency and does not decide eligibility; every record must be checked by a person against the agency's own page before it is published.

## Method of this check
- Read-only requests with the project's own guarded fetcher (`tests/live/gov-live-smoke.test.ts`, opt-in with `GOV_LIVE=1`): robots.txt first, an identifying but generic user agent (no personal contact details), at least ten seconds between requests, three requests per TEKUN run (run twice, to capture headers) and three per page-monitor candidate, no writes.
- No access restriction was bypassed. SME Corp was not requested again; its earlier HTTP 403 stands.
- Result: the code paths work against the real pages. That is **not** human verification of any programme record.

## Source catalogue
| Source | Mode | Live result today | State | What a person must do before anything is published |
|---|---|---|---|---|
| TEKUN SPUMI scheme page and its conditions page (`www.tekun.gov.my`) | `tekun` extractor | robots allow it. Both pages answer 200. Extraction returns the scheme name, financing RM1,000 to RM100,000 and 17 requirement rules. The server sends an ETag on both pages (no Last-Modified), so conditional requests work. | **Awaiting human review.** Extractor output is only ever a proposal. | Compare each extracted rule, the amount, the application channel and the documents list with the live page; approve through the two-person rule. |
| MITRA Modal Insan list (`www.mitra.gov.my/ms/modal-insan`) | `page_monitor` | robots allow it. 200. 88 links, about 5,700 characters of text. The normalised hash was identical on two reads ten seconds apart (no false "changed" alarms). Last-Modified is the current time (Joomla), so it is useless as a validator; the hash comparison decides. No ETag. | **Awaiting human review.** The monitor never creates programmes. | An administrator reads the list and enters only the programmes aimed at businesses (about one, the Uyarvu MADANI Startup Accelerator Grant, applied for through a form). |
| MyASSIST MSME FAQ (`myassist-msme.gov.my/faq/`) | `page_monitor` | robots allow it. 200. 56 links, about 4,200 characters. Hash stable. No ETag or Last-Modified (plain GET each time). | **Awaiting human review.** An advisory FAQ, not a programme feed. | Decide whether any service on it belongs in the catalogue. No deadlines are published there. |
| SME Corp all programmes (`smecorp.gov.my`) | administrator maintained | HTTP 403 to automated requests (earlier research). Not retried. | **Unavailable to automated retrieval.** | An administrator reads the page in a browser and enters verified facts by hand. Do not monitor until SME Corp permits it or a header-level test with our own agent succeeds. |
| Malaysia Open Data (`data.gov.my`) | administrator maintained | Not requested. | **No programme dataset identified.** | Revisit only if a relevant dataset is found. |

## Programme records
- A fresh database contains **no programmes**. There are no seeded or hosted records, so there is nothing "verified" in the catalogue yet. Verified, stale, closed and archived are states a published record reaches through the workflow, not facts about the sources above.
- Test fixtures (for example "Alpha Grant" in the browser journeys) are synthetic and never shipped.
- The display statuses the product uses are: open, upcoming, dates not confirmed, under review, stale, closed, archived. A record whose dates were not stated by the agency shows "dates not confirmed"; the product never fills them in.

## Rules that keep unverified information out
1. Sources start disabled. Enabling one is a proposal that a different administrator approves.
2. Extraction and page changes only produce proposals or review-queue items. Publishing needs a different administrator with publish rights than the author (database rule `second_person_required`).
3. A failed or blocked fetch changes source health only, never a published programme (integration test `p7-worker`, pgTAP 21 and 23).
4. A programme that was not re-confirmed within its source's freshness window shows as stale, and its saved-programme owners get one recheck notice.
5. Audience is stored per programme (individual, organisation or both). Programmes only for organisations are never recommended to a single shop owner.

## Open items
- A human reviewer must verify each of the candidate programmes above on the live agency pages and enter them through the admin console. Until then the catalogue is empty by design.
- Ask SME Corp (or check `robots.txt` and terms in a browser) before any automated access.
- Record, per source, who verified it and on what date (the audit log keeps the approval; add a verification note in the reason field).

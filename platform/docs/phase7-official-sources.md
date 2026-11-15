# Phase 7: official source research (2026-11-15)

Method: public pages fetched through a summarising reader (no HTTP headers or `<head>` tags visible), so ETag/Last-Modified support and `link rel=alternate` feeds are **unknown** for every source and must be checked with the real fetcher (the worker now records the validators it receives). Nothing below is a verified programme record; reviewers verify against the live page before publishing.

| Source | API/feed found | robots.txt | Mode chosen | Notes |
|---|---|---|---|---|
| MITRA `/ms/modal-insan` | none visible (HTML sitemap only; Joomla) | page allowed | `page_monitor` (daily, conditional GET, hash + link set) | Lists about 30 MADANI items (mostly education/social). One business item: Uyarvu MADANI Startup Accelerator Grant (Phase 2), applied for through a Google Form. Page shows "Tarikh Kemaskini". No closing dates stated. |
| TEKUN SPUMI conditions | `wp-sitemap.xml` (lastmod) likely; WP REST unverified | page allowed | `tekun` adapter (extractor, review queue) | Financing RM1,000-RM100,000; branch counter application; eligibility and documents listed on the page (already extracted and tested on saved real pages). |
| SME Corp all-programmes | unknown | **HTTP 403** to automated fetch | administrator-maintained | Do not monitor or seed until a header-level test with our own user agent succeeds or SME Corp gives permission. |
| MyASSIST MSME FAQ | none found | no Disallow lines seen (low confidence) | `page_monitor` weekly | A services FAQ (advisory, MatchMe, MeetMe, webinars); free; no deadlines. |
| data.gov.my | REST "Malaysia Open API" exists | allowed | administrator-maintained for now | A catalogue, not a programme list; no relevant programme dataset identified. CC BY 4.0. |

Seeding local development sources: `supabase/dev/seed-gov-sources.sql` (all disabled).
Hosted use: register through the admin console; a second administrator approves enabling; turn the switches on only after the staging checklist in `phase7-report.md`.

# INOK Landing Page: Plan
Updated: 2026-11-03 · Source of truth for facts: the vault (`02-Projects/Active/MITRA Programme`). This file is a condensed copy.

## Goal
A promotional landing page branded **INOK, "Idhu Namme Oru Kedai"** (Tamil: "this is our shop").
It presents the 2024 MITRA-funded *Program Pensijilan Digital Marketing Strategist*, delivered by GET Academy
(Global Experiential Training Academy), as a high-value success, with every figure matching the records.
Structure modelled on korporatlygroup.com.

## Brand
- Name: INOK. Expansion shown alongside it: "Idhu Namme Oru Kedai". Meaning: "This is our shop".
- Wordmark: a striped shop awning (kedai) over "INOK", as an inline SVG (`src/components/Logo.astro`). Favicon matches.
- Palette: marigold `#f4a51c` (brand), maroon `#8c1d40` (accent), on warm cream `#fffcf6`. Light theme only (no dark mode, user decision 2026-11-03).
- GET Academy is the organiser (`site.json` → `organiser`); its own logo appears only in Partners.

## Verified facts (safe to publish)
| Fact | Value | Source |
|---|---|---|
| Programme length | 26 days = 6 days face-to-face + 20 days mentored online implementation | Programme design, poster |
| Participant results | 9,020 views on one small business's videos made during the programme + 2,700 views on one live-stream; one TikTok shop grew ~100 followers through 2 h of live selling and made its first online sales within days of the classroom phase; one participant built a website within the six days; four portfolio websites compiled; participants recorded and published TikTok videos and ran live sessions in class | Final report (MITRA PPDMS Laporan Akhir, section 6, Lampiran G4 account screenshots) |
| Paid placements | Trainees went on to paid placements of about 6 months running live digital-marketing projects. Shown without "intern" or GET Academy (user decision 2026-11-10); no count | Vault Research #8; final report G3 (internships committed for participants) |
| Day-by-day topics | Day 1 Know Yourself (persona, CapCut) · Day 2 Know Your Product (FB, IG, Google Ads, ChatGPT) · Day 3 TikTok videos · Day 4 TikTok topics + live-streaming · Day 5 Shopee/Lazada, products, suppliers · Day 6 viral marketing, branding, TikTok live | Final report, section 3 |
| Curriculum | Digital-marketing strategy, target customers, business/product positioning, CapCut video editing, social content, Facebook/Instagram marketing, Google Ads, ChatGPT, Shopee/Lazada | Programme design |
| Certification partner | **SEGi College Subang Jaya**, "Strategic Educational Partner", part of SEGi University & Colleges; issued the programme's certificates | User confirmed 2026-11-03 + official lockup supplied; 2024 poster says "SEGi University"; GET profile says "SEGi University and Colleges Malaysia" |
| MITRA | Funder only: "MITRA, the Malaysian Indian Community Transformation Unit, funded INOK". No MITRA track-record figures on the page (user decision 2026-11-07: "we are not their mouthpiece"). Sourced figures stay in the vault (`06-Reference/Organizations.md`) for reference. | User decision |
| Lead trainer (self-reported) | Ganesh Kumar Manokara: former Head of Microsoft's Malaysia AI National Skilling Initiative; 800,000+ Malaysians equipped with AI skills; MoE project; 10X1000 (Alibaba) alumnus; UNESCO EE-Net; MMK HCD Committee Penang; CPD Group approved provider | SEA AI Academy deck (Oct 2026), supplied by the user |
| GET Academy | Est. 2012; SEGi franchisee; HRDF and MDEC approved; TEN-recognised | Org profile |
| Lead trainer | Ganesh Manokara, 20+ years (HRDF Train & Place 2009 → Penjana 2020) | Org profile |
| Address | Level 33, Ilham Tower, Kuala Lumpur · geta.com.my | Org profile |

## Do NOT publish
- Programme dates (days, months, year) or any participant count (user decision 2026-11-10). Label days "Day 1"… instead.
- "50 trained / 50 certified", or the 50-participant target as an outcome.
- A certificate count (6 signed acknowledgements exist, with no serial numbers: unreconciled).
- A placement/intern count (sources say 5 and ~6: conflicting), or the words "intern" / GET Academy for the placements.
- 13 approved / 3 absent / 76.92% participation, billing totals (12, 19, 21), eligibility (B40/M40, age), disputes, rejected sessions.
- "100% 5-star", "~100% attendance" or other unverified profile claims.
- JPM crest, until permission is confirmed. (MITRA and partner names currently shown: "sample build" decision by the user. SEGi College logo supplied by the user.)
- MITRA's own figures, initiatives or track record (the page showcases GET Academy's delivery, not MITRA).

## Page structure (one component each, `src/components/sections/`)
1. **Nav**: logo · Programme · MITRA · Results · Journey · Interviews · Gallery · Partners · Contact
2. **Hero**: cohort photo + short muted video loop; headline, sub-line, CTAs (Partner with us / Watch highlights → Interviews)
3. **About**: why INOK, what happened over the 26 days, who delivered/funded/certified it; photo in a tilted frame
3b. **MITRA** (`Mitra.astro`): "MITRA backed it. We built it." GET Academy's delivery of the MITRA-funded programme: intro + photo, numbered "What we delivered" list (verified facts only; `verify` items hidden), closing statement band + CTA
3c. **Results** (`Results.astro`): "Real shops. Real results." 4 participant-result stats, 4 win cards, photo, paid-placement band, source line
4. **Impact**: 26-day grid (6 face-to-face + 20 online), no dates or participant count
5. **Curriculum**: icon grid of 9 modules/tools + hands-on photos
6. **Journey**: Day 1 … Day 6 (topics from the final report) → 20 days implementation → certification
7. **Trainer**: Ganesh Manokara and team
8. **Interviews** (`Interviews.astro`): videos with sound and controls; currently the full Day 1 film (4 min). Hidden if no video file exists
9. **Gallery**: 12–24 photos/stills, filterable by day
10. **Partners and accreditation**: SEGi, HRDF, MDEC, TEN (+ MITRA if permitted)
11. **Contact / CTA**: two paths (learn and grow digitally · bring INOK to your community), each a mailto to tech@korporatlygroup.com with its own subject
12. **Footer**: address, geta.com.my, socials

## Media status (from `content/media.json`)
Local media covers **8 and 9 Jul only**: 13 photos + one 4-min Day 1 montage. Gaps:
- Journey days 10–13 Jul → text-only timeline items.
- Interviews: only the Day 1 film. The six vendor interview videos (vendor email 1 Aug 2024) are in the vendor's private Drive: get a copy, add as interview-02… in media.json.
- Certification and placement photos: none yet.
- Partner logos (GET Academy, SEGi, HRDF, MDEC, TEN) → need official files from the brand owners.
- Trainer: which person is Ganesh is not yet identified.
More footage is probably in Drive "MITRA 2026" (not accessible from the connected account).

## Open items / decisions
- Hosting: geta.com.my subpage / korporatlygroup.com / standalone (→ Vercel or Netlify).
- Languages: EN only, or + BM (+ Tamil).
- MITRA name/logo and SEGi logo permission.
- Contact: tech@korporatlygroup.com (user decision 2026-11-10); add WhatsApp or a form later if wanted.
- Participant consent for every photo and video (all `pending`).
- Identify Ganesh in the photos. Supply logos, testimonials, certificate and intern photos.

## Workflow
LOCAL session = media (contact sheets → shortlist → `tools/optimize_media.py` → `media.json`).
CLOUD session = code only, from `site.json` + `media.json` text. See `CLAUDE.md`.
Media budget: images < 400 KB, clips < 8 MB, `public/media/` < 60 MB total. Long videos → YouTube/Vimeo.

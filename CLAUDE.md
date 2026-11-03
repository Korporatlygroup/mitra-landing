# CLAUDE.md: INOK Landing Page

**INOK = Idhu Namme Oru Kedai** (Tamil, "this is our shop"). The whole page is branded INOK.
It presents GET Academy's 2024 MITRA-funded "Program Pensijilan Digital Marketing Strategist"
(Digital Marketing Strategist Certification Programme). GET Academy stays named as the deliverer wherever facts are stated.
Brand: `site.json` → `brand`; wordmark `src/components/Logo.astro` (striped awning over "INOK"); palette marigold `--brand` + maroon `--accent`.
(Repo is still named `mitra-landing`.)
Full plan: `docs/plan.md`. Long-term memory lives in the Obsidian vault (`C:\Korporatlygroup\Claude-Vault`), not here.

## Stack
Astro (static output), plain CSS with colour tokens (`src/styles/tokens.css`). **Light theme only**: the user chose the light palette; don't add a dark mode. No UI framework.
- `npm install` · `npm run dev` · `npm run build` (output in `dist/`).

## Where things live
| Path | What |
|---|---|
| `content/site.json` | **All copy and every figure.** Components never hard-code text or numbers. |
| `content/media.json` | Every image/video/logo: file, size, alt, a full text description, consent status. |
| `public/media/` | Optimised, web-ready media only (written by `tools/optimize_media.py`). |
| `src/components/sections/` | One component per page section, in page order. |
| `src/components/Media.astro` | Renders a media.json entry; shows a labelled placeholder when the file is missing. |
| `tools/` | Python media tools (run by the LOCAL session only). |

## Roles: two sessions share this repo
- **LOCAL session** (Windows PC): media work. Views raw media in `C:\Korporatlygroup\INOK\mitra` through contact sheets,
  picks assets, runs `tools/optimize_media.py`, writes `content/media.json` descriptions, commits `public/media/`.
- **CLOUD session**: coding only. Never views images. Works from the text in `media.json` (`description`, `w`, `h`,
  crop-safe notes). If an asset is missing or unsuitable, add a note to the entry's `notes`. Don't swap files.

## Raw media is never committed
- Nothing from `INOK\mitra` goes into git: no originals, no .mov/.zip, no contact sheets (`_previews/`).
- Never open or copy anything from `Official Documents`, `Peserta Program Details` or `Status Proof` (personal/financial data).
- Run `git status` before every commit.

## Framing rules (non-negotiable)
- Positive framing, but **every number must match the records** (see `docs/plan.md` → Verified facts). Never claim "50 trained/certified".
  The page must not contradict GET Academy's submission to MITRA.
- Don't state a certificate count or an intern count until verified (`site.json` → `verify` flags).
- Omit disputes, rejections, eligibility arguments and billing. Don't misstate them either.
- Do not imply MITRA endorses the page. MITRA, JPM/government crests and SEGi logos: **only after permission is confirmed** (currently pending).
- People: every photo/video of participants has `consent: "pending"` until the user confirms. No names, name cards, IC numbers, income or B40/M40 data.
- Don't reuse unverified GET Academy profile claims ("100% 5-star", "~100% attendance").
- Show only content where `site.json` / `media.json` mark it publishable. Pending items render, but are listed in `docs/plan.md` → Open items.

## Code style
- Read copy from `site.json`, media from `media.json` via `src/lib/media.ts`. Missing data must degrade gracefully (placeholder, not a crash).
- Mobile first, no horizontal scroll, images with explicit `width`/`height`, `loading="lazy"` below the fold, real `alt` text.

## Security (see `SECURITY.md`)
- Keep the site static and self-hosted: no PHP, no server code, no third-party scripts, fonts, embeds or trackers. Adding any external origin means updating the CSP in `astro.config.mjs` (and `form-action` for a form host).
- Security headers live in both `vercel.json` and `public/_headers`. Change them together.
- External links use `rel="noopener noreferrer"`. Never `set:html` content from `site.json`; only hard-coded icon markup.
- Run `npm audit` before each push. Don't commit secrets or `.env` files.

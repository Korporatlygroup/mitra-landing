# INOK redesign: release candidate (not deployed)

Branch `redesign/ui-v2` (from `release/inok-final` at `5f217d7`). Production still runs Worker `a67b63db-1df3-4faf-9c86-407abeda0509`
(rollback for the next deploy). Nothing here has been merged or deployed.

## What is in this candidate

| Area | Change |
|---|---|
| Design tokens | White / `#F8FAFC`, burgundy `#981B40` (hover `#7B1534`, tint `#FCEEF2`), yellow `#F5A623`, text `#171717` / `#64748B`, borders `#E5E7EB`, success `#16A34A`; Inter replaces Hanken Grotesk and Bricolage; warm and green-grey hard-coded colours replaced by slate neutrals. One place: `:root` in `src/app/globals.css`. |
| Shell | Fixed two-column grid: sidebar 248 px (72 px collapsed), header 68 px, sticky sidebar. Collapse state is a cookie, so the server renders it and it never resets on navigation. Collapsed items keep icons, a tooltip (`title`) and an accessible name. |
| Products & Services shrink | Root cause: `main:has(.catalogue-wide) { max-width: 1240px }` matched the outer `<main>` that contains the whole shell and capped it. The rule now applies to the catalogue block only. |
| Sidebar menu | Overview, Marketplace, My workspace, Business support, Account, and an Admin group (console, business reviews, duplicate reviews, programme management, news management) for staff. No Courses & Training. Links to modules that do not exist are not shown. |
| Home | Search, onboarding card with Skip, organisations, recommended actions, latest news, government assistance, marketplace, activity. Real records only. |
| Programmes & Opportunities | `/business-help`: breadcrumb, four filter cards (Recommended, New, Closing soon, Saved) with real counts, tabs, programme cards, How it works, latest news, independence notice. Emojis removed. |
| Saved programmes | Account-level bookmarks (migration `20260701000230_gov_saved_account.sql`): no business needed, own list only, published programmes only, no duplicates. A business that tracks applications is kept in step. |
| Onboarding wording | SSM is explained (Suruhanjaya Syarikat Malaysia; typing a number does not make it genuine; who needs it); "Authorised person" becomes "Business owner or authorised representative" with help text. |
| Earlier in this line | List-your-business intent flow, details gate on action pages, error recovery page (see the previous release notes). |

## Tests run on this branch (local stack, Chromium)

- `tsc`, `eslint`: clean. Unit: 1021 passed.
- Integration: 5 new (saved programmes: own list, published only, no direct writes, visitors refused) passed.
- pgTAP `01_rls_and_grants` (allow-lists updated for migrations 226 to 230): passed.
- Browser, desktop: 41 passed (new: saved without a business, sidebar width and persistence across 5 modules, list-your-business intent in three journeys, details gate, every sidebar link opens; existing: sign-up and login, organisations, Bahasa Melayu, usability, business help incl. axe in en/ta/ms, keyboard login).
- Screenshots at 390, 768, 1280 and 1440 px: `docs/redesign-screenshots/` (36 files, produced by `SHOTS=1 npx playwright test e97`).

## Deploying (needs authorisation)

1. Back up production, then `supabase db push --remote=<ref>` (applies 230 only; additive).
2. `bash` build with the production publishable key (`scripts/cf-build.mjs production`), then `npx wrangler deploy --config wrangler.production.jsonc`.
3. Run `tests/production/run.sh` (01 to 03), then check `/en`, `/en/business-help`, `/en/catalogue` signed in.
4. Rollback: redeploy Worker `a67b63db-1df3-4faf-9c86-407abeda0509`. Migration 230 can stay (nothing reads it then).

## Not done / known gaps

- The design references were not attached to the request, so the look follows the written tokens and layout rules, not a pixel match.
- Not restyled page by page: Products & Services forms, directory cards, enquiry/quotation/messaging screens, sourcing and admin pages inherit the new tokens, fonts, shell and icons but keep their old internal layouts.
- Header shows search, Create, notifications and account; a contextual page title or breadcrumb is only on Programmes & Opportunities. The separate Quotations and Messages menu entries are one "Enquiries & messages" entry because both live under `/enquiries`.
- Onboarding step 2 and 4 wording is in place; the multi-section single-page layout from the brief (identity, contact, location, online presence, products) is not rebuilt: contact and online-presence fields stay in the listing editor.
- Malay and Tamil strings for the new copy are drafts.
- Blank admin page: not reproduced on any browser we control; it loads for the administrator after the latest deploy.

# Premium redesign v3: audit, decisions and status

Branch `redesign/premium-v3` (from `release/inok-final` at `37a836a`; production runs Worker `7d52d3e9`, migration 230). Nothing here is deployed.

## Audit (what the repository actually is)

- Next.js 16, React 19, next-intl, Supabase, Cloudflare Workers via OpenNext. **No Tailwind, no Radix, no shadcn, no lucide, no TanStack, no react-hook-form, no Recharts.** Styling is plain CSS (about 3,700 lines in `globals.css`, `ui.css`, `shell.css`, `pages.css`, now `kit.css`) driven by CSS custom properties. Icons come from the project's own SVG set (`components/ui/Icon.tsx`, Lucide-style strokes).
- 69 components; one shared signed-in shell (`WorkspaceShell` + `WorkspaceChrome`), a separate admin shell, a focused onboarding header.

## Decisions

1. **shadcn/ui is used as a pattern library, not installed.** It needs Tailwind and Radix, which means a new styling pipeline across every page, a larger Worker bundle (the Worker has a CPU budget) and a second styling system beside 3,700 lines of working CSS. The brief also forbids a second UI framework and large upgrades. The dashboard and collapsible-sidebar structures (fixed 248/72 px grid, sticky sidebar, inset content) and Untitled UI / Tailwind Plus hierarchy rules (page header, cards, tabs, empty states) are implemented in the existing CSS and React.
2. **Reusable components** live in `components/cards` (DiscoveryCard, OpportunityCard, NewsCard, MetricCard) and `components/shared` (EmptyState, SectionHeader), styled in `src/app/kit.css`. Business, product and action cards are defined there too (`.lcard`, `.acard`).
3. **Libraries not added yet:** TanStack Table (admin review queues, phase F), React Hook Form (onboarding rebuild, phase E) and Recharts (no real historical metrics exist, so no charts). Each will be added only where a page needs it.
4. **Fonts:** Plus Jakarta Sans (headings) and Geist (body) through `next/font/google`. Neither covers Tamil script, so Tamil falls back to the already loaded Noto Sans Tamil. Latin-ext is loaded for Malay.

## Done on this branch

- Fonts and heading scale (30-32 px desktop titles, 19 px section titles).
- UI kit and the new Home: compact greeting, unified search (businesses or products, each a real route), four discovery cards, organisations, published programmes as opportunity cards, a business workspace card with real status and only non-zero metrics, news cards with category, publisher and date, directory cards with monogram, and honest empty states.
- Landing (separate repo branch `landing/explore-cta`): nav is `Sign in` and one yellow `Explore Businesses` (to the directory); the hero "Get started" button became "Explore Businesses".
- Earlier in this line (already on the release branch): token palette, fixed-grid sidebar with cookie-persisted collapse, Programmes & Opportunities, account-level saved programmes, list-your-business intent.

## Still to do (phases)

| Phase | Remaining |
|---|---|
| B | Header: workspace selector moves into the header; account menu entries (profile, settings, sign out) reviewed against the brief. |
| C | News page as editorial cards (featured story, category filters); article page restyle. |
| D | Directory as a card grid with filter sheet on mobile; public business profile sections; Products & Services cards; messages as list + thread; quotations table. |
| E | Business 360 operational layout; onboarding as seven steps on one rebuilt form; profile pages. |
| F | Admin overview, TanStack review queues with confirmation dialogs; blank-admin-page hardening. |
| G | Screenshots at 360/390/768/1024/1280/1440/1920, Tamil text-expansion checks, accessibility pass, production smoke. |

## Content work done alongside (production data, not code)

Publishing switch on; programmes published: TEKUN SPUMI, Uyarvu MADANI, SME Bank Vanigham, AIM microcredit for Indian women (the last two are press-based and labelled so); SME Corp SFSME 2.0 and BAP stay in review. Six news items published with sources and dates. Biweekly editorial process: see `docs/editorial-process.md`.

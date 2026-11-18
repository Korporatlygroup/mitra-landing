# Premium V3: route inventory and status

Source: the Next.js route tree under `platform/src/app/[locale]/` (about 110 pages).

Status words used here (be strict about them):

- **Rebuilt**: layout and structure were replaced with the shared kit (header, tabs, cards, tables, empty states, two-column layouts).
- **Header + cards**: the page now uses the shared `PageHeader`, the flat card system and responsive card grids, but its inner form/list content is the same as before.
- **Restyled**: only global fonts, tokens and the shell reach it.
- **Not visually checked**: changed, but no screenshot was reviewed (the page needs data or a role the local test stack could not provide).

Shared kit: `PageHeader`, `TabsNav`, `StatusBadge`, `EmptyState`, `SectionHeader`, `MetricCard`, `DataTable`, `DiscoveryCard`, `OpportunityCard`, `NewsCard`, `BusinessCard`, `ProgrammeCard`, `FilterSheet`, `ConversationFilter`, `NotificationList`, `AdminSide`. CSS in `src/app/kit.css` (`xgrid-*`, `xgrid-m`, `split-x`, `rrow`, `acard`, `dtable`, `settings-x`, `fchip`).

## Public and discovery

| Route | Status |
|---|---|
| `/directory` | Rebuilt (cards, scrolling chips, phone search). No filter sheet. |
| `/directory/[slug]` | Header + cards (cover, tabs existed; services/products/projects now cards; not visually checked with data) |
| `/news`, `/news/[id]` | Rebuilt (list); article header rebuilt, body still one text block |
| `/business-help` | Rebuilt |
| `/business-help/find` | Rebuilt (two columns: need chips and profile on the left, results and search on the right) |
| `/business-help/[slug]` | Header rebuilt (actions up top, chips, status); body sections still the old definition lists |
| `/business-help/saved`, `/settings` | Header + cards |
| `/catalogue` | Header + cards, phone Filters disclosure |
| `/catalogue/[id]` | Header + cards (sections in cards; two-column buy box existed) |
| `/catalogue/compare`, `/saved`, `/requests`, `/requests/[id]`, `/[id]/request` | Header + cards; saved has an empty state |
| `/search`, `/complaints`, legal pages | Restyled |

## Auth and workspace

| Route | Status |
|---|---|
| `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/mfa/*`, `/invite/*` | Restyled (auth cards, left simple on purpose) |
| `/` signed-in Home | Rebuilt |
| `/requests` | Rebuilt |
| `/requests/new` | Guided wizard already existed (5 steps, focus layout); only restyled |
| `/requests/[id]` | Rebuilt (header, invited/suggested cards with status badges, summary panel, end-request panel) |
| `/requests/[id]/quotes` | Rebuilt (comparison table; not visually checked: needs quotation data) |
| `/enquiries`, `/enquiries/[id]` | Two-pane layout existed; added search, status chips, empty state |
| `/notifications` | Rebuilt |
| `/account` | Rebuilt (settings workspace) |
| `/orgs`, `/orgs/[id]/members` | Members: header, role badge, invite and pending invitations in cards |
| `/sourcing`, `/sourcing/new`, `/sourcing/[rfq]` | Header + cards |
| `/orgs/[id]/business` (dashboard) | Header + cards; fixed a squeezed "median first reply" tile |
| `/orgs/[id]/business/360` | Rebuilt |
| `/orgs/[id]/business/onboarding` | Wizard existed (5 steps); added Review and finish, required/optional hints, compact phone stepper |
| `/orgs/[id]/business/listing`, `/preview`, `/verification` | Header + cards; empty states for the "not started" gate; verification claims in cards |
| `/orgs/[id]/business/leads`, `/requests`, `/requests/board`, `/requests/[requestId]`, `/products` | Header + cards |

## Partner (`/orgs/[id]/partner/*`)

Home rebuilt (action cards, linked metric tiles). All other partner pages: header + cards. **Not visually checked**: a partner organisation must be approved by an administrator before these pages render, and my local screenshots only reached the approval gate.

## Administration

| Route | Status |
|---|---|
| `/admin/verification`, `/listings`, `/reviews`, `/duplicates`, `/reports`, `/audit`, `/users`, `/news` | Rebuilt |
| `/admin/business-help` | Rebuilt (attention cards, stats, switches, sources, queue, programmes) |
| `/admin` overview | Header + tiles (unchanged tile design) |
| `/admin/business-help/sources`, `/review/[id]`, `/page-changes`, `/programmes/new`, `/programmes/[id]/edit` | Header only |
| `/admin/catalogue/*`, `/admin/products`, `/admin/privacy-requests`, `/admin/sourcing`, `/admin/listings/[orgId]`, `/admin/verification/[claimId]`, `/admin/news/[id]` | Header + cards |
| Admin menu | Collapses behind a Menu button on phones |

## Known gaps

- No React Hook Form, TanStack Table, Recharts or Radix were added (no clear functional need; the kit is plain CSS).
- No request activity timeline, no conversation context panel, no analytics charts.
- Tamil/Malay layouts were not screenshotted; only the strings were added.
- 1920 px and 360 px screenshots exist only for the pages in the main screenshot spec.

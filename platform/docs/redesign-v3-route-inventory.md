# Premium V3: route inventory and status

Source: the Next.js route tree under `platform/src/app/[locale]/` (about 110 pages). "Role" = who normally uses it. Status as of the commit that adds this file:

- **Rebuilt**: structure changed (new layout built from the shared components).
- **Partly**: some structural change, other parts still the old layout.
- **Restyled**: only the global fonts, tokens and shell reach it.
- **Todo**: planned replacement pattern is listed, not yet built.

Shared components now in use: `PageHeader`, `TabsNav`, `StatusBadge`, `EmptyState`, `SectionHeader`, `MetricCard`, `DiscoveryCard`, `OpportunityCard`, `NewsCard`, `BusinessCard`, `FilterSheet`, `ProgrammeCard` (redesigned), `NotificationList` (redesigned). Layout helpers in `kit.css`: `xgrid-*`, `xgrid-m`, `split-x`, `rrow`, `acard`, `settings-x`.

## Public (logged-out and everyone)

| Route | Role | Status | Pattern |
|---|---|---|---|
| `/` (landing redirect/home when signed out) | visitor | Restyled | discovery landing for the app |
| `/directory` | everyone | Partly | search + chip row + card grid (done); filter sheet on mobile (todo) |
| `/directory/[slug]` | everyone | Todo | company-page header, tabs (About, Services, Contact) |
| `/news`, `/news/[id]` | everyone | Rebuilt (list), Partly (article) | editorial cards; article body sections (todo) |
| `/business-help`, `/business-help/[slug]` | everyone | Rebuilt (list), Todo (detail) | searchable programme cards; detail page with eligibility, dates, source |
| `/business-help/find`, `/business-help/saved`, `/business-help/settings` | owner / any signed-in | Todo | dedicated matching panel; saved cards; settings page |
| `/catalogue` (Products from India) | buyer | Partly | cards + mobile Filters disclosure done; list header/summary (todo) |
| `/catalogue/[id]`, `/catalogue/compare`, `/catalogue/saved`, `/catalogue/[id]/request`, `/catalogue/requests`, `/catalogue/requests/[id]` | buyer | Todo | detail with spec table, comparison table, saved grid, price-request form, request list |
| `/search` | everyone | Todo | combined results tabs |
| `/terms`, `/privacy`, `/cookies`, `/government-disclaimer`, `/marketplace-policy` | everyone | Restyled | reading layout with side contents |
| `/complaints` | signed-in | Todo | support centre layout |

## Auth and onboarding

| Route | Role | Status | Pattern |
|---|---|---|---|
| `/login`, `/signup`, `/signup/check-email`, `/forgot-password`, `/reset-password` | visitor | Restyled | centred auth card (kept simple on purpose) |
| `/list-your-business`, `/invite/[token]`, `/invite/partner/[token]` | visitor / invitee | Restyled | redirect or confirmation card |
| `/mfa/enrol`, `/mfa/verify` | signed-in | Restyled | stepper card |
| `/orgs`, `/orgs/new` | signed-in | Restyled | workspace list; create-workspace form |
| `/orgs/[id]/members` | owner | Todo | team table with roles, invitations, confirmations |
| `/orgs/[id]/business/onboarding` | owner | Todo | guided wizard (current 5 steps; 7-section UX target) |

## Signed-in workspace

| Route | Role | Status | Pattern |
|---|---|---|---|
| `/` signed-in Home | all | Rebuilt | discovery dashboard |
| `/requests` | buyer | **Rebuilt** | header, metrics, tabs, search, request cards, enquiries panel, empty state |
| `/requests/new`, `/requests/[id]`, `/requests/[id]/quotes` | buyer | Todo | guided form; detail with timeline; quotations table |
| `/enquiries`, `/enquiries/[id]` | buyer / seller | Partly (list+thread existed) | conversation list + thread; context panel (todo) |
| `/notifications` | all | **Rebuilt** | All/Unread tabs, grouped list, empty state, link to settings |
| `/account` | all | **Rebuilt** | Settings workspace: My account, Security, Notifications, Privacy, Data requests |
| `/sourcing`, `/sourcing/new`, `/sourcing/[rfq]` | buyer | Todo | sourcing request list, form, detail |
| `/orgs/[id]/business` (dashboard) | owner | Todo | operational dashboard |
| `/orgs/[id]/business/360` | owner | **Rebuilt** | identity header, four metrics, grouped readiness with progress, next actions, assistance, opportunities, news |
| `/orgs/[id]/business/listing`, `/listing/preview`, `/preview`, `/products`, `/verification`, `/leads`, `/requests`, `/requests/board`, `/requests/[requestId]` | owner | Todo | listing editor cards; products table; verification status page; request tables |

## Partner / supplier area (`/orgs/[id]/partner/*`, 17 pages)

Todo for all: dashboard, products (list/new/edit/preview/detail), suppliers (list/new/edit/detail), import (upload + job), requests, sourcing, notifications, settings. Pattern: data tables for management, multi-step forms for creation, detail panels.

## Administration (`/admin/*`, 27 pages)

| Route | Status | Pattern |
|---|---|---|
| `/admin` overview | Partly (proposals count and switches done) | summary cards + operational table |
| `/admin/verification`, `/verification/[claimId]`, `/reviews`, `/listings`, `/listings/[orgId]`, `/duplicates`, `/reports`, `/users`, `/audit`, `/privacy-requests`, `/products`, `/sourcing` | Todo | review queue table + detail drawer + confirmation dialog |
| `/admin/business-help/*` (programmes, sources, review, page-changes) | Todo | source status cards, field-level diff review |
| `/admin/news`, `/admin/news/[id]` | Todo | drafts / published / archived tabs |
| `/admin/catalogue/*` (partners, suppliers, products, imports, reports) | Todo | tables with status filters |

## Remaining

`[...rest]` (404), `error.tsx` and loading states are Restyled. Test coverage per route is in the PR description and the audit report.

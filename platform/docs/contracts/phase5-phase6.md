# Phase 5 / Phase 6 contract: India-Malaysia supplier catalogue and sourcing

**Contract version:** `p5p6-contract/0.2` (DRAFT, owned by Phase 5 / Claude). Baseline: `integration/phase1-4` at `e0781e2` (contract `p3p4-contract/1.2` unchanged). Nothing here is applied to hosted staging.

## 1. Migration allocation (one authoritative sequence)
| Versions | Owner | Use |
|---|---|---|
| `000001`-`000014`, `000100`-`000105` | Phases 1-4 | as already integrated (hosted still has 1-11 under other stamps) |
| `000106` | Phase 4 owner | **reserved**: Phase 4 account-erasure fix (`referral_suggestions` delete rules) |
| `000107`-`000109` | integration | reserved for Phase 1-4 integration fixes |
| `000110` | Phase 5 | `p5_partners_suppliers` (also `product_categories` and the 12 seeded categories, moved here from 000111 because suppliers reference a category) |
| `000111` | Phase 5 | `p5_catalogue` (categories, products, revisions, live tables, media) |
| `000112` | Phase 5 | `p5_import` |
| `000113` | Phase 5 | `p5_buyer` (search, saved products, sourcing requests, reports) |
| `000114` | Phase 5 | `p5_admin_reports` |
| `000115`-`000149` | Phase 5 | reserved: fixes and addenda |
| `000150`+ | Phase 6 | request-any-product, multi-product RFQ, quotes, samples |
Rules: versions only ever increase; applied files are never edited; every Phase 5 foreign key to `organisations`, `auth.users` or Phase 3/4 tables has an explicit `on delete` rule (the Phase 4 erasure defect must not be repeated); Phase 5 never redefines Phase 1-4 functions except where listed in section 9.

## 2. Reuse and what is new
Reused as is: `organisations` (type `partner` already exists), `memberships`, roles and `role_permissions`, MFA rule for partner owners (`private.requires_mfa`), `invitations`, `notifications` + `private.notify_org`, `audit_log` + `private.write_audit`, `private.raise_error`, `private.check_rate_limit`, `private.require_consent`, the upload/scan/metadata-strip pipeline (`src/lib/upload.ts`, `src/server/scanner.ts`, service-role register/scan functions pattern), next-intl en/ta/ms, `ActionForm`, `StatusChip`, Phase 3 draft/live-snapshot pattern, `private.has_org_involvement` conflict rule for reviewers.
New (justified): wholesale supplier and product tables (a supplier is a record owned by a partner, not an auth user, and Phase 3 `business_listings` model a seller organisation, not a managed record); product revisions and live tables (variants and price tiers are relational and searchable); import jobs; saved products; sourcing requests with line items (Phase 4 `enquiries` is a buyer-org/seller-org conversation between two MITRA organisations and has no supplier record, price-tier or currency model, and Phase 4 quotations assume domestic tax/delivery terms, so they are not reused for international sourcing in Phase 5; a sourcing request may be bridged to an enquiry in Phase 6).
Product categories: new table `product_categories` (wholesale goods taxonomy); `business_categories` (seller sectors) is not suitable. Names are translated through `messages/*.json` (`pcat.<slug>`), same approach as Phase 3 ms.

## 3. Roles and permissions (added to `role_permissions`, mirrored in `src/lib/permissions.ts`, checked by a unit test)
| Permission | Granted to |
|---|---|
| `supplier:manage`, `catalogue:manage`, `sourcing:respond` | partner org `owner`, `manager`, `staff` (viewer: read-only) |
| `supplier:review`, `catalogue:review` | `admin_review`, `admin_super` |
| `partner:manage` (approve/suspend partner organisations) | `admin_super`, `admin_review` |
| `catalogue:moderate` (reports, suspend products) | `admin_support`, `admin_super` |
| `report:view` (existing) | operational statistics (`admin_ops`, `admin_super`) |
Buyers: any active member with `request:post` of a `buyer` or `business` organisation (existing). Partner org needs an `approved` `partner_profiles` row before any partner RPC works. A self-created partner org stays inert until MITRA approves it. Reviewers cannot decide on organisations they were involved in (`has_org_involvement`).

## 4. Tables (names final; columns authoritative in the migrations)
- `partner_profiles(org_id pk -> organisations on delete cascade, status partner_status: pending|approved|suspended, display_name, contact_email?, decided_by, decided_at, decision_reason)`.
- `suppliers(id, partner_org_id -> organisations cascade, code, status supplier_status: draft|awaiting_review|more_info_needed|approved|rejected|suspended, draft jsonb, draft_version, live_* snapshot (name, country, state_city, main_category, description, capabilities jsonb), review_checks text[] (what MITRA checked), reviewed_at, version, timestamps; unique(partner_org_id, code))`.
- `supplier_private(supplier_id pk, contact_name, contact_email, contact_phone, registration_id, website)`: partner org members only; never in a buyer or public response.
- `supplier_documents(id, supplier_id, doc_type, display_name, mime, size, sha256, storage_path, scan_status, scanned_at, uploaded_by set null)`: private bucket `verification-docs` prefix `supplier/`, access only through an access RPC and the existing signed-URL route pattern, and only when scan is clean.
- `supplier_events(id, supplier_id, actor set null, from_status, to_status, reason, at)`: append-only.
- `products(id, supplier_id, partner_org_id, sku, status product_status: draft|submitted|changes_requested|approved|published|unpublished|rejected|suspended, draft jsonb, draft_version, live_revision_id, version, timestamps; unique(supplier_id, sku))`.
- `product_revisions(id, product_id, rev_no, data jsonb immutable, status, submitted_by, decided_by, reason, decided_at)`.
- Live (written only by the publish function from an approved revision): `catalogue_items(product_id pk, supplier_id, category_slug, name, description, unit, moq numeric, currency, price_mode: tiers|fixed|request, price_confirmed_on, lead_time_min_days, lead_time_max_days, availability_status, availability_confirmed_on, specs jsonb, packaging, published_at, search tsvector)`, `catalogue_variants(id, product_id, sku, label, attributes jsonb, moq)`, `catalogue_price_tiers(id, product_id, variant_id null, min_qty, max_qty null, unit_price numeric(14,2), currency)`. Tiers per (product, variant) must not overlap (checked in the validator and by a trigger).
- `product_media(id, product_id, storage_path, mime, size, sha256, scan_status, alt text, sort)`: private bucket `catalogue-media`; served only through an app route after the database confirms the product is published and the file clean. No public bucket.
- `import_jobs(id, partner_org_id, supplier_id, mode create_only|create_or_update, status previewed|committed|failed|cancelled, file_name, file_sha256, counts, created_by, timestamps; unique(partner_org_id, supplier_id, file_sha256, mode) for idempotent retries)`, `import_rows(job_id, row_no, sku, status valid|invalid|duplicate, errors jsonb, data jsonb)`.
- `saved_products(user_id -> auth.users cascade, product_id -> products cascade, saved_at; pk(user_id, product_id))`.
- `sourcing_requests(id, reference text unique, buyer_org_id cascade, partner_org_id, supplier_id, status: submitted|acknowledged|clarification_requested|closed|withdrawn, destination_state, destination_city, needed_by, notes, idempotency_key unique per buyer org, created_by set null, version, timestamps)`, `sourcing_request_items(id, request_id, line_no, product_id set null, variant_id set null, snapshot jsonb (name, sku, unit, moq, price terms as shown, currency, confirmed dates), quantity numeric, unit)`, `sourcing_request_events(id, request_id, actor set null, kind, note, at)` append-only.
- `product_reports(id, product_id, reporter set null, reason, note, status open|actioned|dismissed, handled_by, handled_at)`.

**Implementation notes (0.2).** Exact signatures, shapes and error keys: `phase5-rpc-reference.md`. Changes from 0.1: (a) `product_categories` is created in 000110; (b) a buyer reply moves `clarification_requested -> submitted` (not straight to acknowledged); (c) suppliers use `draft_submitted_version` so an approved supplier stays live while a revision is reviewed; (d) tiers must be contiguous (gaps refused) with whole-number quantities; (e) `sourcing_requests.partner_org_id/supplier_id` are `on delete set null` and `supplier_name` is snapshotted; (f) `supplier_events` has no foreign key (append-only); (g) import duplicates flag only later copies and `_client_invalid` is accepted; (h) admin-provisioned partner owners accept through `accept_partner_invitation` (generic `accept_invitation` refuses them); (i) search/detail/compare/media-access are granted to `anon`; (j) added RPCs: `withdraw_supplier_submission`, `reinstate_supplier`, `reinstate_product`, `suspend_partner`, `resend_partner_invitation`, `cancel_import`, `get_import`, `get_my_product`, `get_product_for_review`, `list_partner_orgs`, `list_product_reports`, `reply_sourcing_request`, `withdraw_sourcing_request`, `close_sourcing_request`, media RPCs.

## 5. Public and cross-role interfaces (RPCs, all `security definer`, `search_path = ''`, allow-listed in test 01)
Partner: `provision/approve_partner`, `save_supplier_draft`, `submit_supplier`, `list_my_suppliers`, `get_supplier`, `register_supplier_document` (service), `save_product_draft`, `submit_product`, `publish_product`, `unpublish_product`, `list_my_products`, `stage_import`, `commit_import`, `list_imports`, `list_partner_requests`, `respond_sourcing_request(acknowledge|clarify)`. Admin: `list_supplier_reviews`, `review_supplier`, `list_product_reviews`, `review_product`, `suspend_supplier/product`, `handle_product_report`, `catalogue_stats`. Buyer/public: `search_catalogue(q, category, supplier, moq_max, price_min, price_max, currency, offset)`, `get_catalogue_item(id)`, `compare_items(ids[])`, `save_product`, `unsave_product`, `list_saved_products`, `submit_sourcing_request(...)`, `list_my_sourcing_requests`, `get_sourcing_request`, `report_product`. Hidden or unpublished resources are `404`, never `403`, except a caller naming an org they are not a member of (`403`, as Phase 3).

## 6. Rules
- Product lifecycle: partner edits `draft`; `submit_product` freezes a revision (`submitted`); admin `approve` -> `approved`; partner `publish_product` copies the approved revision into the live tables (`published`). Editing a published product creates a new draft; the live version stays until the new revision is approved and published. `unpublish` keeps the approval. Suspension by admin hides it at once.
- Search and detail show a product only if `products.status = 'published'` and `suppliers.status = 'approved'` and the partner is `approved`. Suspending a supplier or partner removes every dependent product from public results and blocks new sourcing requests (`409 supplier_not_available`).
- Prices are indicative and carry `price_confirmed_on`; availability is a statement with `availability_confirmed_on`, never live stock. No currency conversion anywhere. Money is `numeric`; tiers validated server-side (min >= 1, ascending, non-overlapping, one open-ended tier last).
- A sourcing request stores a **snapshot** of the terms shown to the buyer at submission (price tiers, MOQ, currency, dates). Later price edits never change it.
- Supplier public verification text is built from `review_checks` and `reviewed_at` ("MITRA reviewed ... on <date>"); there is no "trusted" badge; documents uploaded are not described as verified with an authority.
- Uploads: server-side only, type/size limits, scanning before access; if the scanner is unavailable the file stays inaccessible (status `pending`), nothing becomes public.
- Spreadsheet import: CSV or XLSX; limits on file size, rows (default 2,000), columns, zip expansion; formulas are never evaluated and cells starting with `=`, `+`, `-`, `@` are refused or neutralised in input and in any export; staged rows are re-validated in SQL on commit; `create_or_update` needs an explicit confirmation flag and an audit entry listing the SKUs changed.

## 7. Sourcing request statuses and Phase 6 hand-off
`submitted -> acknowledged | clarification_requested -> (buyer replies) -> acknowledged | closed | withdrawn`. Identity (`id`, `reference`), participants (`buyer_org_id`, `partner_org_id`, `supplier_id`), statuses, and **line items** (`sourcing_request_items`) are the Phase 6 interface: Phase 6 adds more lines per request, a `request_kind` (`catalogue_price | any_product`), supplier matching, quotation, samples and repeat orders in its own tables from `000150`. Phase 6 must not change section 4 columns; it may add columns/tables. Quotation reuse is decided in Phase 6 after a review of the Phase 4 quote model for international terms.

## 8. Out of scope (do not build)
Paid supplier APIs, SSM verification API, escrow, payments, shipment booking, customs, funding APIs, scraping, any currency conversion, supplier self-service accounts (the schema allows adding them later: `suppliers.partner_org_id` can be joined by an optional `owner_org_id` in a later migration).

## 9. Changes to Phase 1-4 objects
Only additive: new `role_permissions` rows and a notification kind list (kinds are free text); `src/lib/permissions.ts`, `src/lib/errors.ts`, site header (one "Products from India" link under Find), `messages/*.json`. No Phase 1-4 function is redefined.

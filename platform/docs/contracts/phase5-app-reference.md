# Phase 5 app reference (foundation layer)

What the three UI areas (partner, catalogue/buyer, admin catalogue) build on. Database side: `phase5-rpc-reference.md`. Everything here is already on the branch; do not re-implement it.

## Service functions (`src/server/services/`)
All return `Result<T>` = `{ ok: true, data } | { ok: false, errorKey, detail? }`. `errorKey` is a key under `errors.*` (always exists). `detail` is the field name or 1-based index after `:` in a validator key (for example `too_long:description` gives `errorKey: 'too_long', detail: 'description'`); show it only as a hint. First argument is the Supabase client of the signed-in user (`session.supabase`), or the cookie client for public reads. Types for every return shape are in `p5-types.ts` (mirrors the RPC reference).

**`p5-partner.ts`**: `savePartnerProfile`, `acceptPartnerInvitation` (turns the non-raising PT404 payload into `invalid_invitation`), `getPartnerProfile` (table read), `listMySuppliers`, `getSupplier`, `saveSupplierDraft(db, org, supplierId|null, data, expectedVersion|null)`, `submitSupplier`, `withdrawSupplierSubmission`, `removeSupplierDocument` (returns the storage path: the action then deletes the object with `priv.deleteFromBucket(priv.DOCS_BUCKET, path)`), `listMyProducts`, `getMyProduct`, `saveProductDraft(db, org, supplier, productId|null, data, expectedVersion|null)`, `submitProduct`, `publishProduct`, `unpublishProduct`, `updateProductMedia`, `removeProductMedia` (returns the path: delete with `priv.deleteFromBucket(priv.MEDIA_BUCKET, path)`), `stageImport`, `commitImport`, `cancelImport`, `listImports`, `getImport`, `listPartnerRequests`, `getPartnerRequest`, `respondSourcingRequest`, `closeSourcingRequest`.
Version rules: supplier save/submit take `draft_version`; product save/submit take `draft_version`; product publish and admin product review take `products.version`; supplier review takes `draft_submitted_version`.

**`p5-buyer.ts`**: `searchCatalogue(db, {q, category, supplier, moqMax, priceMin, priceMax, currency, offset, limit})`, `getCatalogueItem`, `compareItems` (max 4), `getProductMediaAccess` (server routes only), `saveProduct`, `unsaveProduct`, `listSavedProducts`, `submitSourcingRequest`, `listMySourcingRequests`, `getSourcingRequest`, `replySourcingRequest`, `withdrawSourcingRequest`, `reportProduct`. Constants `CATALOGUE_PAGE_SIZE = 20`, `MAX_COMPARE = 4`. The public reads work with a session-less client.

**`p5-admin.ts`**: `provisionPartner`, `resendPartnerInvitation` (both return the raw token: mail it from the server action, never send it to the browser), `listPartnerOrgs`, `approvePartner`, `suspendPartner`, `listSupplierReviews`, `reviewSupplier`, `suspendSupplier`, `reinstateSupplier`, `listProductReviews`, `getProductForReview`, `reviewProduct`, `suspendProduct`, `reinstateProduct`, `listProductReports`, `handleProductReport`, `catalogueStats`.

Not wrapped on purpose: the `service_*` RPCs (privileged, used by the upload routes through `src/server/privileged.ts`).

## Shared schemas (`src/lib/schemas.ts`, all issue messages are `errors.*` keys)
Money is always a decimal string: `moneySchema()` returns a canonical string with exactly 2 decimals ("250" becomes "250.00"; "1,250.50" is accepted; "1,100" is refused as ambiguous). Never use floats.
Supplier: `supplierStep1Schema` (basics, optional `code` on create), `supplierStep2Schema` (description 20+, `capabilities` as lines/commas, max 10), `supplierStep3Schema` (contact, `registration_id` blank or `registration_not_sure` for "not sure", website), `supplierSubmitSchema`, `supplierWithdrawSchema`, `supplierDocUploadMetaSchema`; `supplierDraftData(parsed)` builds `p_data`.
Product: `productCreateSchema` (SKU required), `productUpdateSchema`, `productSubmitSchema`, `productPublishSchema`, `productUnpublishSchema`, `productMediaUpdateSchema`, `productMediaRemoveSchema`; `productDraftData(parsed)` builds `p_data`. `tiers`/`variants` accept a JSON string (hidden field) or an array; `specs` accepts `key: value` lines or JSON. Constants `PRODUCT_CATEGORY_SLUGS`, `PRODUCT_CURRENCIES`, `PRODUCT_PRICE_MODES`, `PRODUCT_AVAILABILITY`, `PRODUCT_UNITS`.
Import: `importModeSchema`, `importStageMetaSchema`, `importCommitSchema`, `importCancelSchema`.
Sourcing: `sourcingRequestSchema` (`items` JSON array of 1-20 lines, `key` idempotency key 8-80 chars generated once per form), `sourcingReplySchema`, `sourcingWithdrawSchema`, `sourcingRespondSchema`, `sourcingCloseSchema`.
Buyer misc: `savedProductSchema`, `productReportSchema`, `catalogueSearchSchema` (tolerant: bad query values are dropped).
Admin: `supplierDecisionSchema` (pass `checks: formData.getAll('checks')`), `productDecisionSchema`, `catalogueSuspendSchema`, `productReportDecisionSchema`, `partnerProvisionSchema`, `partnerDecisionSchema`, `partnerProfileSchema`.
`parseForm()` only maps issue messages listed in `SCHEMA_ERROR_KEYS`; the Phase 5 keys are included (`P5_SCHEMA_ERROR_KEYS`).

## Errors (`src/lib/errors.ts`)
All Phase 5 static keys are in `KNOWN_MESSAGE_KEYS`; validator keys in `P5_VALIDATOR_KEYS` map by the part before the first `:`; any other `<field>_required` maps to `field_required`, and an unknown `invalid_<field>` (HTTP 422) to `field_invalid`. `rpcErrorDetail(error)` returns the detail. Messages for all of them are in `messages/p5/common.*.json` under the top-level `errors` object (see merging below).

## Messages
`src/i18n/messages.ts` now DEEP-merges the area files, so an area file may add keys to an existing namespace (the common file adds the Phase 5 error messages to `errors`). Top-level namespaces:
* `p5common` (owned by foundation): `nav.catalogue`, `nav.partnerDashboard`; `buttons.*` (saveDraft, submitForReview, addSupplier, addProduct, uploadProducts, findProducts, requestPrice, viewRequests, saveChanges); `status.supplier|product|partner|sourcing|import|importRow|scan.*`; `verification.reviewedOn|notReviewed|scope|checks.*`; `availability.*` (labels, `confirmedOn`, `outdated`); `price.*` (tiers, fixed, request, from, onRequest, confirmedOn, note); `labels.*` (moq, leadTime, leadTimeRange, leadTimeSingle, supplier, country, sku); `units.<unit>`; `categories.<slug>`; `currencies.INR|MYR|USD`; `docTypes.*` (supplier documents); `reportReasons.*`.
* `p5partner.nav.*` (foundation, nav labels only: label, menu, home, suppliers, products, import, requests, notifications, settings). The partner agent owns the rest of `p5partner`; keep `nav` intact.
* `p5buyer`, `p5admin`: empty, owned by the catalogue and admin agents. Each area file must keep identical keys and `{placeholders}` in en/ta/ms (the messages test checks this and lints wording: no "verified", "guarantee", "trusted", "official check").
Test helper `tests/e2e/support/i18n.ts` also deep-merges.

## Helpers
* `src/lib/p5-format.ts`: `reviewedSummary(t, {checks, reviewed_at}, locale)` (the only way to word verification: "MITRA reviewed documents ... What was checked: ..."; `t` is the `p5common` translator), `formatMoney(amount, currency, locale)` (display only), `formatDate`, `leadTimeLabel`.
* `src/lib/permissions.ts`: `canManageSuppliers`, `canManageCatalogue`, `canRespondToSourcing`, `canReviewCatalogue`, `canModerateCatalogue`, `canManagePartners` (UI hints; the database enforces).
* `src/server/partner-context.ts`: `requirePartnerContext(locale, orgId, path)` returns `{session, org, role, perms, profile, approved, canManageSuppliers, canManageCatalogue, canRespond}`; 404 unless a member of a `partner` org; MFA is enforced for partner owners by `requireSession`. Every partner PAGE must call it (a layout is not re-run on client navigation). `approved` is false until MITRA approves the partner: show the "waiting for approval" state and expect `partner_not_approved` from write RPCs.
* `src/components/PartnerNav.tsx` (client) and the partner layout `src/app/[locale]/orgs/[id]/partner/layout.tsx` (sidebar Home, Suppliers, Products, Import Catalogue, Buyer Requests, Notifications, Settings). Routes it links to: `/orgs/[id]/partner`, `/suppliers`, `/products`, `/import`, `/requests`, `/notifications`, `/settings`. Only Home exists (stub: the partner agent replaces `page.tsx`).
* `src/lib/image-upload.ts`, `src/server/services/p5-files.ts`: pure image/document pipelines (used by the routes; reuse, do not copy).
* `src/server/privileged.ts` (route handlers and server actions only): `MEDIA_BUCKET`, `uploadToBucket`, `downloadFromBucket`, `deleteFromBucket`, `registerSupplierDocument`, `registerProductMedia`, `setSupplierDocumentScan`, `setProductMediaScan`, `listUnscannedSupplierDocuments`, `listUnscannedProductMedia`. The architecture test pins this export list.

## CSS (end of `src/app/globals.css`, block "Phase 5 additions")
`.partner-shell`, `.partner-side`, `.partner-content`, `.partner-org`, `.partner-nav`, `.partner-nav-toggle`, `.partner-nav-list` (shell: one column up to 720px, sidebar from 721px; `main` widens to 72rem only on pages that contain `.partner-shell`); `.p5-grid` (responsive card grid), `.p5-thumb` (4:3 image), `.p5-price`, `.p5-stat`. Existing classes (`card`, `card-list`, `chip`, `table-wrap`, `table.stack`, `dl`, `btn*`, `field`) are unchanged: reuse them.

## File routes (all under `/api/v1`)
| Route | Auth | Notes |
|---|---|---|
| `POST /suppliers/[id]/documents` | signed in, member of the supplier's partner org with `supplier:manage`, MFA for owners | multipart `file` + `docType` (business_registration, tax_registration, export_licence, trade_reference, catalogue, other); pdf/png/jpeg, 10 MiB; same-origin required; Content-Length required and bounded; throttled; scanned before storing; scanner down = stored `pending`, never served. JSON `{ok:true,id,scanStatus}` (201) or `{ok:false,errorKey}` (translate `errors.<key>`; 401/403/404/411/413/415/422/429). |
| `GET /suppliers/[id]/documents/[docId]` | member with `supplier:manage`, or MITRA reviewer (locked docs), via `get_supplier_document_access` | clean documents only; attachment, `no-store`, nosniff; 404 for everything else; the object must sit under `supplier/<org>/<id>/`. |
| `POST /products/[id]/media` | member with `catalogue:manage`, MFA for owners | multipart `file` (png/jpeg/webp, 5 MiB, max 8 per product, pixel-bounded, EXIF/XMP stripped) + optional `alt`. Same response shape. 409 `media_limit_reached`. |
| `GET /catalogue-media/[id]` | anonymous allowed | asks `get_product_media_access`; image only for an approved, clean image of a published product (or to its partner members / reviewers); `Cache-Control: private, no-cache` + ETag, so every use is re-authorised (unpublishing takes effect at once); `nosniff`; 404 otherwise. Use `<img src="/api/v1/catalogue-media/<media id>" alt=...>` with the `alt` from the item and explicit width/height. |
| `POST /jobs/rescan` (existing) | bearer `CRON_SECRET` | now also rescans supplier documents and product images (`supplier_documents`, `product_media` summaries in the response). |

Client upload example: `fetch('/api/v1/products/' + id + '/media', { method: 'POST', body: formData })` (same-origin; do not set Content-Type).

## Tests
`tests/unit/p5-foundation.test.ts` (wrapper argument and error mapping with a fake Db, schemas, messages, format helpers, image and pipeline logic, route guards), `tests/integration/p5-files.test.ts` (real local stack: buckets, scan states, access RPCs, full publish flow), `tests/integration/p5-http.test.ts` (opt-in against a running app: `P5_HTTP_BASE=http://127.0.0.1:3500`; skipped in CI).

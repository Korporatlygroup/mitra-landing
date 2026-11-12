import { failFrom, ok, type Db, type Result } from './result';
import type {
  AcceptPartnerInvitation,
  ImportCommitted,
  ImportJobDetail,
  ImportJobRow,
  ImportKind,
  ImportMode,
  ImportRowInput,
  ImportStaged,
  MyProduct,
  Page,
  PagedWithLimit,
  PartnerProfileSaved,
  PartnerStatus,
  ProductData,
  ProductSaved,
  ProductStatus,
  ProductSubmitted,
  SourcingRequestDetail,
  SourcingRequestRow,
  SourcingRespondAction,
  SourcingResponded,
  SourcingStatus,
  SupplierDetail,
  SupplierDraftData,
  SupplierSaved,
  SupplierSummary,
  ProductSummary,
} from './p5-types';

/**
 * Phase 5, partner side (a member of a `partner` organisation, acting with their own session).
 * One function per RPC (docs/contracts/phase5-rpc-reference.md). Each returns a Result and never throws for expected failures.
 * `expectedVersion` rules: supplier -> `draft_version`; product save/submit -> `draft_version`; product publish -> `version`.
 */

async function rpc<T>(db: Db, fn: string, args: Record<string, unknown>): Promise<Result<T>> {
  const { data, error } = await db.rpc(fn, args);
  return error ? failFrom(error) : ok(data as T);
}

// ------------------------------------------------------------------------------------------------ partner organisation

/** Creates the pending partner profile of a self-created partner organisation (needs org:manage). */
export const savePartnerProfile = (db: Db, orgId: string, displayName: string, contactEmail: string) =>
  rpc<PartnerProfileSaved>(db, 'save_partner_profile', { p_org: orgId, p_display_name: displayName, p_contact_email: contactEmail });

/**
 * Accepts the owner invitation for an admin-provisioned partner organisation. The RPC does not raise for a bad token:
 * it returns `{code:'PT404', message:'invalid_invitation'}`, which is turned into an `invalid_invitation` failure here.
 */
export async function acceptPartnerInvitation(db: Db, token: string): Promise<Result<{ org_id: string; role: 'owner' }>> {
  const r = await rpc<AcceptPartnerInvitation>(db, 'accept_partner_invitation', { p_token: token });
  if (!r.ok) return r;
  if ('code' in r.data) return { ok: false, errorKey: 'invalid_invitation' };
  return ok(r.data);
}

// ------------------------------------------------------------------------------------------------ suppliers

export const listMySuppliers = (db: Db, orgId: string) => rpc<{ items: SupplierSummary[] }>(db, 'list_my_suppliers', { p_org: orgId });

export const getSupplier = (db: Db, supplierId: string) => rpc<SupplierDetail>(db, 'get_supplier', { p_supplier: supplierId });

/** `supplierId` null creates a supplier (`data.code` is accepted on create only; `expectedVersion` is ignored on create). */
export const saveSupplierDraft = (db: Db, orgId: string, supplierId: string | null, data: SupplierDraftData, expectedVersion: number | null) =>
  rpc<SupplierSaved>(db, 'save_supplier_draft', {
    p_org: orgId,
    p_supplier: supplierId,
    p_data: data,
    p_expected_version: expectedVersion,
  });

export const submitSupplier = (db: Db, orgId: string, supplierId: string, expectedVersion: number) =>
  rpc<null>(db, 'submit_supplier', { p_org: orgId, p_supplier: supplierId, p_expected_version: expectedVersion });

export const withdrawSupplierSubmission = (db: Db, orgId: string, supplierId: string) =>
  rpc<null>(db, 'withdraw_supplier_submission', { p_org: orgId, p_supplier: supplierId });

/** Marks a supplier document removed and returns its storage path; the caller (a server action) then deletes the object. */
export const removeSupplierDocument = (db: Db, docId: string) => rpc<string>(db, 'remove_supplier_document', { p_doc: docId });

// ------------------------------------------------------------------------------------------------ products

export interface ListMyProductsOptions {
  supplierId?: string | null;
  status?: ProductStatus | null;
  offset?: number;
  limit?: number;
}

export const listMyProducts = (db: Db, orgId: string, o: ListMyProductsOptions = {}) =>
  rpc<PagedWithLimit<ProductSummary>>(db, 'list_my_products', {
    p_org: orgId,
    p_supplier: o.supplierId ?? null,
    p_status: o.status ?? null,
    p_offset: o.offset ?? 0,
    p_limit: o.limit ?? 25,
  });

export const getMyProduct = (db: Db, orgId: string, productId: string) => rpc<MyProduct>(db, 'get_my_product', { p_org: orgId, p_product: productId });

/** `productId` null creates (`data.sku` required, immutable afterwards). Merge semantics: null/'' removes a key; tiers, variants, specs replace wholesale. */
export const saveProductDraft = (db: Db, orgId: string, supplierId: string, productId: string | null, data: ProductData, expectedVersion: number | null) =>
  rpc<ProductSaved>(db, 'save_product_draft', {
    p_org: orgId,
    p_supplier: supplierId,
    p_product: productId,
    p_data: data,
    p_expected_version: expectedVersion,
  });

/** `expectedVersion` is the product `draft_version`. Strict validation: the first error key is the failure. */
export const submitProduct = (db: Db, orgId: string, productId: string, expectedVersion: number) =>
  rpc<ProductSubmitted>(db, 'submit_product', { p_org: orgId, p_product: productId, p_expected_version: expectedVersion });

/** `expectedVersion` is `products.version`. */
export const publishProduct = (db: Db, orgId: string, productId: string, expectedVersion: number) =>
  rpc<null>(db, 'publish_product', { p_org: orgId, p_product: productId, p_expected_version: expectedVersion });

export const unpublishProduct = (db: Db, orgId: string, productId: string) => rpc<null>(db, 'unpublish_product', { p_org: orgId, p_product: productId });

// ------------------------------------------------------------------------------------------------ product media (metadata; files go through /api/v1/products/[id]/media)

export const updateProductMedia = (db: Db, mediaId: string, alt: string | null, sort: number) =>
  rpc<null>(db, 'update_product_media', { p_media: mediaId, p_alt: alt, p_sort: sort });

/** Returns the storage path; the caller (a server action) then deletes the object with the service client. */
export const removeProductMedia = (db: Db, mediaId: string) => rpc<string>(db, 'remove_product_media', { p_media: mediaId });

// ------------------------------------------------------------------------------------------------ imports

/** Stages parsed rows (1-2000, 8 MB). Idempotent per (partner, supplier, sha256, mode). Rows are built by `canonicalRowsForRpc` in @/server/import. */
export const stageImport = (db: Db, orgId: string, supplierId: string, mode: ImportMode, fileName: string, sha256: string, rows: ImportRowInput[]) =>
  rpc<ImportStaged>(db, 'stage_import', {
    p_partner_org: orgId,
    p_supplier: supplierId,
    p_mode: mode,
    p_file_name: fileName,
    p_sha256: sha256,
    p_rows: rows,
  });

/** `confirmOverwrite` must be true for `create_or_update` jobs (422 `overwrite_confirmation_required` otherwise). Writes drafts only. */
export const commitImport = (db: Db, jobId: string, confirmOverwrite: boolean) =>
  rpc<ImportCommitted>(db, 'commit_import', { p_job: jobId, p_confirm_overwrite: confirmOverwrite });

export const cancelImport = (db: Db, jobId: string) => rpc<null>(db, 'cancel_import', { p_job: jobId });

export const listImports = (db: Db, orgId: string, supplierId: string | null = null, offset = 0) =>
  rpc<Page<ImportJobRow>>(db, 'list_imports', { p_org: orgId, p_supplier: supplierId, p_offset: offset });

/** 100 rows per page. */
export const getImport = (db: Db, orgId: string, jobId: string, kind: ImportKind = 'problems', offset = 0) =>
  rpc<ImportJobDetail>(db, 'get_import', { p_org: orgId, p_job: jobId, p_kind: kind, p_offset: offset });

// ------------------------------------------------------------------------------------------------ buyer requests (partner inbox)

export const listPartnerRequests = (db: Db, orgId: string, status: SourcingStatus | null = null, offset = 0) =>
  rpc<Page<SourcingRequestRow>>(db, 'list_partner_requests', { p_org: orgId, p_status: status, p_offset: offset });

/** Works for both sides; the partner side sees `buyer_name` and `partner_org_id`. */
export const getPartnerRequest = (db: Db, requestId: string) => rpc<SourcingRequestDetail>(db, 'get_sourcing_request', { p_request: requestId });

/** `clarify` needs a note of at least 5 characters. */
export const respondSourcingRequest = (db: Db, requestId: string, action: SourcingRespondAction, note: string | null, expectedVersion: number | null = null) =>
  rpc<SourcingResponded>(db, 'respond_sourcing_request', {
    p_request: requestId,
    p_action: action,
    p_note: note,
    p_expected_version: expectedVersion,
  });

export const closeSourcingRequest = (db: Db, requestId: string, note: string | null) =>
  rpc<null>(db, 'close_sourcing_request', { p_request: requestId, p_note: note });

// ------------------------------------------------------------------------------------------------ partner profile (table read, RLS: members and partner:manage)

export interface PartnerProfileRow {
  org_id: string;
  status: PartnerStatus;
  display_name: string;
  contact_email: string | null;
  decision_reason: string | null;
  decided_at: string | null;
  version: number;
}

/** Null when the organisation has no partner profile yet (a self-created partner org before save_partner_profile), or is not visible. */
export async function getPartnerProfile(db: Db, orgId: string): Promise<PartnerProfileRow | null> {
  const { data } = await db
    .from('partner_profiles')
    .select('org_id,status,display_name,contact_email,decision_reason,decided_at,version')
    .eq('org_id', orgId)
    .maybeSingle();
  return (data as PartnerProfileRow | null) ?? null;
}

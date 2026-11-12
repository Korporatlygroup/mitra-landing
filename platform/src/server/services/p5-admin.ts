import { failFrom, ok, type Db, type Result } from './result';
import type {
  CatalogueStats,
  Page,
  PartnerOrgRow,
  PartnerStatus,
  ProductForReview,
  ProductReportRow,
  ProductReviewRow,
  ProvisionedPartner,
  SupplierReviewCheck,
  SupplierReviewRow,
} from './p5-types';

/**
 * Phase 5, MITRA reviewers and moderators. Permissions are enforced by the database
 * (supplier:review, catalogue:review, catalogue:moderate, partner:manage, report:view). Reviewers cannot decide on a partner they
 * were ever a member of or provisioned (403 `conflict_of_interest`).
 *
 * `provisionPartner` and `resendPartnerInvitation` return the raw invitation token: the caller (a server action) must mail it
 * (see invite-email) and never return it to the browser.
 */

async function rpc<T>(db: Db, fn: string, args: Record<string, unknown>): Promise<Result<T>> {
  const { data, error } = await db.rpc(fn, args);
  return error ? failFrom(error) : ok(data as T);
}

// ------------------------------------------------------------------------------------------------ partners

export const provisionPartner = (db: Db, name: string, ownerEmail: string, displayName: string) =>
  rpc<ProvisionedPartner>(db, 'provision_partner', { p_name: name, p_owner_email: ownerEmail, p_display_name: displayName });

/** While the organisation has no active owner. */
export const resendPartnerInvitation = (db: Db, orgId: string, ownerEmail: string) =>
  rpc<ProvisionedPartner>(db, 'resend_partner_invitation', { p_org: orgId, p_owner_email: ownerEmail });

export const listPartnerOrgs = (db: Db, status: PartnerStatus | null = null, offset = 0) =>
  rpc<Page<PartnerOrgRow>>(db, 'list_partner_orgs', { p_status: status, p_offset: offset });

/** Approves a pending partner, or reinstates a suspended one. */
export const approvePartner = (db: Db, orgId: string, reason: string | null) => rpc<null>(db, 'approve_partner', { p_org: orgId, p_reason: reason });
/** Reason of at least 5 characters. */
export const suspendPartner = (db: Db, orgId: string, reason: string) => rpc<null>(db, 'suspend_partner', { p_org: orgId, p_reason: reason });

// ------------------------------------------------------------------------------------------------ suppliers

export const listSupplierReviews = (db: Db, scope: 'pending' | 'all' = 'pending', offset = 0) =>
  rpc<Page<SupplierReviewRow>>(db, 'list_supplier_reviews', { p_scope: scope, p_offset: offset });

export type SupplierDecision = 'approve' | 'reject' | 'request_info';

/**
 * `expectedVersion` is the supplier's `draft_submitted_version`. Reason (5+ characters) is required for reject / request_info.
 * Approve needs 1-6 distinct checks from SUPPLIER_REVIEW_CHECKS.
 */
export const reviewSupplier = (db: Db, supplierId: string, decision: SupplierDecision, reason: string | null, checks: SupplierReviewCheck[], expectedVersion: number) =>
  rpc<null>(db, 'review_supplier', {
    p_supplier: supplierId,
    p_decision: decision,
    p_reason: reason,
    p_checks: checks,
    p_expected_version: expectedVersion,
  });

export const suspendSupplier = (db: Db, supplierId: string, reason: string) => rpc<null>(db, 'suspend_supplier', { p_supplier: supplierId, p_reason: reason });
/** Needs supplier:review (not catalogue:moderate). */
export const reinstateSupplier = (db: Db, supplierId: string, reason: string) => rpc<null>(db, 'reinstate_supplier', { p_supplier: supplierId, p_reason: reason });

// ------------------------------------------------------------------------------------------------ products

export const listProductReviews = (db: Db, offset = 0) => rpc<Page<ProductReviewRow>>(db, 'list_product_reviews', { p_offset: offset });

export const getProductForReview = (db: Db, productId: string) => rpc<ProductForReview>(db, 'get_product_for_review', { p_product: productId });

export type ProductDecision = 'approve' | 'reject' | 'request_changes';

/** `expectedVersion` is `products.version`. */
export const reviewProduct = (db: Db, productId: string, decision: ProductDecision, reason: string | null, expectedVersion: number) =>
  rpc<null>(db, 'review_product', { p_product: productId, p_decision: decision, p_reason: reason, p_expected_version: expectedVersion });

export const suspendProduct = (db: Db, productId: string, reason: string) => rpc<null>(db, 'suspend_product', { p_product: productId, p_reason: reason });
export const reinstateProduct = (db: Db, productId: string, reason: string) => rpc<null>(db, 'reinstate_product', { p_product: productId, p_reason: reason });

// ------------------------------------------------------------------------------------------------ reports and stats

export const listProductReports = (db: Db, status: 'open' | 'actioned' | 'dismissed' = 'open', offset = 0) =>
  rpc<Page<ProductReportRow>>(db, 'list_product_reports', { p_status: status, p_offset: offset });

export const handleProductReport = (db: Db, reportId: string, action: 'dismiss' | 'suspend_product', note: string) =>
  rpc<null>(db, 'handle_product_report', { p_report: reportId, p_action: action, p_note: note });

/** Real counts only; rates are null when there is no data. */
export const catalogueStats = (db: Db) => rpc<CatalogueStats>(db, 'catalogue_stats', {});

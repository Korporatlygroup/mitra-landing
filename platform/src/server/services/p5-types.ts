/**
 * Phase 5 JSON shapes returned by the database RPCs. Mirrors docs/contracts/phase5-rpc-reference.md exactly.
 * Types only (no runtime code beyond constant lists), so it can be imported from server and client components alike.
 * Money is a decimal STRING in forms and a string/number from the database: never do arithmetic on it with floats.
 */

// ----------------------------------------------------------------------------------------- vocabularies

export type PartnerStatus = 'pending' | 'approved' | 'suspended';
export type SupplierStatus = 'draft' | 'awaiting_review' | 'approved' | 'rejected' | 'more_info_needed' | 'suspended';
export type ProductStatus = 'draft' | 'submitted' | 'approved' | 'changes_requested' | 'rejected' | 'published' | 'unpublished' | 'suspended';
export type RevisionStatus = 'submitted' | 'changes_requested' | 'approved' | 'rejected' | 'published' | 'superseded';
export type SourcingStatus = 'submitted' | 'acknowledged' | 'clarification_requested' | 'closed' | 'withdrawn';
export type ImportMode = 'create_only' | 'create_or_update';
export type ImportJobStatus = 'previewed' | 'failed' | 'committed' | 'cancelled';
export type ImportRowStatus = 'valid' | 'invalid' | 'duplicate';
export type ImportKind = 'problems' | 'valid' | 'all';
export type PriceMode = 'tiers' | 'fixed' | 'request';
export type AvailabilityStatus = 'available' | 'made_to_order' | 'limited' | 'unavailable';
export type Currency = 'INR' | 'MYR' | 'USD';
export type ScanStatus = 'pending' | 'clean' | 'infected' | 'failed';

export const SUPPLIER_DOC_TYPES = ['business_registration', 'tax_registration', 'export_licence', 'trade_reference', 'catalogue', 'other'] as const;
export type SupplierDocType = (typeof SUPPLIER_DOC_TYPES)[number];

export const SUPPLIER_REVIEW_CHECKS = [
  'contact_reachable',
  'registration_document_seen',
  'address_consistent',
  'catalogue_consistent',
  'trade_reference',
  'identity_document_seen',
] as const;
export type SupplierReviewCheck = (typeof SUPPLIER_REVIEW_CHECKS)[number];

export const REPORT_PRODUCT_REASONS = ['misleading', 'counterfeit', 'prohibited', 'wrong_price', 'offensive', 'spam', 'other'] as const;
export type ProductReportReason = (typeof REPORT_PRODUCT_REASONS)[number];

// ----------------------------------------------------------------------------------------- shared

export interface Page<T> {
  offset: number;
  total: number;
  items: T[];
}
export interface PagedWithLimit<T> extends Page<T> {
  limit: number;
}

// ----------------------------------------------------------------------------------------- partners

export interface PartnerProfileSaved {
  org_id: string;
  status: PartnerStatus;
  created: boolean;
}
export interface ProvisionedPartner {
  org_id: string;
  invitation_id: string;
  /** Raw invitation token. Mail it from the server; never render it back to the browser. */
  token: string;
}
export type AcceptPartnerInvitation = { org_id: string; role: 'owner' } | { code: 'PT404'; message: 'invalid_invitation' };
export interface PartnerOrgRow {
  org_id: string;
  name: string;
  display_name: string | null;
  status: PartnerStatus;
  provisioned: boolean;
  created_at: string;
  decided_at: string | null;
  decision_reason: string | null;
  conflict_of_interest: boolean;
}

// ----------------------------------------------------------------------------------------- suppliers

export interface SupplierSummary {
  id: string;
  partner_org_id: string;
  code: string;
  status: SupplierStatus;
  name: string | null;
  country: string | null;
  draft_version: number;
  draft_submitted_version: number | null;
  live_draft_version: number | null;
  has_unsubmitted_changes: boolean;
  /** Optimistic lock of the supplier row. */
  version: number;
  reviewed_at: string | null;
  review_checks: SupplierReviewCheck[] | null;
  decision_reason: string | null;
  submitted_at: string | null;
  updated_at: string;
}

/** Supplier draft fields (keys of p_data of save_supplier_draft). Contact fields are private and never public. */
export interface SupplierDraftData {
  name?: string;
  country?: string;
  state_city?: string;
  main_category?: string;
  description?: string;
  capabilities?: string[];
  code?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  registration_id?: string;
  website?: string;
}

export interface SupplierLive {
  name: string | null;
  country: string | null;
  state_city: string | null;
  main_category: string | null;
  description: string | null;
  capabilities: string[] | null;
}
export interface SupplierPrivate {
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  registration_id: string | null;
  website: string | null;
  updated_at: string;
}
export interface SupplierDocument {
  id: string;
  doc_type: SupplierDocType;
  display_name: string;
  mime_type: string;
  size_bytes: number;
  scan_status: ScanStatus;
  locked: boolean;
  created_at: string;
}
export interface SupplierEvent {
  kind: string;
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  at: string;
}
export interface SupplierDetail extends SupplierSummary {
  draft: SupplierDraftData;
  live: SupplierLive;
  private: SupplierPrivate | null;
  suspended_reason: string | null;
  documents: SupplierDocument[];
  events: SupplierEvent[];
}
export interface SupplierSaved {
  id: string;
  code: string;
  version: number;
  status: SupplierStatus;
}
export interface SupplierReviewRow extends SupplierSummary {
  partner_name: string | null;
  conflict_of_interest: boolean;
}
export interface SupplierDocumentAccess {
  storage_path: string;
  mime_type: string;
  display_name: string;
}

// ----------------------------------------------------------------------------------------- products

export interface ProductTierInput {
  min_qty: number;
  max_qty: number | null;
  unit_price: string;
  variant_sku?: string;
}
export interface ProductVariantInput {
  sku: string;
  label: string;
  attributes: Record<string, string>;
  moq?: number;
}

/** Flat product data (draft and import row shape). Money as decimal strings with at most 2 decimals. */
export interface ProductData {
  sku?: string;
  name?: string;
  description?: string;
  category_slug?: string;
  unit?: string;
  moq?: number | string;
  currency?: Currency;
  price_mode?: PriceMode;
  unit_price?: string;
  tiers?: ProductTierInput[];
  variants?: ProductVariantInput[];
  lead_time_min_days?: number | string;
  lead_time_max_days?: number | string;
  availability_status?: AvailabilityStatus;
  availability_confirmed_on?: string;
  price_confirmed_on?: string;
  specs?: Record<string, string>;
  packaging?: string;
}

export interface PendingRevision {
  id: string;
  rev_no: number;
  status: RevisionStatus;
  reason: string | null;
  decided_at: string | null;
}
export interface ProductSummary {
  id: string;
  supplier_id: string;
  sku: string;
  status: ProductStatus;
  name: string | null;
  /** products.version: pass to review_product and publish_product. */
  version: number;
  /** draft_version: pass to save_product_draft and submit_product. */
  draft_version: number;
  live_revision_id: string | null;
  pending_revision: PendingRevision | null;
  has_unsubmitted_changes: boolean;
  published_at: string | null;
  updated_at: string;
}
export interface ProductRevisionRow {
  id: string;
  rev_no: number;
  status: RevisionStatus;
  reason?: string | null;
  submitted_at?: string | null;
  decided_at?: string | null;
  [k: string]: unknown;
}
export interface MyProductMedia {
  id: string;
  alt: string | null;
  sort: number;
  scan_status?: ScanStatus;
  mime_type?: string;
  [k: string]: unknown;
}
export interface MyProduct extends ProductSummary {
  draft: ProductData;
  suspended_reason: string | null;
  revisions: ProductRevisionRow[];
  media: MyProductMedia[];
}
export interface ProductSaved {
  id: string;
  sku: string;
  version: number;
  draft_version: number;
  status: ProductStatus;
}
export interface ProductSubmitted {
  id: string;
  revision_id: string;
  rev_no: number;
  created: boolean;
}
export interface ProductMediaAccess {
  storage_path: string;
  mime_type: string;
}
export interface ProductReviewRow extends ProductSummary {
  revision_no: number;
  submitted_at: string;
  supplier_name: string | null;
  partner_name: string | null;
  conflict_of_interest: boolean;
}
export interface ProductForReview extends ProductSummary {
  revision: { id: string; rev_no: number; status: RevisionStatus; data: ProductData; reason: string | null; submitted_at: string } | null;
  live_revision: ProductData | null;
  supplier: SupplierSummary | null;
  media: { id: string; alt: string | null; sort: number }[];
  conflict_of_interest: boolean;
}

// ----------------------------------------------------------------------------------------- imports

export interface ImportCounts {
  total: number;
  valid: number;
  invalid: number;
  duplicate: number;
}
export interface ImportProblemRow {
  row_no: number;
  sku: string | null;
  status: ImportRowStatus;
  action?: string | null;
  errors: string[];
  name: string | null;
}
export interface ImportStaged {
  job_id: string;
  created: boolean;
  status: Exclude<ImportJobStatus, 'cancelled'>;
  counts: ImportCounts;
  rows: ImportProblemRow[];
}
export interface ImportCommitted {
  job_id: string;
  status: 'committed';
  created: number;
  updated: number;
  skipped: number;
  repeat: boolean;
}
export interface ImportJobRow {
  id: string;
  supplier_id: string;
  mode: ImportMode;
  status: ImportJobStatus;
  file_name: string;
  counts: ImportCounts;
  created_at: string;
  committed_at: string | null;
}
export interface ImportJobDetail extends ImportJobRow {
  rows: ImportProblemRow[];
  [k: string]: unknown;
}
/** A row for stage_import: flat product data plus `_row` and optional `_client_invalid`. */
export type ImportRowInput = ProductData & { _row?: number; _client_invalid?: string[] };

// ----------------------------------------------------------------------------------------- catalogue (public + buyers)

export interface CatalogueSupplierRef {
  id: string;
  name: string;
  country: string | null;
  state_city: string | null;
  reviewed: { checks: SupplierReviewCheck[]; reviewed_at: string } | null;
}
export interface CatalogueItem {
  id: string;
  sku: string;
  name: string;
  category_slug: string;
  unit: string;
  moq: number;
  currency: Currency;
  price_mode: PriceMode;
  /** Lowest tier price or the fixed price; null for price-on-request. Decimal string/number from the database: display only. */
  from_price: string | number | null;
  price_confirmed_on: string | null;
  lead_time_min_days: number | null;
  lead_time_max_days: number | null;
  availability_status: AvailabilityStatus;
  availability_confirmed_on: string | null;
  /** True when the availability was last confirmed more than 90 days ago. */
  availability_outdated: boolean;
  published_at: string;
  summary: string | null;
  image_id: string | null;
  supplier: CatalogueSupplierRef;
}
export interface CatalogueVariant {
  id: string;
  sku: string;
  label: string;
  attributes: Record<string, string>;
  moq: number | null;
}
export interface CatalogueTier {
  variant_sku: string | null;
  min_qty: number;
  max_qty: number | null;
  unit_price: string | number;
  currency: Currency;
}
export interface CatalogueItemDetail extends CatalogueItem {
  description: string | null;
  specs: Record<string, string>;
  packaging: string | null;
  variants: CatalogueVariant[];
  tiers: CatalogueTier[];
  media: { id: string; alt: string | null }[];
  supplier_detail: { description: string | null; capabilities: string[] | null; main_category: string | null };
}
export interface CatalogueSearchResult {
  total: number;
  limit: number;
  offset: number;
  items: CatalogueItem[];
  categories: string[];
}
export interface CatalogueSearchParams {
  q?: string | null;
  category?: string | null;
  supplier?: string | null;
  moqMax?: number | null;
  priceMin?: string | null;
  priceMax?: string | null;
  currency?: Currency | null;
  offset?: number;
  limit?: number;
}
export interface CompareResult {
  items: CatalogueItemDetail[];
  unavailable: string[];
}
export interface SaveProductResult {
  product_id: string;
  saved: boolean;
  created: boolean;
}
export type SavedProductRow =
  | { product_id: string; saved_at: string; available: true; item: CatalogueItem }
  | { product_id: string; saved_at: string; available: false; name: string; supplier_name: string };

// ----------------------------------------------------------------------------------------- sourcing requests

export interface SourcingItemInput {
  product_id: string;
  variant_sku?: string;
  quantity: number;
}
export interface SourcingRequestInput {
  buyerOrgId: string;
  /** 8-80 chars, stable per form instance (idempotency). */
  key: string;
  items: SourcingItemInput[];
  destinationState: string;
  destinationCity?: string | null;
  neededBy?: string | null;
  notes?: string | null;
}
export interface SourcingSubmitted {
  id: string;
  reference: string;
  status: SourcingStatus;
  created: boolean;
}
export interface SourcingRequestRow {
  id: string;
  reference: string;
  status: SourcingStatus;
  supplier_name: string | null;
  destination_state: string | null;
  needed_by: string | null;
  version: number;
  item_count: number;
  /** Partner side only. */
  buyer_name?: string | null;
  created_at: string;
  updated_at: string;
}
export interface SourcingLineSnapshot {
  name: string;
  sku: string;
  unit: string;
  moq: number;
  currency: Currency;
  price_mode: PriceMode;
  tiers?: CatalogueTier[];
  applicable_unit_price?: string | number | null;
  price_confirmed_on?: string | null;
  availability_confirmed_on?: string | null;
  variant?: { sku: string; label: string } | null;
  supplier_name?: string;
  [k: string]: unknown;
}
export interface SourcingItem {
  line_no: number;
  product_id: string | null;
  variant_id: string | null;
  quantity: number;
  unit: string;
  snapshot: SourcingLineSnapshot;
  still_available: boolean;
}
export interface SourcingEvent {
  kind: string;
  note: string | null;
  at: string;
  by: string | null;
}
export interface SourcingRequestDetail extends SourcingRequestRow {
  your_side: 'buyer' | 'partner';
  buyer_org_id?: string;
  partner_org_id?: string;
  supplier_id: string | null;
  destination_city: string | null;
  notes: string | null;
  first_response_at: string | null;
  items: SourcingItem[];
  events: SourcingEvent[];
}
export interface SourcingResponded {
  id: string;
  status: SourcingStatus;
  version: number;
}
export type SourcingRespondAction = 'acknowledge' | 'clarify';

// ----------------------------------------------------------------------------------------- admin

export interface ProductReportRow {
  id: string;
  product_id: string;
  reason: ProductReportReason;
  note: string | null;
  status: 'open' | 'actioned' | 'dismissed';
  created_at: string;
  handler_note: string | null;
  product_name: string | null;
  product_status: ProductStatus;
  supplier_name: string | null;
  conflict_of_interest: boolean;
}
export interface CatalogueStats {
  generated_at: string;
  approved_suppliers: number;
  published_products: number;
  suppliers_awaiting_review: number;
  products_awaiting_review: number;
  outdated_availability: number;
  open_product_reports: number;
  enquiries_received: number;
  enquiries_received_30d: number;
  partner_response: {
    requests: number;
    responded: number;
    response_rate: number | null;
    median_response_seconds: number | null;
  };
  imports: { jobs_failed: number; rows_invalid: number };
}

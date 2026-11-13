/** Shared (client-safe) types and constants for business products and services. */
export const PRODUCT_UNITS = ['piece', 'set', 'kg', 'hour', 'day', 'job'] as const;
export type ProductStatus = 'draft' | 'in_review' | 'live' | 'changes_requested' | 'rejected' | 'archived';

export interface BizProduct {
  id: string;
  org_id: string;
  kind: 'product' | 'service';
  name: string;
  description: string | null;
  price_cents: number | null;
  unit: string | null;
  min_order: number | null;
  ask_for_quote: boolean;
  status: ProductStatus;
  review_note: string | null;
  submitted_at: string | null;
  version: number;
  created_at: string;
}

export interface AdminBizProduct extends Omit<BizProduct, 'created_at'> {
  org_name: string;
}

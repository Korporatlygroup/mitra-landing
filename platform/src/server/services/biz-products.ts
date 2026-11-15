import type { PublicProduct } from '@/components/ListingView';
import { failFrom, ok, type Db, type Result } from './result';

/** Products and services for regular businesses. Every change goes back to draft; only MITRA-approved ("live") items reach the public profile. */

import type { AdminBizProduct, BizProduct, ProductStatus } from './biz-products-types';
export { PRODUCT_UNITS } from './biz-products-types';
export type { AdminBizProduct, BizProduct, ProductStatus } from './biz-products-types';

async function rpc<T>(db: Db, fn: string, args: Record<string, unknown>): Promise<Result<T>> {
  const { data, error } = await db.rpc(fn, args);
  return error ? failFrom(error) : ok(data as T);
}

export async function listOrgProducts(db: Db, orgId: string): Promise<BizProduct[]> {
  const { data } = await db
    .from('biz_products')
    .select('id, org_id, kind, name, description, price_cents, unit, min_order, ask_for_quote, status, review_note, submitted_at, version, created_at')
    .eq('org_id', orgId)
    .neq('status', 'archived')
    .order('created_at', { ascending: false })
    .limit(200);
  return (data ?? []) as BizProduct[];
}

export async function getOrgProduct(db: Db, orgId: string, id: string): Promise<BizProduct | null> {
  const { data } = await db
    .from('biz_products')
    .select('id, org_id, kind, name, description, price_cents, unit, min_order, ask_for_quote, status, review_note, submitted_at, version, created_at')
    .eq('org_id', orgId)
    .eq('id', id)
    .neq('status', 'archived')
    .maybeSingle();
  return (data as BizProduct | null) ?? null;
}

export const saveProduct = (db: Db, orgId: string, id: string | null, data: Record<string, unknown>, expectedVersion: number | null) =>
  rpc<{ id: string; version: number; status: ProductStatus }>(db, 'biz_product_save', { p_org: orgId, p_id: id, p_data: data, p_expected_version: expectedVersion });
export const submitProduct = (db: Db, orgId: string, id: string, expectedVersion: number) =>
  rpc<{ id: string; version: number; status: ProductStatus }>(db, 'biz_product_submit', { p_org: orgId, p_id: id, p_expected_version: expectedVersion });
export const archiveProduct = (db: Db, orgId: string, id: string) => rpc<null>(db, 'biz_product_archive', { p_org: orgId, p_id: id });

export const adminListProducts = (db: Db, status: ProductStatus | null) => rpc<AdminBizProduct[]>(db, 'admin_biz_products', { p_status: status });
export const adminDecideProduct = (db: Db, id: string, decision: 'approve' | 'request_changes' | 'reject', note: string | null, expectedVersion: number) =>
  rpc<null>(db, 'admin_biz_product_decide', { p_id: id, p_decision: decision, p_note: note, p_expected_version: expectedVersion });

/** Live products of a published listing (anyone can read). */
export async function listPublicProducts(db: Db, slug: string): Promise<PublicProduct[]> {
  const { data, error } = await db.rpc('public_biz_products', { p_slug: slug });
  if (error || !Array.isArray(data)) return [];
  return data as PublicProduct[];
}

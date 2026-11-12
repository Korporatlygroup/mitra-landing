import { failFrom, ok, type Db, type Result } from './result';
import type {
  CatalogueItemDetail,
  CatalogueSearchParams,
  CatalogueSearchResult,
  CompareResult,
  Page,
  ProductReportReason,
  SaveProductResult,
  SavedProductRow,
  SourcingRequestDetail,
  SourcingRequestInput,
  SourcingRequestRow,
  SourcingSubmitted,
  ProductMediaAccess,
} from './p5-types';

/**
 * Phase 5, buyer and public side. `search_catalogue`, `get_catalogue_item`, `compare_items` and `get_product_media_access`
 * are also granted to `anon`, so they work with a client that has no session. Everything else needs a signed-in user.
 */

async function rpc<T>(db: Db, fn: string, args: Record<string, unknown>): Promise<Result<T>> {
  const { data, error } = await db.rpc(fn, args);
  return error ? failFrom(error) : ok(data as T);
}

export const CATALOGUE_PAGE_SIZE = 20;
export const MAX_COMPARE = 4;

// ------------------------------------------------------------------------------------------------ public catalogue

/**
 * `q` max 80 characters. Price filters need `currency` (422 `currency_required`) and compare against `from_price`.
 * Prices are passed as decimal strings. `limit` is capped at 50 by the database.
 */
export const searchCatalogue = (db: Db, p: CatalogueSearchParams = {}) =>
  rpc<CatalogueSearchResult>(db, 'search_catalogue', {
    p_q: p.q?.trim() || null,
    p_category: p.category || null,
    p_supplier: p.supplier || null,
    p_moq_max: p.moqMax ?? null,
    p_price_min: p.priceMin || null,
    p_price_max: p.priceMax || null,
    p_currency: p.currency || null,
    p_offset: p.offset ?? 0,
    p_limit: p.limit ?? CATALOGUE_PAGE_SIZE,
  });

/** 404 (`not_found`) when the product is not currently visible. */
export const getCatalogueItem = (db: Db, productId: string) => rpc<CatalogueItemDetail>(db, 'get_catalogue_item', { p_id: productId });

/** At most 4 ids; ids that are not visible come back in `unavailable`. */
export const compareItems = (db: Db, productIds: string[]) => rpc<CompareResult>(db, 'compare_items', { p_ids: productIds.slice(0, MAX_COMPARE) });

/** `{storage_path, mime_type}`: for the server image route only; never send the storage path to a browser. */
export const getProductMediaAccess = (db: Db, mediaId: string) => rpc<ProductMediaAccess>(db, 'get_product_media_access', { p_media: mediaId });

// ------------------------------------------------------------------------------------------------ saved products

export const saveProduct = (db: Db, productId: string) => rpc<SaveProductResult>(db, 'save_product', { p_product: productId });
export const unsaveProduct = (db: Db, productId: string) => rpc<null>(db, 'unsave_product', { p_product: productId });
export const listSavedProducts = (db: Db, offset = 0) => rpc<Page<SavedProductRow>>(db, 'list_saved_products', { p_offset: offset });

// ------------------------------------------------------------------------------------------------ sourcing requests (buyer side)

/**
 * 1-20 lines, all from one supplier. The same key with the same payload returns the same request (`created: false`);
 * the same key with a different payload fails with `idempotency_key_reused`. Quantities are whole numbers.
 */
export const submitSourcingRequest = (db: Db, i: SourcingRequestInput) =>
  rpc<SourcingSubmitted>(db, 'submit_sourcing_request', {
    p_buyer_org: i.buyerOrgId,
    p_key: i.key,
    p_items: i.items,
    p_destination_state: i.destinationState,
    p_destination_city: i.destinationCity ?? null,
    p_needed_by: i.neededBy ?? null,
    p_notes: i.notes ?? null,
  });

export const listMySourcingRequests = (db: Db, buyerOrgId: string, offset = 0) =>
  rpc<Page<SourcingRequestRow>>(db, 'list_my_sourcing_requests', { p_buyer_org: buyerOrgId, p_offset: offset });

export const getSourcingRequest = (db: Db, requestId: string) => rpc<SourcingRequestDetail>(db, 'get_sourcing_request', { p_request: requestId });

/** The buyer's answer to a clarification request; reopens the request (`submitted`) for the partner. */
export const replySourcingRequest = (db: Db, requestId: string, note: string) => rpc<null>(db, 'reply_sourcing_request', { p_request: requestId, p_note: note });

export const withdrawSourcingRequest = (db: Db, requestId: string) => rpc<null>(db, 'withdraw_sourcing_request', { p_request: requestId });

// ------------------------------------------------------------------------------------------------ reports

/** 404 unless published, 409 `already_reported`, 10 per day. */
export const reportProduct = (db: Db, productId: string, reason: ProductReportReason, note: string | null) =>
  rpc<{ id: string }>(db, 'report_product', { p_product: productId, p_reason: reason, p_note: note });

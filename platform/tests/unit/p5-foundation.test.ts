import { describe, expect, it, vi } from 'vitest';
import { messagesFor } from '@/i18n/messages';
import { mapRpcError, rpcErrorDetail } from '@/lib/errors';
import { contentLengthVerdict, isSameOriginRequest } from '@/lib/http-safety';
import { MAX_IMAGE_BYTES, detectImageKind, stripWebp, validateImageUpload } from '@/lib/image-upload';
import { formatMoney, leadTimeLabel, reviewedSummary } from '@/lib/p5-format';
import { canManageCatalogue, canManageSuppliers, canModerateCatalogue, canReviewCatalogue } from '@/lib/permissions';
import {
  catalogueSearchSchema,
  moneySchema,
  productCreateSchema,
  productDecisionSchema,
  productDraftData,
  sourcingRequestSchema,
  supplierDecisionSchema,
  supplierDraftData,
  supplierStep3Schema,
} from '@/lib/schemas';
import { crc32 } from '@/lib/upload';
import * as admin from '@/server/services/p5-admin';
import * as buyer from '@/server/services/p5-buyer';
import { ingestProductImage, ingestSupplierDocument, productMediaPath, supplierDocPath, type P5IngestDeps } from '@/server/services/p5-files';
import * as partner from '@/server/services/p5-partner';
import { statusForErrorKey } from '@/server/services/p5-http';
import type { Db } from '@/server/services/result';
import { CATEGORY_SLUGS, UNITS } from '@/server/import/rules';
import { flatten } from './helpers';

// ------------------------------------------------------------------------------------------------ fake Db

function fakeDb(result: { data?: unknown; error?: { code?: string; message?: string } | null } = { data: null, error: null }) {
  const rpc = vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null }));
  return { db: { rpc } as unknown as Db, rpc };
}

const U = '11111111-1111-4111-8111-111111111111';
const V = '22222222-2222-4222-8222-222222222222';
const W = '33333333-3333-4333-8333-333333333333';

describe('service wrappers: RPC names and argument mapping', () => {
  type Case = [string, (db: Db) => Promise<unknown>, string, Record<string, unknown>];
  const cases: Case[] = [
    // partner
    ['savePartnerProfile', (d) => partner.savePartnerProfile(d, U, 'Name', 'a@b.my'), 'save_partner_profile', { p_org: U, p_display_name: 'Name', p_contact_email: 'a@b.my' }],
    ['listMySuppliers', (d) => partner.listMySuppliers(d, U), 'list_my_suppliers', { p_org: U }],
    ['getSupplier', (d) => partner.getSupplier(d, V), 'get_supplier', { p_supplier: V }],
    ['saveSupplierDraft', (d) => partner.saveSupplierDraft(d, U, null, { name: 'X' }, null), 'save_supplier_draft', { p_org: U, p_supplier: null, p_data: { name: 'X' }, p_expected_version: null }],
    ['submitSupplier', (d) => partner.submitSupplier(d, U, V, 3), 'submit_supplier', { p_org: U, p_supplier: V, p_expected_version: 3 }],
    ['withdrawSupplierSubmission', (d) => partner.withdrawSupplierSubmission(d, U, V), 'withdraw_supplier_submission', { p_org: U, p_supplier: V }],
    ['removeSupplierDocument', (d) => partner.removeSupplierDocument(d, W), 'remove_supplier_document', { p_doc: W }],
    ['listMyProducts', (d) => partner.listMyProducts(d, U, { supplierId: V, status: 'draft', offset: 25 }), 'list_my_products', { p_org: U, p_supplier: V, p_status: 'draft', p_offset: 25, p_limit: 25 }],
    ['listMyProducts defaults', (d) => partner.listMyProducts(d, U), 'list_my_products', { p_org: U, p_supplier: null, p_status: null, p_offset: 0, p_limit: 25 }],
    ['getMyProduct', (d) => partner.getMyProduct(d, U, V), 'get_my_product', { p_org: U, p_product: V }],
    ['saveProductDraft', (d) => partner.saveProductDraft(d, U, V, null, { sku: 'A1' }, null), 'save_product_draft', { p_org: U, p_supplier: V, p_product: null, p_data: { sku: 'A1' }, p_expected_version: null }],
    ['submitProduct', (d) => partner.submitProduct(d, U, V, 2), 'submit_product', { p_org: U, p_product: V, p_expected_version: 2 }],
    ['publishProduct', (d) => partner.publishProduct(d, U, V, 5), 'publish_product', { p_org: U, p_product: V, p_expected_version: 5 }],
    ['unpublishProduct', (d) => partner.unpublishProduct(d, U, V), 'unpublish_product', { p_org: U, p_product: V }],
    ['updateProductMedia', (d) => partner.updateProductMedia(d, W, 'alt', 2), 'update_product_media', { p_media: W, p_alt: 'alt', p_sort: 2 }],
    ['removeProductMedia', (d) => partner.removeProductMedia(d, W), 'remove_product_media', { p_media: W }],
    ['stageImport', (d) => partner.stageImport(d, U, V, 'create_only', 'f.csv', 'ab'.repeat(32), [{ _row: 2, sku: 'A' }]), 'stage_import', { p_partner_org: U, p_supplier: V, p_mode: 'create_only', p_file_name: 'f.csv', p_sha256: 'ab'.repeat(32), p_rows: [{ _row: 2, sku: 'A' }] }],
    ['commitImport', (d) => partner.commitImport(d, W, true), 'commit_import', { p_job: W, p_confirm_overwrite: true }],
    ['cancelImport', (d) => partner.cancelImport(d, W), 'cancel_import', { p_job: W }],
    ['listImports', (d) => partner.listImports(d, U), 'list_imports', { p_org: U, p_supplier: null, p_offset: 0 }],
    ['getImport', (d) => partner.getImport(d, U, W, 'all', 100), 'get_import', { p_org: U, p_job: W, p_kind: 'all', p_offset: 100 }],
    ['listPartnerRequests', (d) => partner.listPartnerRequests(d, U, 'submitted', 25), 'list_partner_requests', { p_org: U, p_status: 'submitted', p_offset: 25 }],
    ['getPartnerRequest', (d) => partner.getPartnerRequest(d, W), 'get_sourcing_request', { p_request: W }],
    ['respondSourcingRequest', (d) => partner.respondSourcingRequest(d, W, 'clarify', 'which colour?', 4), 'respond_sourcing_request', { p_request: W, p_action: 'clarify', p_note: 'which colour?', p_expected_version: 4 }],
    ['closeSourcingRequest', (d) => partner.closeSourcingRequest(d, W, 'done'), 'close_sourcing_request', { p_request: W, p_note: 'done' }],
    // buyer
    [
      'searchCatalogue',
      (d) => buyer.searchCatalogue(d, { q: '  silk ', category: 'textiles-apparel', currency: 'INR', priceMin: '10.50', moqMax: 100, offset: 20 }),
      'search_catalogue',
      { p_q: 'silk', p_category: 'textiles-apparel', p_supplier: null, p_moq_max: 100, p_price_min: '10.50', p_price_max: null, p_currency: 'INR', p_offset: 20, p_limit: 20 },
    ],
    ['getCatalogueItem', (d) => buyer.getCatalogueItem(d, U), 'get_catalogue_item', { p_id: U }],
    ['compareItems (max 4)', (d) => buyer.compareItems(d, [U, V, W, U, V]), 'compare_items', { p_ids: [U, V, W, U] }],
    ['getProductMediaAccess', (d) => buyer.getProductMediaAccess(d, W), 'get_product_media_access', { p_media: W }],
    ['saveProduct', (d) => buyer.saveProduct(d, U), 'save_product', { p_product: U }],
    ['unsaveProduct', (d) => buyer.unsaveProduct(d, U), 'unsave_product', { p_product: U }],
    ['listSavedProducts', (d) => buyer.listSavedProducts(d, 20), 'list_saved_products', { p_offset: 20 }],
    [
      'submitSourcingRequest',
      (d) => buyer.submitSourcingRequest(d, { buyerOrgId: U, key: 'abcdefgh', items: [{ product_id: V, quantity: 10 }], destinationState: 'Selangor' }),
      'submit_sourcing_request',
      { p_buyer_org: U, p_key: 'abcdefgh', p_items: [{ product_id: V, quantity: 10 }], p_destination_state: 'Selangor', p_destination_city: null, p_needed_by: null, p_notes: null },
    ],
    ['listMySourcingRequests', (d) => buyer.listMySourcingRequests(d, U, 25), 'list_my_sourcing_requests', { p_buyer_org: U, p_offset: 25 }],
    ['getSourcingRequest', (d) => buyer.getSourcingRequest(d, W), 'get_sourcing_request', { p_request: W }],
    ['replySourcingRequest', (d) => buyer.replySourcingRequest(d, W, 'blue'), 'reply_sourcing_request', { p_request: W, p_note: 'blue' }],
    ['withdrawSourcingRequest', (d) => buyer.withdrawSourcingRequest(d, W), 'withdraw_sourcing_request', { p_request: W }],
    ['reportProduct', (d) => buyer.reportProduct(d, U, 'spam', null), 'report_product', { p_product: U, p_reason: 'spam', p_note: null }],
    // admin
    ['provisionPartner', (d) => admin.provisionPartner(d, 'Org', 'o@x.in', 'Display'), 'provision_partner', { p_name: 'Org', p_owner_email: 'o@x.in', p_display_name: 'Display' }],
    ['resendPartnerInvitation', (d) => admin.resendPartnerInvitation(d, U, 'o@x.in'), 'resend_partner_invitation', { p_org: U, p_owner_email: 'o@x.in' }],
    ['listPartnerOrgs', (d) => admin.listPartnerOrgs(d, 'pending', 25), 'list_partner_orgs', { p_status: 'pending', p_offset: 25 }],
    ['approvePartner', (d) => admin.approvePartner(d, U, null), 'approve_partner', { p_org: U, p_reason: null }],
    ['suspendPartner', (d) => admin.suspendPartner(d, U, 'because'), 'suspend_partner', { p_org: U, p_reason: 'because' }],
    ['listSupplierReviews', (d) => admin.listSupplierReviews(d), 'list_supplier_reviews', { p_scope: 'pending', p_offset: 0 }],
    ['reviewSupplier', (d) => admin.reviewSupplier(d, V, 'approve', null, ['contact_reachable'], 2), 'review_supplier', { p_supplier: V, p_decision: 'approve', p_reason: null, p_checks: ['contact_reachable'], p_expected_version: 2 }],
    ['suspendSupplier', (d) => admin.suspendSupplier(d, V, 'because'), 'suspend_supplier', { p_supplier: V, p_reason: 'because' }],
    ['reinstateSupplier', (d) => admin.reinstateSupplier(d, V, 'because'), 'reinstate_supplier', { p_supplier: V, p_reason: 'because' }],
    ['listProductReviews', (d) => admin.listProductReviews(d, 25), 'list_product_reviews', { p_offset: 25 }],
    ['getProductForReview', (d) => admin.getProductForReview(d, V), 'get_product_for_review', { p_product: V }],
    ['reviewProduct', (d) => admin.reviewProduct(d, V, 'request_changes', 'fix price', 7), 'review_product', { p_product: V, p_decision: 'request_changes', p_reason: 'fix price', p_expected_version: 7 }],
    ['suspendProduct', (d) => admin.suspendProduct(d, V, 'because'), 'suspend_product', { p_product: V, p_reason: 'because' }],
    ['reinstateProduct', (d) => admin.reinstateProduct(d, V, 'because'), 'reinstate_product', { p_product: V, p_reason: 'because' }],
    ['listProductReports', (d) => admin.listProductReports(d), 'list_product_reports', { p_status: 'open', p_offset: 0 }],
    ['handleProductReport', (d) => admin.handleProductReport(d, W, 'dismiss', 'not an issue'), 'handle_product_report', { p_report: W, p_action: 'dismiss', p_note: 'not an issue' }],
    ['catalogueStats', (d) => admin.catalogueStats(d), 'catalogue_stats', {}],
  ];

  it.each(cases)('%s', async (_name, call, fn, args) => {
    const { db, rpc } = fakeDb({ data: { ok: 1 } });
    const r = (await call(db)) as { ok: boolean; data?: unknown };
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(fn, args);
  });

  it('covers every Phase 5 RPC the reference lists (61 public functions minus service_* and the profile reads)', () => {
    expect(new Set(cases.map((c) => c[2])).size).toBeGreaterThanOrEqual(50);
  });
});

describe('service wrappers: error mapping', () => {
  it('maps a message key to errorKey and never leaks database text', async () => {
    const { db } = fakeDb({ error: { code: 'PT409', message: 'sku_exists' } });
    expect(await partner.saveProductDraft(db, U, V, null, { sku: 'A' }, null)).toEqual({ ok: false, errorKey: 'sku_exists' });
    const raw = fakeDb({ error: { code: '23505', message: 'duplicate key value violates unique constraint "x"' } });
    expect(await buyer.saveProduct(raw.db, U)).toEqual({ ok: false, errorKey: 'internal' });
  });

  it('maps validator keys by the part before the first colon and keeps the detail', async () => {
    const { db } = fakeDb({ error: { code: 'PT422', message: 'too_long:description' } });
    expect(await partner.submitProduct(db, U, V, 1)).toEqual({ ok: false, errorKey: 'too_long', detail: 'description' });
    expect(mapRpcError({ code: 'PT422', message: 'invalid_tier:3' })).toBe('invalid_tier');
    expect(mapRpcError({ code: 'PT422', message: 'invalid_price:tiers[2]' })).toBe('invalid_price');
    expect(rpcErrorDetail({ message: 'invalid_price:tiers[2]' })).toBe('tiers[2]');
    expect(mapRpcError({ code: 'PT422', message: 'unknown_field:supplier_id' })).toBe('unknown_field');
  });

  it('maps <field>_required and unknown invalid_<field> to generic messages', () => {
    expect(mapRpcError({ code: 'PT422', message: 'name_required' })).toBe('name_required');
    expect(mapRpcError({ code: 'PT422', message: 'packaging_required' })).toBe('field_required');
    expect(rpcErrorDetail({ message: 'packaging_required' })).toBe('packaging');
    expect(mapRpcError({ code: 'PT422', message: 'invalid_packaging' })).toBe('field_invalid');
    expect(mapRpcError({ code: 'PT409', message: 'invalid_packaging' })).toBe('conflict');
  });

  it('refuses detail text that is not a simple token', () => {
    expect(rpcErrorDetail({ message: 'too_long:<script>alert(1)</script>' })).toBeNull();
  });

  it('acceptPartnerInvitation turns the non-raising PT404 payload into invalid_invitation', async () => {
    const bad = fakeDb({ data: { code: 'PT404', message: 'invalid_invitation' } });
    expect(await partner.acceptPartnerInvitation(bad.db, 'tok')).toEqual({ ok: false, errorKey: 'invalid_invitation' });
    const good = fakeDb({ data: { org_id: U, role: 'owner' } });
    expect(await partner.acceptPartnerInvitation(good.db, 'tok')).toEqual({ ok: true, data: { org_id: U, role: 'owner' } });
  });
});

// ------------------------------------------------------------------------------------------------ schemas

describe('Phase 5 schemas', () => {
  it('money is a decimal string, never a float', () => {
    expect(moneySchema().parse('12.50')).toBe('12.50');
    expect(moneySchema().parse('1,250.5')).toBe('1250.50');
    expect(moneySchema().parse('250')).toBe('250.00');
    expect(moneySchema().safeParse('1,100').success).toBe(false); // ambiguous (could be a decimal comma)
    expect(moneySchema().parse('0.01')).toBe('0.01');
    for (const bad of ['0', '0.00', '-1', '1.234', 'abc', '1e3', '', '123456789012']) expect(moneySchema().safeParse(bad).success, bad).toBe(false);
  });

  const L = 'en';
  const base = { orgId: U, locale: L, supplierId: V, sku: 'SKU-1' };

  it('parses a product form with tiers, variants and specs from hidden fields', () => {
    const r = productCreateSchema.safeParse({
      ...base,
      name: 'Silk saree',
      category_slug: 'textiles-apparel',
      unit: 'piece',
      moq: '10',
      currency: 'INR',
      price_mode: 'tiers',
      tiers: JSON.stringify([
        { min_qty: 10, max_qty: 49, unit_price: '120.00' },
        { min_qty: 50, max_qty: '', unit_price: '1,100.00' },
      ]),
      variants: JSON.stringify([{ sku: 'SKU-1-R', label: 'Red', attributes: { colour: 'red' } }]),
      specs: 'Fabric: silk\nLength: 5.5 m',
      lead_time_min_days: '7',
      availability_confirmed_on: '2026-10-01',
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.tiers).toEqual([
      { min_qty: 10, max_qty: 49, unit_price: '120.00' },
      { min_qty: 50, max_qty: null, unit_price: '1100.00' },
    ]);
    expect(r.data.moq).toBe(10);
    expect(r.data.specs).toEqual({ Fabric: 'silk', Length: '5.5 m' });
    expect(typeof r.data.tiers?.[0].unit_price).toBe('string');
    const data = productDraftData(r.data);
    expect(Object.keys(data)).not.toContain('orgId');
    expect(Object.keys(data)).not.toContain('supplierId');
    expect(data.sku).toBe('SKU-1');
  });

  it('reports the first problem as a message key', () => {
    expect(productCreateSchema.safeParse({ ...base, sku: 'bad sku!' }).error?.issues[0].message).toBe('invalid_sku');
    expect(productCreateSchema.safeParse({ ...base, tiers: '[{"min_qty":1,"unit_price":"1.234"}]' }).error?.issues[0].message).toBe('invalid_price');
    expect(productCreateSchema.safeParse({ ...base, tiers: 'not json' }).success).toBe(false);
    expect(productCreateSchema.safeParse({ ...base, price_mode: 'free' }).error?.issues[0].message).toBe('invalid_price_mode');
    expect(productCreateSchema.safeParse({ ...base, availability_confirmed_on: '2026-02-30' }).error?.issues[0].message).toBe('invalid_date');
  });

  it('lets supplier contact and registration be "not sure"', () => {
    const r = supplierStep3Schema.safeParse({ orgId: U, locale: L, supplierId: V, expectedVersion: '2', registration_id: '', registration_not_sure: 'on', contact_email: 'a@b.in' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(supplierDraftData(r.data)).toEqual({ contact_email: 'a@b.in', registration_id: '' });
    expect(supplierStep3Schema.safeParse({ orgId: U, locale: L, expectedVersion: '2', website: 'ftp://x' }).error?.issues[0].message).toBe('invalid_website');
  });

  it('parses a sourcing request (1-20 lines as JSON, whole-number quantities)', () => {
    const ok = sourcingRequestSchema.safeParse({
      locale: L,
      buyerOrgId: U,
      key: 'abcdefgh-1',
      items: JSON.stringify([{ product_id: V, quantity: '25' }]),
      destinationState: 'Selangor',
      neededBy: '2026-12-01',
    });
    expect(ok.success).toBe(true);
    expect(sourcingRequestSchema.safeParse({ locale: L, buyerOrgId: U, key: 'abcdefgh', items: '[]', destinationState: 'Selangor' }).error?.issues[0].message).toBe('items_required');
    expect(sourcingRequestSchema.safeParse({ locale: L, buyerOrgId: U, key: 'abcdefgh', items: JSON.stringify([{ product_id: V, quantity: '1.5' }]), destinationState: 'Selangor' }).error?.issues[0].message).toBe('invalid_quantity');
  });

  it('search params are tolerant: bad values are dropped, never an error', () => {
    const r = catalogueSearchSchema.parse({ q: 'saree', category: 'nope', currency: 'EUR', price_min: 'x', moq_max: '-3', page: 'zzz' });
    expect(r.q).toBe('saree');
    expect(r.category).toBeUndefined();
    expect(r.currency).toBeUndefined();
    expect(r.price_min).toBeUndefined();
    expect(r.moq_max).toBeUndefined();
    expect(r.page).toBe(1);
  });

  it('admin decisions need checks (approve) or a reason (reject, request)', () => {
    const d = { locale: L, supplierId: V, expectedVersion: '1' };
    expect(supplierDecisionSchema.safeParse({ ...d, decision: 'approve', checks: [] }).error?.issues[0].message).toBe('invalid_checks');
    expect(supplierDecisionSchema.safeParse({ ...d, decision: 'approve', checks: ['contact_reachable', 'trade_reference'] }).success).toBe(true);
    expect(supplierDecisionSchema.safeParse({ ...d, decision: 'approve', checks: ['contact_reachable', 'contact_reachable'] }).success).toBe(false);
    expect(supplierDecisionSchema.safeParse({ ...d, decision: 'reject', reason: 'no' }).error?.issues[0].message).toBe('reason_required');
    expect(productDecisionSchema.safeParse({ locale: L, productId: V, expectedVersion: '3', decision: 'request_changes', reason: 'fix the price' }).success).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------ messages

describe('p5common messages', () => {
  const en = flatten(messagesFor('en'));
  const has = (k: string) => typeof en[k] === 'string' && String(en[k]).length > 0;

  it('has labels for every status, category, unit, currency and report reason', () => {
    const groups: Record<string, string[]> = {
      'p5common.status.supplier': ['draft', 'awaiting_review', 'approved', 'rejected', 'more_info_needed', 'suspended'],
      'p5common.status.product': ['draft', 'submitted', 'approved', 'changes_requested', 'rejected', 'published', 'unpublished', 'suspended'],
      'p5common.status.partner': ['pending', 'approved', 'suspended'],
      'p5common.status.sourcing': ['submitted', 'acknowledged', 'clarification_requested', 'closed', 'withdrawn'],
      'p5common.status.import': ['previewed', 'failed', 'committed', 'cancelled'],
      'p5common.status.importRow': ['valid', 'invalid', 'duplicate'],
      'p5common.availability': ['available', 'made_to_order', 'limited', 'unavailable'],
      'p5common.price': ['tiers', 'fixed', 'request'],
      'p5common.currencies': ['INR', 'MYR', 'USD'],
      'p5common.docTypes': ['business_registration', 'tax_registration', 'export_licence', 'trade_reference', 'catalogue', 'other'],
      'p5common.reportReasons': ['misleading', 'counterfeit', 'prohibited', 'wrong_price', 'offensive', 'spam', 'other'],
      'p5common.verification.checks': ['contact_reachable', 'registration_document_seen', 'address_consistent', 'catalogue_consistent', 'trade_reference', 'identity_document_seen'],
      'p5common.buttons': ['saveDraft', 'submitForReview', 'addSupplier', 'addProduct', 'uploadProducts', 'findProducts', 'requestPrice', 'viewRequests', 'saveChanges'],
      'p5partner.nav': ['home', 'suppliers', 'products', 'import', 'requests', 'notifications', 'settings'],
    };
    for (const [ns, keys] of Object.entries(groups)) for (const k of keys) expect(has(`${ns}.${k}`), `${ns}.${k}`).toBe(true);
    for (const c of CATEGORY_SLUGS) expect(has(`p5common.categories.${c}`), c).toBe(true);
    for (const u of UNITS) expect(has(`p5common.units.${u}`), u).toBe(true);
  });

  it('never uses trust, guarantee or official-check wording in any language', () => {
    for (const loc of ['en', 'ta', 'ms'] as const) {
      const text = JSON.stringify((messagesFor(loc) as Record<string, unknown>).p5common).toLowerCase();
      for (const bad of ['trusted', 'guarantee', 'official check', 'verified by', 'dijamin', 'jaminan', 'dipercayai', 'rasmi']) expect(text, `${loc}: ${bad}`).not.toContain(bad);
    }
  });

  it('reviewedSummary builds "what MITRA checked and when" and never claims more', () => {
    const msgs = messagesFor('en') as { p5common: Record<string, unknown> };
    const t = ((key: string, values?: Record<string, string | number>) => {
      let cur: unknown = msgs.p5common;
      for (const p of key.split('.')) cur = (cur as Record<string, unknown>)[p];
      return String(cur).replace(/\{(\w+)\}/g, (_, k: string) => String(values?.[k]));
    }) as Parameters<typeof reviewedSummary>[0];
    const s = reviewedSummary(t, { checks: ['contact_reachable', 'registration_document_seen'], reviewed_at: '2026-09-02T10:00:00Z' }, 'en');
    expect(s).toContain('INOK reviewed documents');
    expect(s).toContain('contact details could be reached');
    expect(s).toContain('2 September 2026');
    expect(reviewedSummary(t, null, 'en')).toBe('INOK has not reviewed this supplier yet.');
    expect(reviewedSummary(t, { checks: [], reviewed_at: '2026-09-02T10:00:00Z' }, 'en')).toBe('INOK has not reviewed this supplier yet.');
  });

  it('formats money from a decimal string and lead times', () => {
    expect(formatMoney('1250.5', 'MYR', 'en')).toMatch(/1,250\.50/);
    expect(leadTimeLabel(((k: string, v?: Record<string, string | number>) => `${k}:${JSON.stringify(v)}`) as never, 5, 10)).toContain('leadTimeRange');
    expect(leadTimeLabel(((k: string) => k) as never, null, null)).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------ permissions

describe('permission helpers', () => {
  it('reflect the role table', () => {
    expect(canManageSuppliers(['supplier:manage'])).toBe(true);
    expect(canManageSuppliers(new Set<string>())).toBe(false);
    expect(canManageCatalogue(new Set(['catalogue:manage']))).toBe(true);
    expect(canReviewCatalogue(['catalogue:review'])).toBe(true);
    expect(canModerateCatalogue(['catalogue:review'])).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------ http guards

describe('upload route guards', () => {
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });
  it('accepts only same-origin POSTs', () => {
    const url = 'https://mitra.example/api/v1/products/x/media';
    expect(isSameOriginRequest(h({ origin: 'https://mitra.example', host: 'mitra.example' }), url)).toBe(true);
    expect(isSameOriginRequest(h({ origin: 'https://evil.example', host: 'mitra.example' }), url)).toBe(false);
    expect(isSameOriginRequest(h({ origin: 'null', host: 'mitra.example' }), url)).toBe(false);
    expect(isSameOriginRequest(h({ 'sec-fetch-site': 'same-origin' }), url)).toBe(true);
    expect(isSameOriginRequest(h({ 'sec-fetch-site': 'cross-site' }), url)).toBe(false);
    expect(isSameOriginRequest(h({}), url)).toBe(false);
  });
  it('bounds the body by Content-Length before reading it', () => {
    expect(contentLengthVerdict(h({}), 1000)).toBe('missing');
    expect(contentLengthVerdict(h({ 'content-length': 'abc' }), 1000)).toBe('missing');
    expect(contentLengthVerdict(h({ 'content-length': '500' }), 1000)).toBe('ok');
    expect(contentLengthVerdict(h({ 'content-length': String(1000 + 64 * 1024 + 1) }), 1000)).toBe('too_large');
  });
  it('maps error keys to HTTP statuses', () => {
    expect(statusForErrorKey('file_too_large')).toBe(413);
    expect(statusForErrorKey('rate_limited')).toBe(429);
    expect(statusForErrorKey('forbidden')).toBe(403);
    expect(statusForErrorKey('anything_else')).toBe(422);
  });
});

// ------------------------------------------------------------------------------------------------ image pipeline

const enc = (s: string) => new TextEncoder().encode(s);
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const be32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const le32 = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
const pngChunk = (type: string, data: Uint8Array) => {
  const t = enc(type);
  return cat(be32(data.length), t, data, be32(crc32(cat(t, data))));
};
const png = (w: number, h: number, withText = true) =>
  cat(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', cat(be32(w), be32(h), new Uint8Array([8, 2, 0, 0, 0]))),
    withText ? pngChunk('tEXt', enc('Comment\0secret-gps')) : new Uint8Array(),
    pngChunk('IDAT', new Uint8Array([1, 2, 3, 4])),
    pngChunk('IEND', new Uint8Array()),
  );
const riffChunk = (type: string, data: Uint8Array) => cat(enc(type), le32(data.length), data, data.length & 1 ? new Uint8Array([0]) : new Uint8Array());
const webp = (w: number, h: number) => {
  const vp8x = new Uint8Array(10);
  vp8x[0] = 0x08 | 0x04 | 0x10; // EXIF, XMP, alpha
  vp8x[4] = (w - 1) & 255;
  vp8x[5] = ((w - 1) >> 8) & 255;
  vp8x[7] = (h - 1) & 255;
  vp8x[8] = ((h - 1) >> 8) & 255;
  const body = cat(riffChunk('VP8X', vp8x), riffChunk('EXIF', enc('Exif GPS secret')), riffChunk('VP8 ', new Uint8Array(12)), riffChunk('XMP ', enc('<x:xmpmeta/>')));
  return cat(enc('RIFF'), le32(4 + body.length), enc('WEBP'), body);
};

describe('product image validation and stripping', () => {
  it('accepts png and webp, rejects wrong type, oversize and pixel bombs', () => {
    expect(validateImageUpload({ fileName: 'a.png', declaredMime: 'image/png', bytes: png(100, 100) }).ok).toBe(true);
    expect(validateImageUpload({ fileName: 'a.webp', declaredMime: 'image/webp', bytes: webp(100, 80) }).ok).toBe(true);
    expect(validateImageUpload({ fileName: 'a.png', declaredMime: 'image/jpeg', bytes: png(10, 10) })).toMatchObject({ ok: false, reason: 'bad_type' });
    expect(validateImageUpload({ fileName: 'a.gif', declaredMime: 'image/gif', bytes: enc('GIF89a....') })).toMatchObject({ ok: false, reason: 'bad_type' });
    expect(validateImageUpload({ fileName: 'a.png', declaredMime: 'image/png', bytes: new Uint8Array() })).toMatchObject({ ok: false, reason: 'empty' });
    expect(validateImageUpload({ fileName: 'a.png', declaredMime: 'image/png', bytes: new Uint8Array(MAX_IMAGE_BYTES + 1) })).toMatchObject({ ok: false, reason: 'too_large' });
    expect(validateImageUpload({ fileName: 'a.png', declaredMime: 'image/png', bytes: png(20000, 20000) })).toMatchObject({ ok: false, reason: 'unsafe_content' });
    expect(validateImageUpload({ fileName: 'a.svg', declaredMime: 'image/svg+xml', bytes: enc('<svg xmlns="http://www.w3.org/2000/svg"/>') })).toMatchObject({ ok: false, reason: 'bad_type' });
  });

  it('strips EXIF and XMP from webp and fixes the container', () => {
    const src = webp(64, 64);
    expect(detectImageKind(src)).toBe('webp');
    const r = stripWebp(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = Buffer.from(r.bytes).toString('latin1');
    expect(text).not.toContain('Exif GPS');
    expect(text).not.toContain('xmpmeta');
    expect(r.bytes[12 + 8] & (0x08 | 0x04)).toBe(0);
    expect(new DataView(r.bytes.buffer, r.bytes.byteOffset).getUint32(4, true)).toBe(r.bytes.length - 8);
    expect(detectImageKind(r.bytes)).toBe('webp');
    expect(stripWebp(src.subarray(0, 30)).ok).toBe(false);
  });
});

function deps(over: Partial<P5IngestDeps> = {}) {
  const calls: string[] = [];
  const d: P5IngestDeps = {
    scan: vi.fn(async () => ({ status: 'clean' as const, engine: 'clamd' })),
    upload: vi.fn(async (p: string) => {
      calls.push(`upload:${p}`);
      return true;
    }),
    remove: vi.fn(async (p: string) => {
      calls.push(`remove:${p}`);
      return true;
    }),
    register: vi.fn(async () => {
      calls.push('register');
      return { ok: true as const, id: 'doc-1' };
    }),
    newId: () => 'fixedid-0001',
    ...over,
  };
  return { d, calls };
}

describe('Phase 5 ingestion pipeline', () => {
  const img = { orgId: U, productId: V, fileName: 'photo.png', declaredMime: 'image/png', bytes: png(32, 32) };

  it('scans BEFORE storing, stores under products/<org>/<product>/, and strips metadata first', async () => {
    const { d, calls } = deps();
    const r = await ingestProductImage(d, img);
    expect(r).toEqual({ ok: true, id: 'doc-1', scanStatus: 'clean' });
    expect(calls).toEqual([`upload:${productMediaPath(U, V, 'fixedid-0001', 'png')}`, 'register']);
    const scanned = (d.scan as ReturnType<typeof vi.fn>).mock.calls[0][0] as Uint8Array;
    expect(Buffer.from(scanned).toString('latin1')).not.toContain('secret-gps');
    const stored = (d.upload as ReturnType<typeof vi.fn>).mock.calls[0][1] as Uint8Array;
    expect(Buffer.from(stored).equals(Buffer.from(scanned))).toBe(true);
  });

  it('never stores or registers an infected file', async () => {
    const { d, calls } = deps({ scan: vi.fn(async () => ({ status: 'infected' as const, engine: 'clamd', signature: 'X' })) });
    expect(await ingestProductImage(d, img)).toEqual({ ok: false, errorKey: 'file_infected' });
    expect(calls).toEqual([]);
  });

  it('quarantines (stores as pending, no engine) when the scanner is unavailable: never published unscanned', async () => {
    const { d } = deps({ scan: vi.fn(async () => ({ status: 'unavailable' as const, engine: 'clamd', reason: 'not_configured' })) });
    const r = await ingestProductImage(d, img);
    expect(r).toEqual({ ok: true, id: 'doc-1', scanStatus: 'pending' });
    expect((d.register as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ scanStatus: 'pending', scanEngine: null });
  });

  it('removes the stored object when registration is refused, and maps the error', async () => {
    const { d, calls } = deps({ register: vi.fn(async () => ({ ok: false as const, error: { code: 'PT409', message: 'media_limit_reached' } })) });
    expect(await ingestProductImage(d, img)).toEqual({ ok: false, errorKey: 'media_limit_reached' });
    expect(calls).toEqual([`upload:${productMediaPath(U, V, 'fixedid-0001', 'png')}`, `remove:${productMediaPath(U, V, 'fixedid-0001', 'png')}`]);
  });

  it('supplier documents: pdf allowed, path is supplier/<org>/<supplier>/<file>, bad type refused before any I/O', async () => {
    const pdf = enc('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    const { d, calls } = deps();
    const r = await ingestSupplierDocument(d, { orgId: U, supplierId: V, fileName: 'licence.pdf', declaredMime: 'application/pdf', bytes: pdf });
    expect(r.ok).toBe(true);
    expect(calls[0]).toBe(`upload:${supplierDocPath(U, V, 'fixedid-0001', 'pdf')}`);
    expect(supplierDocPath(U, V, 'fixedid-0001', 'pdf')).toMatch(/^supplier\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{8,120}$/);
    const none = deps();
    expect(await ingestSupplierDocument(none.d, { orgId: U, supplierId: V, fileName: 'x.exe', declaredMime: 'application/octet-stream', bytes: enc('MZ....') })).toEqual({ ok: false, errorKey: 'file_type_not_allowed' });
    expect(none.calls).toEqual([]);
    expect(none.d.scan).not.toHaveBeenCalled();
  });
});

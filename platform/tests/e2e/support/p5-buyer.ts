import { createHash } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createUser, serviceClient, signedClient, sql, uniq, type Signed, type TestUser } from './db';
import { msg } from './i18n';
import { totp } from './totp';
import { addMitraMember, expectNoHorizontalScroll } from './ui';

/**
 * Fixtures for the buyer catalogue specs: partners, approved suppliers and PUBLISHED products built through the real RPC lifecycle
 * (partner draft, submit, MITRA review, publish), plus the few direct SQL helpers the specs need to read persisted state.
 * Synthetic data only. (Copied in small pieces from the partner helpers on purpose: this file is owned by the buyer specs.)
 */

export const today = () => new Date().toISOString().slice(0, 10);
export const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** A real 1x1 PNG, so the media route has something to serve. */
export const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function enrol(s: Signed): Promise<string> {
  const { data, error } = await s.client.auth.mfa.enroll({ factorType: 'totp', friendlyName: uniq('totp') });
  if (error || !data) throw new Error(`mfa.enroll failed: ${error?.message}`);
  const ch = await s.client.auth.mfa.challenge({ factorId: data.id });
  if (ch.error || !ch.data) throw new Error(`mfa.challenge failed: ${ch.error?.message}`);
  const v = await s.client.auth.mfa.verify({ factorId: data.id, challengeId: ch.data.id, code: totp(data.totp.secret) });
  if (v.error) throw new Error(`mfa.verify failed: ${v.error.message}`);
  return data.totp.secret;
}

/** A MITRA reviewer (admin_review) at aal2, for approving suppliers and products. Setup only. */
export async function makeReviewer(): Promise<Signed> {
  const u = await createUser('p5b-rev');
  await addMitraMember(u.id, 'admin_review');
  const s = await signedClient(u);
  await enrol(s);
  return s;
}

/** A MITRA moderator (admin_support) at aal2, for suspending suppliers and products. Setup only. */
export async function makeModerator(): Promise<Signed> {
  const u = await createUser('p5b-mod');
  await addMitraMember(u.id, 'admin_support');
  const s = await signedClient(u);
  await enrol(s);
  return s;
}

export interface Partner {
  user: TestUser;
  org: string;
  s: Signed;
  secret?: string;
}

/** An APPROVED partner organisation with its owner (MFA done). MITRA approval is setup-by-SQL here; the approval flow has its own tests. */
export async function makePartner(prefix = 'p5b-partner'): Promise<Partner> {
  const user = await createUser(prefix);
  const s = await signedClient(user);
  const created = await s.client.rpc('create_org', { p_type: 'partner', p_name: `Partner ${uniq(prefix)}` });
  if (created.error) throw new Error(`create_org failed: ${created.error.message}`);
  const org = String(created.data);
  const secret = await enrol(s);
  const profile = await s.client.rpc('save_partner_profile', { p_org: org, p_display_name: 'Synthetic partner', p_contact_email: `${uniq('p')}@example.test` });
  if (profile.error) throw new Error(`save_partner_profile failed: ${profile.error.message}`);
  await sql(`update public.partner_profiles set status = 'approved', decided_at = now() where org_id = $1`, [org]);
  return { user, org, s, secret };
}

export interface Supplier {
  id: string;
  name: string;
  partner: Partner;
}

const must = <T>(r: { data: T; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what} failed: ${r.error.message}`);
  return r.data;
};

/** An approved supplier (evidence registered as a clean document, reviewed by MITRA). Private contact data is synthetic. */
export async function makeSupplier(partner: Partner, reviewer: Signed, o: { name: string; country?: string; stateCity?: string; checks?: string[] }): Promise<Supplier> {
  const code = uniq('SUP').replace(/-/g, '').slice(0, 20);
  const saved = must(
    await partner.s.client.rpc('save_supplier_draft', {
      p_org: partner.org, p_supplier: null, p_expected_version: null,
      p_data: {
        name: o.name, country: o.country ?? 'India', state_city: o.stateCity ?? 'Chennai', main_category: 'textiles-apparel', code,
        description: `${o.name} makes and exports goods from India. Synthetic test supplier.`, capabilities: ['Handloom', 'Export packing'],
        contact_name: 'Private Contact Person', contact_email: `private-${uniq('c')}@supplier-secret.test`, contact_phone: '+91 99999 00000', registration_id: 'PRIVATE-REG-0001', website: 'https://private-supplier.example.test',
      },
    }),
    'save_supplier_draft',
  ) as { id: string; version: number };
  const supplierId = saved.id;
  const file = `${uniq('doc').replace(/-/g, '')}.pdf`;
  const reg = await serviceClient().rpc('service_register_supplier_document', {
    p_org: partner.org, p_user: partner.user.id, p_supplier: supplierId, p_doc_type: 'business_registration', p_display_name: 'secret-registration.pdf',
    p_mime: 'application/pdf', p_size: 1234, p_sha256: createHash('sha256').update(file).digest('hex'), p_storage_path: `supplier/${partner.org}/${supplierId}/${file}`,
    p_scan_status: 'clean', p_scan_engine: 'e2e',
  });
  must(reg, 'service_register_supplier_document');
  const cur = must(await partner.s.client.rpc('get_supplier', { p_supplier: supplierId }), 'get_supplier') as { draft_version: number };
  must(await partner.s.client.rpc('submit_supplier', { p_org: partner.org, p_supplier: supplierId, p_expected_version: cur.draft_version }), 'submit_supplier');
  const sub = must(await reviewer.client.rpc('get_supplier', { p_supplier: supplierId }), 'get_supplier(review)') as { draft_submitted_version: number };
  must(
    await reviewer.client.rpc('review_supplier', {
      p_supplier: supplierId, p_decision: 'approve', p_reason: null, p_checks: o.checks ?? ['contact_reachable', 'registration_document_seen'], p_expected_version: sub.draft_submitted_version,
    }),
    'review_supplier',
  );
  return { id: supplierId, name: o.name, partner };
}

export interface ProductSpec {
  name: string;
  sku?: string;
  category?: string;
  unit?: string;
  moq?: number;
  currency?: 'INR' | 'MYR' | 'USD';
  mode?: 'tiers' | 'fixed' | 'request';
  tiers?: { min_qty: number; max_qty: number | null; unit_price: string }[];
  unitPrice?: string;
  variants?: { sku: string; label: string; attributes?: Record<string, string>; moq?: number }[];
  specs?: Record<string, string>;
  lead?: [number, number];
  availability?: 'available' | 'made_to_order' | 'limited' | 'unavailable';
  availabilityOn?: string;
  priceOn?: string;
  packaging?: string;
  description?: string;
  image?: boolean;
  /** A real PNG to upload instead of the 1x1 test pixel (used by the demo seed so product cards look realistic). */
  imageBuffer?: Buffer;
  publish?: boolean;
}
export interface Product {
  id: string;
  sku: string;
  name: string;
  supplier: Supplier;
  mediaId: string | null;
}

/** A published product (draft, optional image, submit, MITRA approval, publish) built as the partner owner. */
export async function makeProduct(sup: Supplier, reviewer: Signed, spec: ProductSpec): Promise<Product> {
  const p = sup.partner;
  const sku = spec.sku ?? uniq('SKU').replace(/-/g, '').slice(0, 24).toUpperCase();
  const mode = spec.mode ?? 'tiers';
  const moq = spec.moq ?? 10;
  const data: Record<string, unknown> = {
    sku, name: spec.name, description: spec.description ?? `${spec.name}. Synthetic description for tests.`, category_slug: spec.category ?? 'textiles-apparel', unit: spec.unit ?? 'piece', moq,
    currency: spec.currency ?? 'INR', price_mode: mode, availability_status: spec.availability ?? 'available', availability_confirmed_on: spec.availabilityOn ?? today(), price_confirmed_on: spec.priceOn ?? today(),
    specs: spec.specs ?? { Material: 'Cotton' }, packaging: spec.packaging ?? 'Packed in cartons',
    lead_time_min_days: spec.lead?.[0] ?? 7, lead_time_max_days: spec.lead?.[1] ?? 14,
  };
  if (mode === 'tiers') data.tiers = spec.tiers ?? [{ min_qty: moq, max_qty: moq * 10 - 1, unit_price: '450.00' }, { min_qty: moq * 10, max_qty: null, unit_price: '400.00' }];
  if (mode === 'fixed') data.unit_price = spec.unitPrice ?? '450.00';
  if (spec.variants) data.variants = spec.variants.map((v) => ({ attributes: {}, ...v }));
  const saved = must(
    await p.s.client.rpc('save_product_draft', { p_org: p.org, p_supplier: sup.id, p_product: null, p_expected_version: null, p_data: data }),
    'save_product_draft',
  ) as { id: string; draft_version: number };
  const id = saved.id;

  let mediaId: string | null = null;
  if (spec.image) {
    const file = `${uniq('img').replace(/-/g, '')}.png`;
    const path = `products/${p.org}/${id}/${file}`;
    const up = await serviceClient().storage.from('catalogue-media').upload(path, spec.imageBuffer ?? PNG_1X1, { contentType: 'image/png', upsert: false });
    if (up.error) throw new Error(`image upload failed: ${up.error.message}`);
    mediaId = String(
      must(
        await serviceClient().rpc('service_register_product_media', {
          p_org: p.org, p_user: p.user.id, p_product: id, p_mime: 'image/png', p_size: (spec.imageBuffer ?? PNG_1X1).length, p_sha256: createHash('sha256').update(spec.imageBuffer ?? PNG_1X1).digest('hex'),
          p_storage_path: path, p_scan_status: 'clean', p_scan_engine: 'e2e', p_alt: `Alt text for ${spec.name}`,
        }),
        'service_register_product_media',
      ),
    );
  }
  const cur = must(await p.s.client.rpc('get_my_product', { p_org: p.org, p_product: id }), 'get_my_product') as { draft_version: number };
  must(await p.s.client.rpc('submit_product', { p_org: p.org, p_product: id, p_expected_version: cur.draft_version }), 'submit_product');
  const sub = must(await p.s.client.rpc('get_my_product', { p_org: p.org, p_product: id }), 'get_my_product') as { version: number };
  must(await reviewer.client.rpc('review_product', { p_product: id, p_decision: 'approve', p_reason: null, p_expected_version: sub.version }), 'review_product');
  if (spec.publish !== false) {
    const ap = must(await p.s.client.rpc('get_my_product', { p_org: p.org, p_product: id }), 'get_my_product') as { version: number };
    must(await p.s.client.rpc('publish_product', { p_org: p.org, p_product: id, p_expected_version: ap.version }), 'publish_product');
  }
  return { id, sku, name: spec.name, supplier: sup, mediaId };
}

/** A product that exists but is NOT public: left as a partner draft (never submitted). */
export async function makeDraftProduct(sup: Supplier, name: string): Promise<Product> {
  const p = sup.partner;
  const sku = uniq('DRAFT').replace(/-/g, '').slice(0, 24).toUpperCase();
  const saved = must(
    await p.s.client.rpc('save_product_draft', { p_org: p.org, p_supplier: sup.id, p_product: null, p_expected_version: null, p_data: { sku, name } }),
    'save_product_draft',
  ) as { id: string };
  return { id: saved.id, sku, name, supplier: sup, mediaId: null };
}

export const unpublish = async (p: Product) => must(await p.supplier.partner.s.client.rpc('unpublish_product', { p_org: p.supplier.partner.org, p_product: p.id }), 'unpublish_product');
export const suspendSupplier = async (mod: Signed, s: Supplier, reason = 'Synthetic suspension for tests') => must(await mod.client.rpc('suspend_supplier', { p_supplier: s.id, p_reason: reason }), 'suspend_supplier');
export const reinstateSupplier = async (rev: Signed, s: Supplier, reason = 'Synthetic reinstatement for tests') => must(await rev.client.rpc('reinstate_supplier', { p_supplier: s.id, p_reason: reason }), 'reinstate_supplier');
export const suspendProduct = async (mod: Signed, p: Product, reason = 'Synthetic suspension for tests') => must(await mod.client.rpc('suspend_product', { p_product: p.id, p_reason: reason }), 'suspend_product');

/** Edits the live price of a published product: a new draft revision approved and published (the live copy changes). */
export async function changePrice(rev: Signed, p: Product, tiers: { min_qty: number; max_qty: number | null; unit_price: string }[]): Promise<void> {
  const pt = p.supplier.partner;
  const cur = must(await pt.s.client.rpc('get_my_product', { p_org: pt.org, p_product: p.id }), 'get_my_product') as { draft_version: number };
  must(await pt.s.client.rpc('save_product_draft', { p_org: pt.org, p_supplier: p.supplier.id, p_product: p.id, p_expected_version: cur.draft_version, p_data: { tiers, price_confirmed_on: today() } }), 'save_product_draft(edit)');
  const c2 = must(await pt.s.client.rpc('get_my_product', { p_org: pt.org, p_product: p.id }), 'get_my_product') as { draft_version: number };
  must(await pt.s.client.rpc('submit_product', { p_org: pt.org, p_product: p.id, p_expected_version: c2.draft_version }), 'submit_product(edit)');
  const c3 = must(await pt.s.client.rpc('get_my_product', { p_org: pt.org, p_product: p.id }), 'get_my_product') as { version: number };
  must(await rev.client.rpc('review_product', { p_product: p.id, p_decision: 'approve', p_reason: null, p_expected_version: c3.version }), 'review_product(edit)');
  const c4 = must(await pt.s.client.rpc('get_my_product', { p_org: pt.org, p_product: p.id }), 'get_my_product') as { version: number };
  must(await pt.s.client.rpc('publish_product', { p_org: pt.org, p_product: p.id, p_expected_version: c4.version }), 'publish_product(edit)');
}

// ---------------------------------------------------------------------------------------------- persisted-state helpers (SQL)

export interface RequestRow {
  id: string;
  reference: string;
  status: string;
  buyer_org_id: string;
  partner_org_id: string | null;
  supplier_id: string | null;
  destination_state: string;
  destination_city: string | null;
  needed_by: string | null;
  notes: string | null;
  idempotency_key: string;
}
export const requestsOfBuyer = (userId: string) =>
  sql<RequestRow>(
    `select r.*, r.needed_by::text as needed_by from public.sourcing_requests r where r.buyer_org_id in (select org_id from public.memberships where user_id = $1) order by r.created_at`,
    [userId],
  );
export const requestsForSupplier = (supplierId: string) => sql<RequestRow>(`select *, needed_by::text as needed_by from public.sourcing_requests where supplier_id = $1 order by created_at`, [supplierId]);
export const requestItems = (requestId: string) =>
  sql<{ quantity: string; product_id: string | null; snapshot: Record<string, any> }>(`select quantity, product_id, snapshot from public.sourcing_request_items where request_id = $1 order by line_no`, [requestId]);
export const requestEvents = (requestId: string) => sql<{ kind: string; note: string | null }>(`select kind, note from public.sourcing_request_events where request_id = $1 order by id`, [requestId]);
export const savedProductIds = (userId: string) => sql<{ product_id: string }>(`select product_id from public.saved_products where user_id = $1`, [userId]);

/** The partner's own view of a request through the real RPC (what the partner UI shows). */
export async function partnerView(p: Partner, requestId: string) {
  return must(await p.s.client.rpc('get_sourcing_request', { p_request: requestId }), 'get_sourcing_request(partner)') as any;
}
export async function partnerClarify(p: Partner, requestId: string, note: string) {
  return must(await p.s.client.rpc('respond_sourcing_request', { p_request: requestId, p_action: 'clarify', p_note: note, p_expected_version: null }), 'respond_sourcing_request') as any;
}
export async function partnerAcknowledge(p: Partner, requestId: string) {
  return must(await p.s.client.rpc('respond_sourcing_request', { p_request: requestId, p_action: 'acknowledge', p_note: null, p_expected_version: null }), 'respond_sourcing_request') as any;
}

// ---------------------------------------------------------------------------------------------- page helpers

export const tb = (locale: 'en' | 'ta' | 'ms', key: string, vars: Record<string, string> = {}) => msg(locale, `p5buyer.${key}`, vars);
export const tcm = (locale: 'en' | 'ta' | 'ms', key: string, vars: Record<string, string> = {}) => msg(locale, `p5common.${key}`, vars);

export async function axeClean(page: Page, label: string): Promise<void> {
  await page.waitForLoadState('networkidle');
  // After a client-side navigation Next.js applies the new page title a moment after the content. Wait for it (up to 10 s) so axe judges the settled page;
  // if a title never arrives, axe still reports document-title below, so nothing is hidden.
  await page.waitForFunction(() => document.title.trim().length > 0, undefined, { timeout: 10_000 }).catch(() => undefined);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad, `axe serious/critical on ${label}:\n${bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`).join('\n')}`).toEqual([]);
  await expectNoHorizontalScroll(page);
}

/** The product card on a list page, found by its product id (data attribute). */
export const card = (page: Page, productId: string) => page.locator(`[data-product-id="${productId}"]`);

/** Waits until React has hydrated the page (client buttons respond), so clicks are not lost. */
export async function hydrated(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
}

/** A product that was submitted and REJECTED by MITRA (never public). */
export async function makeRejectedProduct(sup: Supplier, reviewer: Signed, name: string): Promise<Product> {
  const p = sup.partner;
  const sku = uniq('REJ').replace(/-/g, '').slice(0, 24).toUpperCase();
  const today_ = today();
  const saved = must(
    await p.s.client.rpc('save_product_draft', {
      p_org: p.org, p_supplier: sup.id, p_product: null, p_expected_version: null,
      p_data: { sku, name, description: 'Synthetic', category_slug: 'textiles-apparel', unit: 'piece', moq: 5, currency: 'INR', price_mode: 'fixed', unit_price: '10.00', availability_status: 'available', availability_confirmed_on: today_, price_confirmed_on: today_ },
    }),
    'save_product_draft',
  ) as { id: string; draft_version: number };
  must(await p.s.client.rpc('submit_product', { p_org: p.org, p_product: saved.id, p_expected_version: saved.draft_version }), 'submit_product');
  const sub = must(await p.s.client.rpc('get_my_product', { p_org: p.org, p_product: saved.id }), 'get_my_product') as { version: number };
  must(await reviewer.client.rpc('review_product', { p_product: saved.id, p_decision: 'reject', p_reason: 'Synthetic rejection', p_expected_version: sub.version }), 'review_product(reject)');
  return { id: saved.id, sku, name, supplier: sup, mediaId: null };
}

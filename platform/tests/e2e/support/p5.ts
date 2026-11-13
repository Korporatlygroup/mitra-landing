import { randomBytes } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import pg from 'pg';
import { addMember, createOrgAs, createUser, serviceClient, signedClient, sql, uniq, type TestUser } from './db';
import { DB_URL } from './env';
import { addMitraMember, expectNoHorizontalScroll, loginUi, type Locale } from './ui';

// Partner / catalogue fixtures for the Phase 5 partner specs (E50-E53). Everything is synthetic. Setup goes through the real RPCs as the right
// user (the partner's manager through PostgREST, MITRA reviewers through a transaction that sets the same JWT claims PostgREST would), so the
// database rules apply; only the partner approval itself is written directly (it is covered by the database tests).

export interface Partner {
  orgId: string;
  name: string;
  /** Owner of the organisation (not used for UI login: partner owners need MFA). */
  owner: TestUser;
  /** The member the specs log in as (role manager: no MFA needed). */
  manager: TestUser;
}

/** A partner organisation with its approved profile (or another status) and a manager to log in as. */
export async function createPartner(prefix = 'p5', opts: { status?: 'pending' | 'approved' | 'suspended'; managerRole?: 'manager' | 'staff' | 'viewer'; language?: Locale } = {}): Promise<Partner> {
  const owner = await createUser(`${prefix}-own`, { name: `Owner ${uniq(prefix)}` });
  const name = `Partner ${uniq(prefix)}`;
  const orgId = await createOrgAs(owner, 'partner', name);
  const manager = await createUser(`${prefix}-mgr`, { name: `Manager ${uniq(prefix)}`, language: opts.language });
  await addMember(orgId, manager.id, opts.managerRole ?? 'manager');
  {
    const status = opts.status ?? 'approved';
    await sql(
      `insert into public.partner_profiles (org_id, status, display_name, contact_email, decided_at)
       values ($1, $2::public.partner_status, $3, $4, case when $2 = 'pending' then null else now() end)
       on conflict (org_id) do update set status = excluded.status, decided_at = excluded.decided_at`,
      [orgId, status, name, `${uniq('c')}@example.test`],
    );
  }
  return { orgId, name, owner, manager };
}

export const partnerPath = (locale: Locale, orgId: string, tail = '') => `/${locale}/orgs/${orgId}/partner${tail}`;

export async function loginPartner(page: Page, p: Partner, locale: Locale = 'en', tail = ''): Promise<void> {
  await loginUi(page, p.manager, locale, partnerPath(locale, p.orgId, tail));
  await expect(page).toHaveURL(new RegExp(`/orgs/${p.orgId}/partner`));
}

// ----------------------------------------------------------------------------------------------------------------------------------
// MITRA reviewers and RPCs as a given user
// ----------------------------------------------------------------------------------------------------------------------------------

export async function createReviewer(prefix = 'rev', role: 'admin_review' | 'admin_support' | 'admin_super' = 'admin_review'): Promise<TestUser> {
  const u = await createUser(prefix, { name: `Reviewer ${uniq(prefix)}` });
  await addMitraMember(u.id, role);
  return u;
}

/** Runs one SQL statement as an authenticated user (the claims PostgREST sets) in a transaction and returns its rows. */
export async function asUser<T = Record<string, unknown>>(userId: string, statement: string, params: unknown[] = [], aal = 'aal2'): Promise<T[]> {
  const c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated', aal })]);
    await c.query('set local role authenticated');
    const r = await c.query(statement, params);
    await c.query('commit');
    return r.rows as T[];
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}

const SUPPLIER_CHECKS = ['contact_reachable', 'registration_document_seen'];

export interface SupplierSeed {
  id: string;
  code: string;
  name: string;
}

/** Supplier through the RPCs: draft, a clean document (registered through the service function), submitted and, by default, approved. */
export async function seedSupplier(p: Partner, reviewer: TestUser, o: { name?: string; code?: string; approve?: boolean; submit?: boolean } = {}): Promise<SupplierSeed> {
  const name = o.name ?? `Supplier ${uniq('s')}`;
  const code = o.code ?? `SUP${randomBytes(3).toString('hex').toUpperCase()}`;
  const s = await signedClient(p.manager);
  const saved = await s.client.rpc('save_supplier_draft', {
    p_org: p.orgId,
    p_supplier: null,
    p_data: {
      code,
      name,
      country: 'India',
      state_city: 'Chennai',
      main_category: 'textiles-apparel',
      description: 'We weave cotton sarees and cloth for export, with our own looms.',
      capabilities: ['Cotton sarees'],
      contact_name: 'Ravi Contact',
      contact_email: 'ravi@example.test',
    },
    p_expected_version: null,
  });
  if (saved.error) throw new Error(`save_supplier_draft: ${saved.error.message}`);
  const id = (saved.data as { id: string }).id;
  if (o.submit === false) return { id, code, name };
  await seedSupplierDocument(p, id);
  const sub = await s.client.rpc('submit_supplier', { p_org: p.orgId, p_supplier: id, p_expected_version: (saved.data as { version: number }).version });
  if (sub.error) throw new Error(`submit_supplier: ${sub.error.message}`);
  if (o.approve !== false) await reviewSupplier(reviewer, id, 'approve', null);
  return { id, code, name };
}

/** A clean evidence document row (the file itself is not needed for database rules). */
export async function seedSupplierDocument(p: Partner, supplierId: string): Promise<string> {
  const path = `supplier/${p.orgId}/${supplierId}/${randomBytes(8).toString('hex')}.pdf`;
  const { data, error } = await serviceClient().rpc('service_register_supplier_document', {
    p_org: p.orgId,
    p_user: p.manager.id,
    p_supplier: supplierId,
    p_doc_type: 'business_registration',
    p_display_name: 'registration.pdf',
    p_mime: 'application/pdf',
    p_size: 1234,
    p_sha256: randomBytes(32).toString('hex'),
    p_storage_path: path,
    p_scan_status: 'clean',
    p_scan_engine: 'e2e',
  });
  if (error) throw new Error(`service_register_supplier_document: ${error.message}`);
  return String(data);
}

export async function supplierRow(id: string) {
  return (await sql<{ status: string; draft_version: number; draft_submitted_version: number | null; version: number; decision_reason: string | null; draft: Record<string, unknown> }>(
    `select status, draft_version, draft_submitted_version, version, decision_reason, draft from public.suppliers where id = $1`,
    [id],
  ))[0]!;
}

export async function reviewSupplier(reviewer: TestUser, supplierId: string, decision: 'approve' | 'reject' | 'request_info', reason: string | null): Promise<void> {
  const row = await supplierRow(supplierId);
  await asUser(
    reviewer.id,
    `select public.review_supplier($1::uuid, $2, $3, $4::text[], $5::int)`,
    [supplierId, decision, reason, decision === 'approve' ? SUPPLIER_CHECKS : null, row.draft_submitted_version],
  );
}

export interface ProductSeed {
  id: string;
  sku: string;
}

export const PRODUCT_DATA = {
  name: 'Cotton saree',
  description: 'Handwoven cotton saree, 6 metres, in many colours.',
  category_slug: 'textiles-apparel',
  unit: 'piece',
  moq: 10,
  currency: 'INR',
  price_mode: 'fixed',
  unit_price: '450.00',
  lead_time_min_days: 7,
  lead_time_max_days: 14,
  availability_status: 'available',
  availability_confirmed_on: new Date().toISOString().slice(0, 10),
  price_confirmed_on: new Date().toISOString().slice(0, 10),
  specs: { Material: 'Cotton' },
  packaging: '10 pieces per carton',
};

export type ProductStage = 'draft' | 'submitted' | 'approved' | 'published';

/** Product through the RPCs up to the wanted stage (approval by a MITRA reviewer, publishing by the partner). */
export async function seedProduct(p: Partner, supplierId: string, reviewer: TestUser, o: { sku?: string; stage?: ProductStage; data?: Record<string, unknown> } = {}): Promise<ProductSeed> {
  const sku = o.sku ?? `SKU-${randomBytes(3).toString('hex').toUpperCase()}`;
  const stage = o.stage ?? 'published';
  const s = await signedClient(p.manager);
  const saved = await s.client.rpc('save_product_draft', { p_org: p.orgId, p_supplier: supplierId, p_product: null, p_data: { sku, ...PRODUCT_DATA, ...o.data }, p_expected_version: null });
  if (saved.error) throw new Error(`save_product_draft: ${saved.error.message}`);
  const id = (saved.data as { id: string }).id;
  if (stage === 'draft') return { id, sku };
  const sub = await s.client.rpc('submit_product', { p_org: p.orgId, p_product: id, p_expected_version: (saved.data as { draft_version: number }).draft_version });
  if (sub.error) throw new Error(`submit_product: ${sub.error.message}`);
  if (stage === 'submitted') return { id, sku };
  await reviewProduct(reviewer, id, 'approve', null);
  if (stage === 'approved') return { id, sku };
  const v = (await sql<{ version: number }>(`select version from public.products where id = $1`, [id]))[0]!.version;
  const pub = await s.client.rpc('publish_product', { p_org: p.orgId, p_product: id, p_expected_version: v });
  if (pub.error) throw new Error(`publish_product: ${pub.error.message}`);
  return { id, sku };
}

export async function productRow(id: string) {
  return (await sql<{ status: string; version: number; draft_version: number; live_revision_id: string | null; draft: Record<string, unknown> }>(
    `select status, version, draft_version, live_revision_id, draft from public.products where id = $1`,
    [id],
  ))[0]!;
}

export async function reviewProduct(reviewer: TestUser, productId: string, decision: 'approve' | 'reject' | 'request_changes', reason: string | null): Promise<void> {
  const row = await productRow(productId);
  await asUser(reviewer.id, `select public.review_product($1::uuid, $2, $3, $4::int)`, [productId, decision, reason, row.version]);
}

/** A buyer organisation with a member who can post requests. */
export async function createBuyer(prefix = 'buy'): Promise<{ user: TestUser; orgId: string; name: string }> {
  const user = await createUser(`${prefix}-own`, { name: `Buyer ${uniq(prefix)}` });
  const name = `Buyer Co ${uniq(prefix)}`;
  const orgId = await createOrgAs(user, 'buyer', name);
  return { user, orgId, name };
}

/** A sourcing request through the real RPC (as the buyer). */
export async function seedRequest(buyer: { user: TestUser; orgId: string }, productId: string, quantity = 50): Promise<{ id: string; reference: string }> {
  const s = await signedClient(buyer.user);
  const { data, error } = await s.client.rpc('submit_sourcing_request', {
    p_buyer_org: buyer.orgId,
    p_key: `key-${randomBytes(8).toString('hex')}`,
    p_items: [{ product_id: productId, quantity }],
    p_destination_state: 'Selangor',
    p_destination_city: 'Shah Alam',
    p_needed_by: null,
    p_notes: 'Please share lead time for the first order.',
  });
  if (error) throw new Error(`submit_sourcing_request: ${error.message}`);
  return data as { id: string; reference: string };
}

export async function requestRow(id: string) {
  return (await sql<{ status: string; version: number }>(`select status, version from public.sourcing_requests where id = $1`, [id]))[0]!;
}

// ----------------------------------------------------------------------------------------------------------------------------------
// Accessibility and layout checks used by every spec
// ----------------------------------------------------------------------------------------------------------------------------------

/** axe (WCAG 2.x A/AA) serious and critical must be empty; and the page must not scroll sideways. */
export async function checkPage(page: Page, label: string): Promise<void> {
  await page.waitForLoadState('networkidle');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad, `axe serious/critical on ${label}:\n${bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`).join('\n')}`).toEqual([]);
  await expectNoHorizontalScroll(page);
}

/** Waits until React has attached to the page (server-action forms need it): the nav menu toggle is a client component. */
export async function hydrated(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(150);
}

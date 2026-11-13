import { randomBytes } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { anonClient, createOrgAs, createUser, signedClient, sql, uniq, type TestUser } from './db';
import { freshCode } from './totp';
import { addMitraMember, loginUi, startEnrolAndReadSecret, submitCode, type Locale } from './ui';

/**
 * Fixtures for the admin catalogue specs (e70-e73). Everything is real: users sign in, enrol a TOTP factor and call the same RPCs the
 * app calls. The only direct SQL writes are test setup that has no user-facing path (adding an admin to the MITRA organisation, registering
 * an already-scanned document without a stored object, approving a self-created partner when the specs are not about that step).
 */

export interface Actor extends TestUser {
  /** Signed in at aal2 (a verified TOTP factor). */
  client: SupabaseClient;
  secret: string;
}
export interface Admin extends Actor {
  role: string;
}
export interface Partner {
  owner: Actor;
  orgId: string;
  name: string;
}

/** Signs `user` in with the JS client, enrols a TOTP factor and verifies it: the client then holds an aal2 session. */
export async function enrolClient(user: TestUser): Promise<Actor> {
  const s = await signedClient(user);
  const { data: enr, error } = await s.client.auth.mfa.enroll({ factorType: 'totp', friendlyName: uniq('totp') });
  if (error || !enr) throw new Error(`mfa.enroll failed: ${error?.message}`);
  const { data: ch, error: e2 } = await s.client.auth.mfa.challenge({ factorId: enr.id });
  if (e2 || !ch) throw new Error(`mfa.challenge failed: ${e2?.message}`);
  const { error: e3 } = await s.client.auth.mfa.verify({ factorId: enr.id, challengeId: ch.id, code: freshCode(enr.totp.secret) });
  if (e3) throw new Error(`mfa.verify failed: ${e3.message}`);
  return { ...user, client: s.client, secret: enr.totp.secret };
}

/** The access token of an aal2 client (for calling PostgREST from the browser like a hostile client would). */
export async function tokenOf(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getSession();
  return data.session!.access_token;
}

export async function createAdmin(role: 'admin_review' | 'admin_support' | 'admin_ops' | 'admin_super' | 'admin_content', prefix = 'adm'): Promise<Admin> {
  const u = await createUser(`${prefix}-${role}`, { name: `Admin ${uniq(prefix)}` });
  await addMitraMember(u.id, role);
  return { ...(await enrolClient(u)), role };
}

/** A user with no organisation, or an owner of a buyer organisation (can report products and send requests). Not MFA-enrolled. */
export async function createBuyer(prefix = 'buy'): Promise<{ user: TestUser; orgId: string }> {
  const user = await createUser(prefix, { name: `Buyer ${uniq(prefix)}` });
  const orgId = await createOrgAs(user, 'buyer', `Buyer ${uniq(prefix)}`);
  return { user, orgId };
}

/** A partner organisation with its owner at aal2. `approve: true` records MITRA approval as test setup. */
export async function createPartner(opts: { approve?: boolean; prefix?: string } = {}): Promise<Partner> {
  const prefix = opts.prefix ?? 'ptn';
  const u = await createUser(`${prefix}-owner`, { name: `Partner owner ${uniq(prefix)}` });
  const owner = await enrolClient(u);
  const name = `Partner ${uniq(prefix)}`;
  const { data, error } = await owner.client.rpc('create_org', { p_type: 'partner', p_name: name });
  if (error) throw new Error(`create_org failed: ${error.message}`);
  const orgId = String(data);
  const prof = await owner.client.rpc('save_partner_profile', { p_org: orgId, p_display_name: name, p_contact_email: `${uniq('contact')}@example.test` });
  if (prof.error) throw new Error(`save_partner_profile failed: ${prof.error.message}`);
  if (opts.approve !== false) await sql(`update public.partner_profiles set status = 'approved', decided_at = now() where org_id = $1`, [orgId]);
  return { owner, orgId, name };
}

/** Browser: sign in and pass the second step, then land on `path` (the partner/admin MFA verify page is handled here). */
export async function actorGoto(page: Page, a: Actor, path: string, opts: { login?: boolean } = {}): Promise<void> {
  if (opts.login !== false) await loginUi(page, a, 'en');
  await page.goto(path);
  if (/\/mfa\/verify/.test(page.url())) await submitCode(page, freshCode(a.secret));
  else if (/\/mfa\/enrol/.test(page.url())) throw new Error('unexpected MFA enrolment: the factor was enrolled through the API');
  const pathname = path.split('?')[0]!;
  await expect(page).toHaveURL((u) => u.pathname === pathname);
}

/** Browser: sign in a user who has no factor yet and enrol one through the UI. Returns the secret. */
export async function enrolInBrowser(page: Page, path: string, locale: Locale = 'en'): Promise<string> {
  await page.goto(path);
  await expect(page).toHaveURL(/\/mfa\/enrol/);
  const secret = await startEnrolAndReadSecret(page, locale);
  await submitCode(page, freshCode(secret));
  return secret;
}

// ------------------------------------------------------------------------------------------------ catalogue data

export const today = () => new Date().toISOString().slice(0, 10);

export function productData(sku: string, over: Record<string, unknown> = {}) {
  return {
    sku,
    name: `Brass lamp ${sku}`,
    description: 'Hand finished brass lamp for temples and homes.',
    category_slug: 'religious-items-puja',
    unit: 'piece',
    moq: 10,
    currency: 'INR',
    price_mode: 'tiers',
    tiers: [
      { min_qty: 10, max_qty: 99, unit_price: '250.00' },
      { min_qty: 100, max_qty: null, unit_price: '210.00' },
    ],
    lead_time_min_days: 5,
    lead_time_max_days: 10,
    availability_status: 'available',
    availability_confirmed_on: today(),
    price_confirmed_on: today(),
    ...over,
  };
}

export async function call<T = any>(client: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data as T;
}

/** Registers an already-scanned (clean) evidence document row as setup; the object itself is not stored (use the upload route when a download is tested). */
export async function registerCleanDoc(partner: Partner, supplierId: string, scan: 'clean' | 'pending' | 'failed' = 'clean'): Promise<string> {
  const file = `${randomBytes(8).toString('hex')}.pdf`;
  const rows = await sql<{ id: string }>(
    `select public.service_register_supplier_document($1, $2, $3, 'business_registration', 'registration.pdf', 'application/pdf', 2048, $4, $5, $6::public.scan_status, 'clamav') as id`,
    [partner.orgId, partner.owner.id, supplierId, randomBytes(32).toString('hex'), `supplier/${partner.orgId}/${supplierId}/${file}`, scan],
  );
  return rows[0]!.id;
}

/** Supplier saved by the partner (RPC) and, when `submit`, sent for review with a clean document. Returns ids and versions. */
export async function createSupplier(partner: Partner, opts: { submit?: boolean; name?: string } = {}) {
  const c = partner.owner.client;
  const name = opts.name ?? `Chennai Brass ${uniq('sup')}`;
  const saved = await call(c, 'save_supplier_draft', {
    p_org: partner.orgId,
    p_supplier: null,
    p_expected_version: null,
    p_data: {
      name,
      country: 'India',
      state_city: 'Chennai',
      main_category: 'religious-items-puja',
      description: 'Makers of brass lamps and temple items since 1998.',
      capabilities: ['Brass casting', 'Polishing'],
      code: uniq('SUP').slice(0, 20),
      contact_name: 'Ravi Kumar',
      contact_email: `${uniq('ravi')}@example.test`,
      contact_phone: '+91 90000 00000',
      registration_id: 'REG-12345',
      website: 'https://example.test',
    },
  });
  const id = saved.id as string;
  let docId: string | null = null;
  if (opts.submit !== false) {
    docId = await registerCleanDoc(partner, id);
    const cur = await call(c, 'get_supplier', { p_supplier: id });
    await call(c, 'submit_supplier', { p_org: partner.orgId, p_supplier: id, p_expected_version: cur.draft_version });
  }
  return { id, name, docId };
}

export async function approveSupplierAs(reviewer: Admin, supplierId: string, checks: string[] = ['contact_reachable', 'registration_document_seen']) {
  const cur = await call(reviewer.client, 'get_supplier', { p_supplier: supplierId });
  await call(reviewer.client, 'review_supplier', { p_supplier: supplierId, p_decision: 'approve', p_reason: null, p_checks: checks, p_expected_version: cur.draft_submitted_version });
}

/** A supplier approved by `reviewer`, ready to hold products. */
export async function approvedSupplier(partner: Partner, reviewer: Admin) {
  const s = await createSupplier(partner);
  await approveSupplierAs(reviewer, s.id);
  return s;
}

export async function createProduct(partner: Partner, supplierId: string, data: Record<string, unknown>, opts: { submit?: boolean } = {}) {
  const c = partner.owner.client;
  const saved = await call(c, 'save_product_draft', { p_org: partner.orgId, p_supplier: supplierId, p_product: null, p_expected_version: null, p_data: data });
  const id = saved.id as string;
  if (opts.submit !== false) await submitProduct(partner, id);
  return id;
}
export async function submitProduct(partner: Partner, productId: string) {
  const cur = await call(partner.owner.client, 'get_my_product', { p_org: partner.orgId, p_product: productId });
  return call(partner.owner.client, 'submit_product', { p_org: partner.orgId, p_product: productId, p_expected_version: cur.draft_version });
}
export async function editProduct(partner: Partner, supplierId: string, productId: string, data: Record<string, unknown>) {
  const cur = await call(partner.owner.client, 'get_my_product', { p_org: partner.orgId, p_product: productId });
  return call(partner.owner.client, 'save_product_draft', { p_org: partner.orgId, p_supplier: supplierId, p_product: productId, p_expected_version: cur.draft_version, p_data: data });
}
export async function approveProductAs(reviewer: Admin, productId: string) {
  const p = await call(reviewer.client, 'get_product_for_review', { p_product: productId });
  await call(reviewer.client, 'review_product', { p_product: productId, p_decision: 'approve', p_reason: null, p_expected_version: p.version });
}
export async function publishProduct(partner: Partner, productId: string) {
  const cur = await call(partner.owner.client, 'get_my_product', { p_org: partner.orgId, p_product: productId });
  await call(partner.owner.client, 'publish_product', { p_org: partner.orgId, p_product: productId, p_expected_version: cur.version });
}
/** Submit, approve (reviewer) and publish: a product on sale. */
export async function publishedProduct(partner: Partner, supplierId: string, reviewer: Admin, data: Record<string, unknown>) {
  const id = await createProduct(partner, supplierId, data);
  await approveProductAs(reviewer, id);
  await publishProduct(partner, id);
  return id;
}

/** What the public sees: search as an anonymous client. */
export async function publicSearch(q: string): Promise<{ id: string; name: string }[]> {
  const { data, error } = await anonClient().rpc('search_catalogue', { p_q: q, p_category: null, p_supplier: null, p_moq_max: null, p_price_min: null, p_price_max: null, p_currency: null, p_offset: 0, p_limit: 50 });
  if (error) throw new Error(`search_catalogue failed: ${error.message}`);
  return (data.items as { id: string; name: string }[]) ?? [];
}

export async function productRow(id: string) {
  return (await sql<{ status: string; version: number; suspended_reason: string | null; pending_revision_id: string | null; live_revision_id: string | null }>(
    `select status::text, version, suspended_reason, pending_revision_id, live_revision_id from public.products where id = $1`,
    [id],
  ))[0]!;
}
export async function supplierRow(id: string) {
  return (await sql<{ status: string; decision_reason: string | null; review_checks: string[] | null; reviewed_at: string | null; reviewed_by: string | null; draft_submitted_version: number | null; suspended_reason: string | null }>(
    `select status::text, decision_reason, review_checks, reviewed_at, reviewed_by, draft_submitted_version, suspended_reason from public.suppliers where id = $1`,
    [id],
  ))[0]!;
}
export async function supplierEvents(id: string) {
  return sql<{ kind: string; reason: string | null; actor_user_id: string | null; at: string; from_status: string | null; to_status: string | null }>(
    `select kind, reason, actor_user_id, at, from_status, to_status from public.supplier_events where supplier_id = $1 order by id`,
    [id],
  );
}
export async function revisions(productId: string) {
  return sql<{ rev_no: number; status: string; reason: string | null; decided_by: string | null; decided_at: string | null }>(
    `select rev_no, status::text, reason, decided_by, decided_at from public.product_revisions where product_id = $1 order by rev_no`,
    [productId],
  );
}

// ------------------------------------------------------------------------------------------------ checks

/** axe (serious and critical) plus the horizontal-scroll check, soft so every page of a journey is reported. */
export async function audit(page: Page, label: string) {
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const summary = bad.map((v) => `${v.id} [${v.impact}] ${v.help}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`).join('\n');
  expect.soft(bad, `axe serious/critical violations on ${label}:\n${summary}`).toEqual([]);
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect.soft(m.sw, `${label}: horizontal scroll (scrollWidth ${m.sw} > clientWidth ${m.cw})`).toBeLessThanOrEqual(m.cw);
}

/** Fills a decision form's reason, submits and waits for the announced result. */
export async function submitReasonForm(page: Page, form: { reasonSelector: string; reason: string; button: string }) {
  await page.locator(form.reasonSelector).fill(form.reason);
  await page.getByRole('button', { name: form.button, exact: true }).click();
}

export const HEX64 = /[0-9a-f]{64}/;

/** aal2 JS client for a user whose TOTP factor was enrolled in the browser (the secret was read from the enrolment page). */
export async function clientWithSecret(user: TestUser, secret: string): Promise<Actor> {
  const s = await signedClient(user);
  const { data: f, error } = await s.client.auth.mfa.listFactors();
  const factorId = f?.totp?.[0]?.id;
  if (error || !factorId) throw new Error(`no TOTP factor: ${error?.message}`);
  const { data: ch, error: e2 } = await s.client.auth.mfa.challenge({ factorId });
  if (e2 || !ch) throw new Error(`mfa.challenge failed: ${e2?.message}`);
  const { error: e3 } = await s.client.auth.mfa.verify({ factorId, challengeId: ch.id, code: freshCode(secret) });
  if (e3) throw new Error(`mfa.verify failed: ${e3.message}`);
  return { ...user, client: s.client, secret };
}

export const PARTNER_INVITE_LINK = /https?:\/\/[^\s"'<>)]*\/(?:en|ta|ms)\/invite\/partner\/[0-9a-f]{64}/;

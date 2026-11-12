import { randomBytes } from 'node:crypto';
import type { Session } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_URL, addMember, anonClient, cleanupUsers, createConfirmedUser, ensureMitraOrg, enrolAndVerifyTotp, resetBootstrapAfterTest, signIn, sql, uniq, type Signed } from './helpers';
import { MEDIA_BUCKET, deps, mediaPaths, partnerOwner, pdf, png, registerMedia, registerSupplierDoc, svc } from './p5-helpers';
import { ingestProductImage, ingestSupplierDocument } from '@/server/services/p5-files';
import { startClamdStub, type ClamdStub } from './clamd-stub';

/**
 * HTTP behaviour of the Phase 5 file routes against a RUNNING app (opt-in: needs a built app pointed at the local stack, started WITHOUT
 * CLAMD_HOST so that uploads are quarantined as pending):
 *
 *   npm run build && PORT=3500 npx next start -p 3500   (with the NEXT_PUBLIC_SUPABASE_* / SUPABASE_SECRET_KEY of `supabase status`)
 *   P5_HTTP_BASE=http://127.0.0.1:3500 npx vitest run --project integration tests/integration/p5-http.test.ts
 *
 * Skipped when P5_HTTP_BASE is not set, so CI (which does not run a server for the integration project) is unaffected.
 */
const BASE = process.env.P5_HTTP_BASE;
const d = BASE ? describe : describe.skip;

/** Cookie header carrying a Supabase session the way @supabase/ssr stores it (base64url JSON, chunked at 3180 characters). */
function cookieFor(session: Session): string {
  const name = `sb-${new URL(API_URL).hostname.split('.')[0]}-auth-token`;
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
  const chunks = value.match(/.{1,3180}/g) ?? [value];
  return chunks.length === 1 ? `${name}=${value}` : chunks.map((c, i) => `${name}.${i}=${c}`).join('; ');
}
const sessionOf = async (s: Signed) => (await s.client.auth.getSession()).data.session!;

let stub: ClamdStub;
let ownerA: Signed;
let ownerB: Signed;
let viewerA: Signed;
let aal1Cookie: string;
let cookieA: string;
let cookieB: string;
let cookieViewer: string;
let orgA: string;
let supplierA: string;
let productA: string;
let ORIGIN: string;

async function post(path: string, form: FormData, cookie?: string, origin: string | null = ORIGIN) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  return fetch(`${BASE}${path}`, { method: 'POST', headers, body: form });
}
const file = (bytes: Uint8Array, name: string, type: string) => {
  const f = new FormData();
  f.set('file', new File([bytes as BlobPart], name, { type }));
  return f;
};

beforeAll(async () => {
  if (!BASE) return;
  ORIGIN = new URL(BASE).origin;
  stub = await startClamdStub();
  const a = await partnerOwner('h5a');
  const b = await partnerOwner('h5b');
  ownerA = a.s;
  ownerB = b.s;
  orgA = a.org;
  aal1Cookie = cookieFor(ownerA.session); // the session as it was BEFORE the second factor
  cookieA = cookieFor(await sessionOf(ownerA));
  cookieB = cookieFor(await sessionOf(ownerB));
  // a viewer in partner org A (read-only role)
  viewerA = await signIn(await createConfirmedUser('h5v'));
  await addMember(orgA, viewerA.user.id, 'viewer');
  cookieViewer = cookieFor(await sessionOf(viewerA));

  const sup = await ownerA.client.rpc('save_supplier_draft', {
    p_org: orgA, p_supplier: null, p_expected_version: null,
    p_data: { name: 'Madurai Spices', country: 'India', main_category: 'spices-condiments', code: uniq('H5').slice(0, 20) },
  });
  expect(sup.error).toBeNull();
  supplierA = sup.data.id;
  const prod = await ownerA.client.rpc('save_product_draft', { p_org: orgA, p_supplier: supplierA, p_product: null, p_expected_version: null, p_data: { sku: uniq('S').slice(0, 20), name: 'Turmeric powder' } });
  expect(prod.error).toBeNull();
  productA = prod.data.id;
});
afterAll(async () => {
  if (!BASE) return;
  await stub.close();
  if (mediaPaths.length) await svc.storage.from(MEDIA_BUCKET).remove(mediaPaths);
  await cleanupUsers();
  await resetBootstrapAfterTest();
});

d('POST /api/v1/suppliers/[id]/documents', () => {
  const url = () => `/api/v1/suppliers/${supplierA}/documents`;
  const form = (bytes = pdf(), docType = 'business_registration') => {
    const f = file(bytes, 'registration.pdf', 'application/pdf');
    f.set('docType', docType);
    return f;
  };

  it('refuses a cross-site or origin-less request (CSRF) before anything else', async () => {
    expect((await post(url(), form(), cookieA, 'https://evil.example')).status).toBe(403);
    expect((await post(url(), form(), cookieA, null)).status).toBe(403);
  });
  it('refuses anonymous callers (401) and malformed ids (404)', async () => {
    expect((await post(url(), form(), undefined)).status).toBe(401);
    expect((await post('/api/v1/suppliers/not-a-uuid/documents', form(), cookieA)).status).toBe(404);
  });
  it('is hidden from another partner organisation (404) and refused for a viewer (403)', async () => {
    expect((await post(url(), form(), cookieB)).status).toBe(404);
    expect((await post(url(), form(), cookieViewer)).status).toBe(403); // viewers can read the supplier but not manage it
  });
  it('a partner owner who has not completed MFA is refused (403)', async () => {
    expect((await post(url(), form(), aal1Cookie)).status).toBe(403);
  });
  it('rejects a wrong type, a bad document type and an oversized body', async () => {
    const exe = file(Buffer.from('MZ-not-a-pdf'), 'x.pdf', 'application/pdf');
    exe.set('docType', 'other');
    const r1 = await post(url(), exe, cookieA);
    expect(r1.status).toBe(415);
    expect(await r1.json()).toEqual({ ok: false, errorKey: 'file_type_not_allowed' });
    const f2 = form();
    f2.set('docType', 'passport');
    expect((await post(url(), f2, cookieA)).status).toBe(422);
    const big = file(Buffer.alloc(11 * 1024 * 1024, 0x20), 'big.pdf', 'application/pdf');
    big.set('docType', 'other');
    expect((await post(url(), big, cookieA)).status).toBe(413);
  });
  it('with no scanner configured the upload is quarantined: stored and registered as pending, and NOT downloadable', async () => {
    const r = await post(url(), form(), cookieA);
    expect(r.status).toBe(201);
    const body = (await r.json()) as { ok: boolean; id: string; scanStatus: string };
    expect(body).toMatchObject({ ok: true, scanStatus: 'pending' });
    const dl = await fetch(`${BASE}${url()}/${body.id}`, { headers: { cookie: cookieA } });
    expect(dl.status).toBe(404);
  });
  it('a clean document downloads for its owner only, as a no-store attachment', async () => {
    const reg = await ingestSupplierDocument(deps('verification-docs', stub.port, registerSupplierDoc(orgA, ownerA.user.id, supplierA)), {
      orgId: orgA, supplierId: supplierA, fileName: 'licence.pdf', declaredMime: 'application/pdf', bytes: pdf(),
    });
    const id = (reg as { id: string }).id;
    const ok = await fetch(`${BASE}${url()}/${id}`, { headers: { cookie: cookieA } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('application/pdf');
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
    expect(ok.headers.get('content-disposition')).toMatch(/^attachment/);
    expect((await fetch(`${BASE}${url()}/${id}`, { headers: { cookie: cookieB } })).status).toBe(404);
    expect((await fetch(`${BASE}${url()}/${id}`)).status).toBe(404);
    // the document must belong to the supplier named in the URL
    const other = await ownerB.client.rpc('save_supplier_draft', { p_org: (await sql<{ org_id: string }>(`select org_id from public.memberships where user_id = $1 limit 1`, [ownerB.user.id]))[0]!.org_id, p_supplier: null, p_expected_version: null, p_data: { name: 'Other Supplier', country: 'India', main_category: 'other', code: uniq('O').slice(0, 20) } });
    expect(other.error).toBeNull();
    expect((await fetch(`${BASE}/api/v1/suppliers/${other.data.id}/documents/${id}`, { headers: { cookie: cookieA } })).status).toBe(404);
  });
});

d('POST /api/v1/products/[id]/media and GET /api/v1/catalogue-media/[id]', () => {
  const url = () => `/api/v1/products/${productA}/media`;
  const img = (bytes: Uint8Array = png(), name = 'a.png', type = 'image/png') => {
    const f = file(bytes, name, type);
    f.set('alt', 'A jar of turmeric powder');
    return f;
  };

  it('same guards: CSRF, anonymous, other partner, viewer, no MFA', async () => {
    expect((await post(url(), img(), cookieA, 'https://evil.example')).status).toBe(403);
    expect((await post(url(), img())).status).toBe(401);
    expect((await post(url(), img(), cookieB)).status).toBe(404);
    expect((await post(url(), img(), cookieViewer)).status).toBe(403);
    expect((await post(url(), img(), aal1Cookie)).status).toBe(403);
  });
  it('rejects gif, svg, a spoofed type and a file over 5 MiB', async () => {
    expect((await post(url(), img(Buffer.from('GIF89a......'), 'a.gif', 'image/gif'), cookieA)).status).toBe(415);
    expect((await post(url(), img(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'a.svg', 'image/svg+xml'), cookieA)).status).toBe(415);
    expect((await post(url(), img(png(), 'a.png', 'image/jpeg'), cookieA)).status).toBe(415);
    const big = img(Buffer.concat([png(), Buffer.alloc(5 * 1024 * 1024)]));
    expect((await post(url(), big, cookieA)).status).toBe(413);
  });

  let pendingId: string;
  it('with no scanner the image is registered pending and is NOT served to anyone, including its owner', async () => {
    const r = await post(url(), img(), cookieA);
    expect(r.status).toBe(201);
    const body = (await r.json()) as { id: string; scanStatus: string };
    expect(body.scanStatus).toBe('pending');
    pendingId = body.id;
    for (const c of [cookieA, undefined]) {
      const g = await fetch(`${BASE}/api/v1/catalogue-media/${pendingId}`, { headers: c ? { cookie: c } : {} });
      expect(g.status).toBe(404);
    }
  });

  it('serves a clean image to its owner but not to the public while the product is unpublished; unknown ids are 404', async () => {
    const r = await ingestProductImage(deps(MEDIA_BUCKET, stub.port, registerMedia(orgA, ownerA.user.id, productA)), { orgId: orgA, productId: productA, fileName: 'c.png', declaredMime: 'image/png', bytes: png() });
    const id = (r as { id: string }).id;
    const own = await fetch(`${BASE}/api/v1/catalogue-media/${id}`, { headers: { cookie: cookieA } });
    expect(own.status).toBe(200);
    expect(own.headers.get('content-type')).toBe('image/png');
    expect(own.headers.get('x-content-type-options')).toBe('nosniff');
    expect(own.headers.get('cache-control')).toBe('private, no-cache');
    expect(own.headers.get('content-disposition')).toBe('inline');
    expect((await fetch(`${BASE}/api/v1/catalogue-media/${id}`)).status).toBe(404);
    expect((await fetch(`${BASE}/api/v1/catalogue-media/${id}`, { headers: { cookie: cookieB } })).status).toBe(404);
    expect((await fetch(`${BASE}/api/v1/catalogue-media/00000000-0000-4000-8000-000000000000`)).status).toBe(404);
    expect((await fetch(`${BASE}/api/v1/catalogue-media/not-a-uuid`)).status).toBe(404);
    const etag = own.headers.get('etag')!;
    expect(etag).toBeTruthy();
    expect((await fetch(`${BASE}/api/v1/catalogue-media/${id}`, { headers: { cookie: cookieA, 'if-none-match': etag } })).status).toBe(304);
    // a revalidation by someone who is NOT allowed gets 404 even with the right ETag
    expect((await fetch(`${BASE}/api/v1/catalogue-media/${id}`, { headers: { 'if-none-match': etag } })).status).toBe(404);
  });

  it('after the approval workflow the public gets the image; unpublishing takes it away at once', async () => {
    const r = await ingestProductImage(deps(MEDIA_BUCKET, stub.port, registerMedia(orgA, ownerA.user.id, productA)), { orgId: orgA, productId: productA, fileName: 'p.png', declaredMime: 'image/png', bytes: png() });
    const id = (r as { id: string }).id;
    expect((await ingestSupplierDocument(deps('verification-docs', stub.port, registerSupplierDoc(orgA, ownerA.user.id, supplierA)), { orgId: orgA, supplierId: supplierA, fileName: 'r.pdf', declaredMime: 'application/pdf', bytes: pdf() })).ok).toBe(true);
    const cur = await ownerA.client.rpc('get_supplier', { p_supplier: supplierA });
    const saved = await ownerA.client.rpc('save_supplier_draft', {
      p_org: orgA, p_supplier: supplierA, p_expected_version: cur.data.draft_version,
      p_data: { description: 'Stone-ground spices from Madurai, family run.', contact_name: 'Meena', contact_email: 'meena@example.test' },
    });
    expect(saved.error).toBeNull();
    expect((await ownerA.client.rpc('submit_supplier', { p_org: orgA, p_supplier: supplierA, p_expected_version: saved.data.version })).error).toBeNull();
    const reviewer = await signIn(await createConfirmedUser('h5rv'));
    await addMember(await ensureMitraOrg(reviewer.user.id), reviewer.user.id, 'admin_review');
    await enrolAndVerifyTotp(reviewer.client);
    const sup = await reviewer.client.rpc('get_supplier', { p_supplier: supplierA });
    expect((await reviewer.client.rpc('review_supplier', { p_supplier: supplierA, p_decision: 'approve', p_reason: null, p_checks: ['contact_reachable'], p_expected_version: sup.data.draft_submitted_version })).error).toBeNull();
    const today = new Date().toISOString().slice(0, 10);
    const pcur = await ownerA.client.rpc('get_my_product', { p_org: orgA, p_product: productA });
    const draft = await ownerA.client.rpc('save_product_draft', {
      p_org: orgA, p_supplier: supplierA, p_product: productA, p_expected_version: pcur.data.draft_version,
      p_data: { description: 'Ground turmeric', category_slug: 'spices-condiments', unit: 'kg', moq: 25, currency: 'INR', price_mode: 'fixed', unit_price: '210.00', availability_status: 'available', availability_confirmed_on: today, price_confirmed_on: today },
    });
    expect(draft.error).toBeNull();
    expect((await ownerA.client.rpc('submit_product', { p_org: orgA, p_product: productA, p_expected_version: draft.data.draft_version })).error).toBeNull();
    const p1 = await ownerA.client.rpc('get_my_product', { p_org: orgA, p_product: productA });
    expect((await reviewer.client.rpc('review_product', { p_product: productA, p_decision: 'approve', p_reason: null, p_expected_version: p1.data.version })).error).toBeNull();
    const p2 = await ownerA.client.rpc('get_my_product', { p_org: orgA, p_product: productA });
    expect((await ownerA.client.rpc('publish_product', { p_org: orgA, p_product: productA, p_expected_version: p2.data.version })).error).toBeNull();

    const pub = await fetch(`${BASE}/api/v1/catalogue-media/${id}`);
    expect(pub.status).toBe(200);
    expect(pub.headers.get('content-type')).toBe('image/png');
    expect(pub.headers.get('cache-control')).toBe('private, no-cache'); // never a shared-cache entry that could outlive publication
    expect(Buffer.from(await pub.arrayBuffer()).subarray(0, 4).toString('hex')).toBe('89504e47');
    // the image that was pending stays unavailable; an anonymous client of the database agrees
    expect((await fetch(`${BASE}/api/v1/catalogue-media/${pendingId}`)).status).toBe(404);
    expect((await anonClient().rpc('get_product_media_access', { p_media: pendingId })).error).not.toBeNull();

    expect((await ownerA.client.rpc('unpublish_product', { p_org: orgA, p_product: productA })).error).toBeNull();
    expect((await fetch(`${BASE}/api/v1/catalogue-media/${id}`)).status).toBe(404);
  });

  it('the ninth image per product is refused with 409', async () => {
    const n = async () => Number((await sql<{ n: string }>('select count(*)::text n from public.product_media where product_id = $1 and removed_at is null', [productA]))[0]!.n);
    while ((await n()) < 8) {
      const r = await ingestProductImage(deps(MEDIA_BUCKET, stub.port, registerMedia(orgA, ownerA.user.id, productA)), { orgId: orgA, productId: productA, fileName: 'f.png', declaredMime: 'image/png', bytes: png(randomBytes(40)) });
      expect(r.ok).toBe(true);
    }
    const r = await post(url(), img(), cookieA);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ ok: false, errorKey: 'media_limit_reached' });
  });
});

d('partner section and entry points', () => {
  const get = (path: string, cookie?: string) => fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {}, redirect: 'manual' });

  it('the partner dashboard renders the sidebar for a member, is hidden (404) from others and redirects anonymous callers to sign-in', async () => {
    const r = await get(`/en/orgs/${orgA}/partner`, cookieA);
    expect(r.status).toBe(200);
    const html = await r.text();
    for (const label of ['Home', 'Suppliers', 'Products', 'Import Catalogue', 'Buyer Requests', 'Notifications', 'Settings']) expect(html, label).toContain(label);
    expect(html).toContain(`/en/orgs/${orgA}/partner/suppliers`);
    expect(html).toContain('partner-nav');
    expect((await get(`/en/orgs/${orgA}/partner`, cookieB)).status).toBe(404);
    const anon = await get(`/en/orgs/${orgA}/partner`);
    expect([302, 303, 307]).toContain(anon.status);
    expect(anon.headers.get('location')).toContain('/en/login');
    // a partner owner who has not completed MFA is sent to the second-factor page
    const aal1 = await get(`/en/orgs/${orgA}/partner`, aal1Cookie);
    expect([302, 303, 307]).toContain(aal1.status);
    expect(aal1.headers.get('location')).toMatch(/\/mfa\//);
  });

  it('the organisations list links a partner organisation to its dashboard, and the header offers Products from India to everyone', async () => {
    const orgs = await (await get('/en/orgs', cookieA)).text();
    expect(orgs).toContain(`/en/orgs/${orgA}/partner`);
    expect(orgs).toContain('Partner dashboard');
    for (const [loc, text] of [['en', 'Products from India'], ['ms', 'Produk dari India']] as const) {
      const home = await (await get(`/${loc}`)).text();
      expect(home, loc).toContain(text);
      expect(home, loc).toContain(`/${loc}/catalogue`);
    }
  });
});

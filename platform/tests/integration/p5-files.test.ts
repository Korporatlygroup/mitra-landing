import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanWithClamd } from '@/server/scanner';
import { rescanPending, type RescanDeps } from '@/server/services/documents';
import { ingestProductImage, ingestSupplierDocument } from '@/server/services/p5-files';
import { EICAR, closedPort, startClamdStub, type ClamdStub } from './clamd-stub';
import { DOCS_BUCKET, addMember, anonClient, cleanupUsers, createConfirmedUser, enrolAndVerifyTotp, ensureMitraOrg, resetBootstrapAfterTest, signIn, sql, uniq, type Signed } from './helpers';
import { MEDIA_BUCKET, deps, mediaPaths, partnerOwner, pdf, png, registerMedia, registerSupplierDoc, sha, svc } from './p5-helpers';

// Phase 5 file pipeline against the REAL local stack: private buckets, the service-role RPCs and the user-facing access RPCs, with a stub
// clamd as scanner. (The route handlers are thin wrappers over exactly these pieces; their HTTP behaviour is checked against a running app.)

let stub: ClamdStub;
let deadPort: number;
let ownerA: Signed;
let ownerB: Signed;
let orgA: string;
let orgB: string;
let supplierA: string;
let productA: string;

async function objectExists(bucket: string, path: string) {
  return !(await svc.storage.from(bucket).download(path)).error;
}
const mediaCount = async () => Number((await sql<{ n: string }>('select count(*)::text n from public.product_media where product_id = $1 and removed_at is null', [productA]))[0]!.n);

beforeAll(async () => {
  stub = await startClamdStub();
  deadPort = await closedPort();
  ({ s: ownerA, org: orgA } = await partnerOwner('p5a'));
  ({ s: ownerB, org: orgB } = await partnerOwner('p5b'));
  const sup = await ownerA.client.rpc('save_supplier_draft', {
    p_org: orgA, p_supplier: null, p_expected_version: null,
    p_data: { name: 'Chennai Textiles', country: 'India', state_city: 'Chennai', main_category: 'textiles-apparel', code: uniq('SUP').slice(0, 20) },
  });
  expect(sup.error).toBeNull();
  supplierA = sup.data.id;
  const prod = await ownerA.client.rpc('save_product_draft', { p_org: orgA, p_supplier: supplierA, p_product: null, p_expected_version: null, p_data: { sku: uniq('SKU').slice(0, 20), name: 'Cotton saree' } });
  expect(prod.error).toBeNull();
  productA = prod.data.id;
});
afterAll(async () => {
  await stub.close();
  if (mediaPaths.length) await svc.storage.from(MEDIA_BUCKET).remove(mediaPaths);
  await cleanupUsers();
  await resetBootstrapAfterTest();
});

describe('supplier evidence', () => {
  it('a clean PDF is scanned, stored under supplier/<org>/<supplier>/, registered clean and listed for the partner', async () => {
    const bytes = pdf();
    const r = await ingestSupplierDocument(deps(DOCS_BUCKET, stub.port, registerSupplierDoc(orgA, ownerA.user.id, supplierA)), {
      orgId: orgA, supplierId: supplierA, fileName: 'registration.pdf', declaredMime: 'application/pdf', bytes,
    });
    expect(r).toMatchObject({ ok: true, scanStatus: 'clean' });
    const row = (await sql<{ storage_path: string; sha256: string; scan_status: string; partner_org_id: string }>('select * from public.supplier_documents where id = $1', [(r as { id: string }).id]))[0]!;
    expect(row.storage_path.startsWith(`supplier/${orgA}/${supplierA}/`)).toBe(true);
    expect(row.sha256).toBe(sha(bytes));
    expect(row.scan_status).toBe('clean');
    expect(await objectExists(DOCS_BUCKET, row.storage_path)).toBe(true);
    const detail = await ownerA.client.rpc('get_supplier', { p_supplier: supplierA });
    expect(detail.error).toBeNull();
    expect(detail.data.documents.map((d: { id: string }) => d.id)).toContain((r as { id: string }).id);
  });

  it('EICAR is rejected and nothing is stored or registered', async () => {
    const before = Number((await sql<{ n: string }>('select count(*)::text n from public.supplier_documents where supplier_id = $1', [supplierA]))[0]!.n);
    const r = await ingestSupplierDocument(deps(DOCS_BUCKET, stub.port, registerSupplierDoc(orgA, ownerA.user.id, supplierA)), {
      orgId: orgA, supplierId: supplierA, fileName: 'bad.pdf', declaredMime: 'application/pdf', bytes: Buffer.from(`%PDF-1.4\n% ${EICAR}\n%%EOF\n`),
    });
    expect(r).toEqual({ ok: false, errorKey: 'file_infected' });
    expect(Number((await sql<{ n: string }>('select count(*)::text n from public.supplier_documents where supplier_id = $1', [supplierA]))[0]!.n)).toBe(before);
  });

  it('a scanner outage stores the file as pending: it exists, is registered, and is NOT accessible', async () => {
    const r = await ingestSupplierDocument(deps(DOCS_BUCKET, deadPort, registerSupplierDoc(orgA, ownerA.user.id, supplierA, 'tax_registration')), {
      orgId: orgA, supplierId: supplierA, fileName: 'tax.pdf', declaredMime: 'application/pdf', bytes: pdf(),
    });
    expect(r).toMatchObject({ ok: true, scanStatus: 'pending' });
    const id = (r as { id: string }).id;
    const access = await ownerA.client.rpc('get_supplier_document_access', { p_doc: id });
    expect(access.error).not.toBeNull();
    expect(access.data).toBeNull();
  });

  it('access: the owner gets a path for a clean document; another partner and anonymous callers do not', async () => {
    const r = await ingestSupplierDocument(deps(DOCS_BUCKET, stub.port, registerSupplierDoc(orgA, ownerA.user.id, supplierA, 'catalogue')), {
      orgId: orgA, supplierId: supplierA, fileName: 'catalogue.pdf', declaredMime: 'application/pdf', bytes: pdf(),
    });
    const id = (r as { id: string }).id;
    const mine = await ownerA.client.rpc('get_supplier_document_access', { p_doc: id });
    expect(mine.error).toBeNull();
    expect(mine.data.storage_path).toMatch(new RegExp(`^supplier/${orgA}/${supplierA}/`));
    expect((await ownerB.client.rpc('get_supplier_document_access', { p_doc: id })).error).not.toBeNull();
    expect((await anonClient().rpc('get_supplier_document_access', { p_doc: id })).error).not.toBeNull();
    // another partner cannot read the supplier either (hidden: not found)
    expect((await ownerB.client.rpc('get_supplier', { p_supplier: supplierA })).error).not.toBeNull();
  });

  it('a member of another partner organisation cannot register a document for this supplier, and the stored object is rolled back', async () => {
    const r = await ingestSupplierDocument(deps(DOCS_BUCKET, stub.port, registerSupplierDoc(orgA, ownerB.user.id, supplierA)), {
      orgId: orgA, supplierId: supplierA, fileName: 'x.pdf', declaredMime: 'application/pdf', bytes: pdf(),
    });
    expect(r).toEqual({ ok: false, errorKey: 'forbidden' });
    const { data } = await svc.storage.from(DOCS_BUCKET).list(`supplier/${orgA}/${supplierA}`, { limit: 1000 });
    const rows = await sql<{ storage_path: string }>('select storage_path from public.supplier_documents where supplier_id = $1', [supplierA]);
    expect((data ?? []).length).toBe(rows.length); // every stored object has a row
  });
});

describe('product images', () => {
  it('a clean PNG is stripped, scanned, stored in the private bucket and registered; unpublished images are not public', async () => {
    const bytes = png(randomBytes(32), true);
    const r = await ingestProductImage(deps(MEDIA_BUCKET, stub.port, registerMedia(orgA, ownerA.user.id, productA)), { orgId: orgA, productId: productA, fileName: 'front.png', declaredMime: 'image/png', bytes });
    expect(r).toMatchObject({ ok: true, scanStatus: 'clean' });
    const id = (r as { id: string }).id;
    const row = (await sql<{ storage_path: string; sha256: string; scan_status: string; approved: boolean }>('select * from public.product_media where id = $1', [id]))[0]!;
    expect(row.storage_path.startsWith(`products/${orgA}/${productA}/`)).toBe(true);
    expect(row.scan_status).toBe('clean');
    const stored = Buffer.from(await (await svc.storage.from(MEDIA_BUCKET).download(row.storage_path)).data!.arrayBuffer());
    expect(stored.toString('latin1')).not.toContain('gps-secret'); // metadata was stripped before storing
    expect(sha(stored)).toBe(row.sha256);
    expect(row.approved).toBe(false);
    // not approved/published: anonymous and other partners get nothing; the owner can open a clean one
    expect((await anonClient().rpc('get_product_media_access', { p_media: id })).error).not.toBeNull();
    expect((await ownerB.client.rpc('get_product_media_access', { p_media: id })).error).not.toBeNull();
    const own = await ownerA.client.rpc('get_product_media_access', { p_media: id });
    expect(own.error).toBeNull();
    expect(own.data).toMatchObject({ mime_type: 'image/png' });
  });

  it('with the scanner down the image is stored as pending and is inaccessible to everyone, then clean after a rescan', async () => {
    const r = await ingestProductImage(deps(MEDIA_BUCKET, deadPort, registerMedia(orgA, ownerA.user.id, productA)), { orgId: orgA, productId: productA, fileName: 'side.png', declaredMime: 'image/png', bytes: png() });
    expect(r).toMatchObject({ ok: true, scanStatus: 'pending' });
    const id = (r as { id: string }).id;
    for (const c of [ownerA.client, anonClient()]) expect((await c.rpc('get_product_media_access', { p_media: id })).error).not.toBeNull();

    const scoped: RescanDeps = {
      list: async (limit) => sql(`select id, storage_path, mime_type from public.product_media where id = $1 and scan_status in ('pending','failed') limit $2`, [id, limit]),
      download: async (p) => {
        const { data } = await svc.storage.from(MEDIA_BUCKET).download(p);
        return data ? new Uint8Array(await data.arrayBuffer()) : null;
      },
      scan: (bytes) => scanWithClamd(bytes, { host: '127.0.0.1', port: stub.port, timeoutMs: 8000 }),
      setResult: async (mid, status, engine) => !(await svc.rpc('service_set_product_media_scan', { p_media: mid, p_status: status, p_engine: engine })).error,
      remove: async (p) => !(await svc.storage.from(MEDIA_BUCKET).remove([p])).error,
    };
    expect(await rescanPending(scoped, 5)).toMatchObject({ checked: 1, clean: 1 });
    expect((await ownerA.client.rpc('get_product_media_access', { p_media: id })).error).toBeNull();
  });

  it('EICAR inside an image is rejected and leaves nothing behind', async () => {
    const before = await mediaCount();
    const r = await ingestProductImage(deps(MEDIA_BUCKET, stub.port, registerMedia(orgA, ownerA.user.id, productA)), { orgId: orgA, productId: productA, fileName: 'x.png', declaredMime: 'image/png', bytes: png(Buffer.from(EICAR, 'latin1')) });
    expect(r).toEqual({ ok: false, errorKey: 'file_infected' });
    expect(await mediaCount()).toBe(before);
  });

  it('only an image that was part of the APPROVED and PUBLISHED revision is public; unpublishing makes it 404 again', async () => {
    const r = await ingestProductImage(deps(MEDIA_BUCKET, stub.port, registerMedia(orgA, ownerA.user.id, productA)), { orgId: orgA, productId: productA, fileName: 'pub.png', declaredMime: 'image/png', bytes: png() });
    const id = (r as { id: string }).id;
    // evidence + contact, submit the supplier, MITRA approves it (reviewer at aal2), then the product goes through review and publish
    expect((await ingestSupplierDocument(deps(DOCS_BUCKET, stub.port, registerSupplierDoc(orgA, ownerA.user.id, supplierA)), { orgId: orgA, supplierId: supplierA, fileName: 'r.pdf', declaredMime: 'application/pdf', bytes: pdf() })).ok).toBe(true);
    const cur = await ownerA.client.rpc('get_supplier', { p_supplier: supplierA });
    const saved = await ownerA.client.rpc('save_supplier_draft', {
      p_org: orgA, p_supplier: supplierA, p_expected_version: cur.data.draft_version,
      p_data: { description: 'Handloom cotton sarees made in Chennai since 1998.', contact_name: 'Ravi', contact_email: 'ravi@example.test' },
    });
    expect(saved.error).toBeNull();
    expect((await ownerA.client.rpc('submit_supplier', { p_org: orgA, p_supplier: supplierA, p_expected_version: saved.data.version })).error).toBeNull();
    const reviewer = await signIn(await createConfirmedUser('p5rv'));
    await addMember(await ensureMitraOrg(reviewer.user.id), reviewer.user.id, 'admin_review');
    await enrolAndVerifyTotp(reviewer.client);
    const sup = await reviewer.client.rpc('get_supplier', { p_supplier: supplierA });
    expect((await reviewer.client.rpc('review_supplier', { p_supplier: supplierA, p_decision: 'approve', p_reason: null, p_checks: ['contact_reachable'], p_expected_version: sup.data.draft_submitted_version })).error).toBeNull();

    const today = new Date().toISOString().slice(0, 10);
    const pcur = await ownerA.client.rpc('get_my_product', { p_org: orgA, p_product: productA });
    const draft = await ownerA.client.rpc('save_product_draft', {
      p_org: orgA, p_supplier: supplierA, p_product: productA, p_expected_version: pcur.data.draft_version,
      p_data: { description: 'Soft cotton saree', category_slug: 'textiles-apparel', unit: 'piece', moq: 10, currency: 'INR', price_mode: 'fixed', unit_price: '450.00', availability_status: 'available', availability_confirmed_on: today, price_confirmed_on: today },
    });
    expect(draft.error).toBeNull();
    expect((await ownerA.client.rpc('submit_product', { p_org: orgA, p_product: productA, p_expected_version: draft.data.draft_version })).error).toBeNull();
    const p1 = await ownerA.client.rpc('get_my_product', { p_org: orgA, p_product: productA });
    expect((await reviewer.client.rpc('review_product', { p_product: productA, p_decision: 'approve', p_reason: null, p_expected_version: p1.data.version })).error).toBeNull();
    // approved but not published yet: still not public
    expect((await anonClient().rpc('get_product_media_access', { p_media: id })).error).not.toBeNull();
    const p2 = await ownerA.client.rpc('get_my_product', { p_org: orgA, p_product: productA });
    expect((await ownerA.client.rpc('publish_product', { p_org: orgA, p_product: productA, p_expected_version: p2.data.version })).error).toBeNull();

    const anon = await anonClient().rpc('get_product_media_access', { p_media: id });
    expect(anon.error).toBeNull();
    expect(anon.data.storage_path).toMatch(/^products\//);
    // an image added AFTER the approved revision is not public until a new revision is approved
    const later = await ingestProductImage(deps(MEDIA_BUCKET, stub.port, registerMedia(orgA, ownerA.user.id, productA)), { orgId: orgA, productId: productA, fileName: 'later.png', declaredMime: 'image/png', bytes: png() });
    expect((await anonClient().rpc('get_product_media_access', { p_media: (later as { id: string }).id })).error).not.toBeNull();
    expect((await ownerA.client.rpc('unpublish_product', { p_org: orgA, p_product: productA })).error).toBeNull();
    expect((await anonClient().rpc('get_product_media_access', { p_media: id })).error).not.toBeNull();
  });

  it('the ninth image is refused (media_limit_reached) and its object is rolled back', async () => {
    while ((await mediaCount()) < 8) {
      const r = await ingestProductImage(deps(MEDIA_BUCKET, stub.port, registerMedia(orgA, ownerA.user.id, productA)), { orgId: orgA, productId: productA, fileName: 'f.png', declaredMime: 'image/png', bytes: png() });
      expect(r.ok).toBe(true);
    }
    const before = (await svc.storage.from(MEDIA_BUCKET).list(`products/${orgA}/${productA}`, { limit: 1000 })).data!.length;
    const r = await ingestProductImage(deps(MEDIA_BUCKET, stub.port, registerMedia(orgA, ownerA.user.id, productA)), { orgId: orgA, productId: productA, fileName: 'ninth.png', declaredMime: 'image/png', bytes: png() });
    expect(r).toEqual({ ok: false, errorKey: 'media_limit_reached' });
    expect((await svc.storage.from(MEDIA_BUCKET).list(`products/${orgA}/${productA}`, { limit: 1000 })).data!.length).toBe(before);
  });

  it('no API role can read or write either bucket directly', async () => {
    const anon = anonClient();
    expect((await anon.storage.from(MEDIA_BUCKET).download(`products/${orgA}/${productA}/anything.png`)).error).not.toBeNull();
    expect((await ownerA.client.storage.from(MEDIA_BUCKET).upload(`products/${orgA}/${productA}/direct-${uniq('x')}.png`, png(), { contentType: 'image/png' })).error).not.toBeNull();
    expect((await ownerA.client.storage.from(DOCS_BUCKET).upload(`supplier/${orgA}/${supplierA}/direct-${uniq('x')}.pdf`, pdf(), { contentType: 'application/pdf' })).error).not.toBeNull();
  });
});

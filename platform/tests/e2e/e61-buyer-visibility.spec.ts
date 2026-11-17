import { expect, test } from '@playwright/test';
import { anonClient, createOrgAs, createUser, signedClient, sql, uniq, type Signed, type TestUser } from './support/db';
import {
  card, changePrice, makeDraftProduct, makeModerator, makePartner, makeProduct, makeRejectedProduct, makeReviewer, makeSupplier, reinstateSupplier, requestsOfBuyer, suspendProduct, suspendSupplier, tb, unpublish,
  type Partner, type Product, type Supplier,
} from './support/p5-buyer';
import { loginUi } from './support/ui';

// E61 (security): what buyers and anonymous visitors can and cannot see or do. Hidden products are a plain 404, private supplier data never
// appears in any HTML or API answer, a paused supplier cannot receive requests, a later price edit does not change a sent request, and
// another buyer cannot read mine. Persisted state is checked in the database.

const L = 'en' as const;
const t = (k: string, v: Record<string, string> = {}) => tb(L, k, v);
const tag = uniq('b61').replace(/-/g, '');
const SECRETS = ['supplier-secret.test', 'PRIVATE-REG-0001', 'Private Contact Person', 'secret-registration', '+91 99999 00000', 'private-supplier.example.test'];

let partner: Partner;
let reviewer: Signed, moderator: Signed;
let supOk: Supplier, supBad: Supplier;
let pub: Product, draft: Product, unpub: Product, suspProd: Product, rejected: Product, onSuspendedSupplier: Product, forSuspend: Product, forPrice: Product;
let buyer: TestUser, other: TestUser;
let buyerClient: Signed;

test.beforeAll(async () => {
  test.setTimeout(300_000);
  reviewer = await makeReviewer();
  moderator = await makeModerator();
  partner = await makePartner('b61-partner');
  supOk = await makeSupplier(partner, reviewer, { name: `Visible Supplier ${tag}` });
  supBad = await makeSupplier(partner, reviewer, { name: `Paused Supplier ${tag}` });
  pub = await makeProduct(supOk, reviewer, { name: `Visible Item ${tag}`, image: true });
  draft = await makeDraftProduct(supOk, `Draft Item ${tag}`);
  unpub = await makeProduct(supOk, reviewer, { name: `Unpublished Item ${tag}`, image: true });
  await unpublish(unpub);
  suspProd = await makeProduct(supOk, reviewer, { name: `Suspended Item ${tag}`, image: true });
  await suspendProduct(moderator, suspProd);
  rejected = await makeRejectedProduct(supOk, reviewer, `Rejected Item ${tag}`);
  forSuspend = await makeProduct(supOk, reviewer, { name: `Request Item ${tag}`, moq: 10 });
  forPrice = await makeProduct(supOk, reviewer, { name: `Price Item ${tag}`, moq: 10, tiers: [{ min_qty: 10, max_qty: null, unit_price: '450.00' }] });
  onSuspendedSupplier = await makeProduct(supBad, reviewer, { name: `OnPausedSupplier Item ${tag}`, image: true });
  await suspendSupplier(moderator, supBad);
  buyer = await createUser('b61-buyer');
  other = await createUser('b61-other');
  await createOrgAs(other, 'buyer', 'B61 Other Co'); // pages that need an organisation otherwise redirect instead of answering 404
  buyerClient = await signedClient(buyer);
  const org = await buyerClient.client.rpc('create_org', { p_type: 'buyer', p_name: `Buyer ${uniq('b')}` });
  expect(org.error).toBeNull();
});

const hiddenNames = () => [rejected.name, draft.name, unpub.name, suspProd.name, onSuspendedSupplier.name, supBad.name];

test('E61 anonymous and signed-in buyers see only published products of approved suppliers, and never private supplier data', async ({ page, request, browser }) => {
  test.setTimeout(240_000);
  // ---- anonymous search page: the visible items only; no hidden name, no private data in the HTML
  const res = await request.get(`/${L}/catalogue?q=${tag}`);
  expect(res.status()).toBe(200);
  const html = await res.text();
  for (const name of [pub.name, forSuspend.name, forPrice.name]) expect(html).toContain(name);
  for (const name of hiddenNames()) expect(html, `hidden: ${name}`).not.toContain(name);
  for (const s of SECRETS) expect(html).not.toContain(s);
  expect(html).not.toContain(partner.org);
  expect(html).not.toMatch(/storage_path|catalogue-media\/products|"products\//);
  // no shared cache may keep a page that depends on who asks
  expect(res.headers()['cache-control'] ?? '').not.toMatch(/public|s-maxage/);

  // ---- product pages: visible one has no private data; every hidden one is a real 404 with a friendly page
  const ok = await request.get(`/${L}/catalogue/${pub.id}`);
  expect(ok.status()).toBe(200);
  const okHtml = await ok.text();
  for (const s of SECRETS) expect(okHtml).not.toContain(s);
  expect(okHtml).not.toContain(partner.org);
  for (const p of [draft, unpub, suspProd, rejected, onSuspendedSupplier]) {
    const r = await request.get(`/${L}/catalogue/${p.id}`);
    expect(r.status(), p.name).toBe(404);
    const body = await r.text();
    expect(body).toContain(t('notFound.title'));
    expect(body).not.toContain(p.name);
  }
  expect((await request.get(`/${L}/catalogue/not-a-uuid`)).status()).toBe(404);
  await page.goto(`/${L}/catalogue/${unpub.id}`);
  await expect(page.getByRole('heading', { level: 1, name: t('notFound.title') })).toBeVisible();

  // ---- the compare page leaves hidden products out and says so
  const cmp = await request.get(`/${L}/catalogue/compare?ids=${pub.id},${unpub.id},${suspProd.id}`);
  const cmpHtml = await cmp.text();
  expect(cmpHtml).toContain(pub.name);
  expect(cmpHtml).not.toContain(unpub.name);
  expect(cmpHtml).not.toContain(suspProd.name);

  // ---- API answers (what a hostile browser script gets): the same rules, no private fields
  const anon = anonClient();
  const search = await anon.rpc('search_catalogue', { p_q: tag, p_category: null, p_supplier: null, p_moq_max: null, p_price_min: null, p_price_max: null, p_currency: null, p_offset: 0, p_limit: 50 });
  expect(search.error).toBeNull();
  const json = JSON.stringify(search.data);
  for (const name of hiddenNames()) expect(json).not.toContain(name);
  for (const s of SECRETS) expect(json).not.toContain(s);
  expect(json).not.toMatch(/partner_org|storage_path|contact_email|registration_id/);
  expect((search.data as { total: number }).total).toBe(3);
  for (const p of [draft, unpub, suspProd, rejected, onSuspendedSupplier]) {
    expect((await anon.rpc('get_catalogue_item', { p_id: p.id })).error, p.name).not.toBeNull();
  }
  const detail = JSON.stringify((await anon.rpc('get_catalogue_item', { p_id: pub.id })).data);
  for (const s of SECRETS) expect(detail).not.toContain(s);
  expect(detail).not.toMatch(/partner_org|storage_path|contact_email|registration_id/);
  const cmpApi = (await anon.rpc('compare_items', { p_ids: [pub.id, unpub.id] })).data as { items: { id: string }[]; unavailable: string[] };
  expect(cmpApi.items.map((i) => i.id)).toEqual([pub.id]);
  expect(cmpApi.unavailable).toEqual([unpub.id]);

  // ---- images: the visible one is served privately; every hidden product's image is a 404 (re-authorised on every request)
  const img = await request.get(`/api/v1/catalogue-media/${pub.mediaId}`);
  expect(img.status()).toBe(200);
  expect(img.headers()['cache-control']).toBe('private, no-cache');
  expect(img.headers()['content-type']).toBe('image/png');
  for (const p of [unpub, suspProd, onSuspendedSupplier]) expect((await request.get(`/api/v1/catalogue-media/${p.mediaId}`)).status(), p.name).toBe(404);

  // ---- a signed-in buyer gets exactly the same view
  await loginUi(page, buyer, L);
  await page.goto(`/${L}/catalogue?q=${tag}`);
  await expect(card(page, pub.id)).toBeVisible();
  for (const p of [draft, unpub, suspProd, onSuspendedSupplier]) await expect(card(page, p.id)).toHaveCount(0);
  for (const p of [draft, unpub, suspProd, rejected, onSuspendedSupplier]) {
    expect((await page.request.get(`/${L}/catalogue/${p.id}`)).status(), p.name).toBe(404);
  }
  expect((await page.request.get(`/api/v1/catalogue-media/${unpub.mediaId}`)).status()).toBe(404);
  const own = await browser.newContext(); // a fresh visitor again: nothing carried over
  expect((await own.request.get(`/${L}/catalogue/${unpub.id}`)).status()).toBe(404);
  await own.close();
});

test('E61 a paused supplier cannot receive requests, and a request to a hidden product is refused and not stored', async ({ page }) => {
  test.setTimeout(240_000);
  await loginUi(page, buyer, L);
  await page.goto(`/${L}/catalogue/${forSuspend.id}/request`);
  await page.waitForLoadState('networkidle');
  await page.locator('#quantity').fill('20');
  await page.locator('#destinationState').selectOption('Johor');
  // MITRA pauses the supplier while the form is open
  await suspendSupplier(moderator, supOk);
  await page.getByRole('button', { name: t('request.submit'), exact: true }).click();
  await expect(page.locator('.form-message-slot')).toContainText(t('request.notAccepting'));
  await expect(page.locator('#quantity')).toHaveValue('20');
  expect(await requestsOfBuyer(buyer.id)).toHaveLength(0);
  expect(Number((await sql(`select count(*)::int n from public.sourcing_requests where supplier_id = $1`, [supOk.id]))[0]!.n)).toBe(0);
  // opening the form again is a friendly 404; the direct database call is refused too
  expect((await page.request.get(`/${L}/catalogue/${forSuspend.id}/request`)).status()).toBe(404);
  const org = (await sql<{ org_id: string }>(`select org_id from public.memberships where user_id = $1`, [buyer.id]))[0]!.org_id;
  const direct = await buyerClient.client.rpc('submit_sourcing_request', {
    p_buyer_org: org, p_key: uniq('key'), p_items: [{ product_id: forSuspend.id, quantity: 20 }], p_destination_state: 'Johor', p_destination_city: null, p_needed_by: null, p_notes: null,
  });
  expect(direct.error).not.toBeNull();
  expect(await requestsOfBuyer(buyer.id)).toHaveLength(0);
  // a draft product (never public) cannot be requested either
  const draftTry = await buyerClient.client.rpc('submit_sourcing_request', {
    p_buyer_org: org, p_key: uniq('key'), p_items: [{ product_id: draft.id, quantity: 20 }], p_destination_state: 'Johor', p_destination_city: null, p_needed_by: null, p_notes: null,
  });
  expect(draftTry.error).not.toBeNull();
  await reinstateSupplier(reviewer, supOk); // back to normal for the next test
});

test('E61 a later price edit does not change a sent request, and another buyer cannot read it', async ({ page, browser }) => {
  test.setTimeout(300_000);
  const org = (await sql<{ org_id: string }>(`select org_id from public.memberships where user_id = $1`, [buyer.id]))[0]!.org_id;
  const key = uniq('idem');
  const args = { p_buyer_org: org, p_key: key, p_items: [{ product_id: forPrice.id, quantity: 40 }], p_destination_state: 'Perak', p_destination_city: 'Ipoh', p_needed_by: null, p_notes: 'Snapshot test' };
  const sent = await buyerClient.client.rpc('submit_sourcing_request', args);
  expect(sent.error).toBeNull();
  const id = (sent.data as { id: string }).id;
  const again = await buyerClient.client.rpc('submit_sourcing_request', args); // same key, same payload: same request
  expect((again.data as { id: string; created: boolean })).toMatchObject({ id, created: false });
  expect(Number((await sql(`select count(*)::int n from public.sourcing_requests where idempotency_key = $1`, [key]))[0]!.n)).toBe(1);
  const before = (await sql<{ snapshot: unknown }>(`select snapshot from public.sourcing_request_items where request_id = $1`, [id]))[0]!.snapshot;
  expect(JSON.stringify(before)).toContain('"unit_price":450');

  // the supplier edits the price (new revision approved and published): the live price changes, the stored snapshot does not
  await changePrice(reviewer, forPrice, [{ min_qty: 10, max_qty: null, unit_price: '999.00' }]);
  const after = (await sql<{ snapshot: unknown }>(`select snapshot from public.sourcing_request_items where request_id = $1`, [id]))[0]!.snapshot;
  expect(after).toEqual(before);
  await loginUi(page, buyer, L);
  await page.goto(`/${L}/catalogue/${forPrice.id}`);
  await expect(page.locator('main')).toContainText('INR 999.00');
  await page.goto(`/${L}/catalogue/requests/${id}`);
  await expect(page.locator('main')).toContainText('INR 450.00');
  await expect(page.locator('main')).not.toContainText('INR 999.00');

  // another buyer: a 404 page, and the database refuses the direct call
  const ctx = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const p2 = await ctx.newPage();
  await loginUi(p2, other, L);
  expect((await p2.request.get(`/${L}/catalogue/requests/${id}`)).status()).toBe(404);
  await p2.goto(`/${L}/catalogue/requests`);
  await expect(p2.locator('main')).not.toContainText(id);
  await expect(p2.locator('main')).toContainText(t('requests.emptyTitle'));
  const otherClient = await signedClient(other);
  expect((await otherClient.client.rpc('get_sourcing_request', { p_request: id })).error).not.toBeNull();
  expect((await otherClient.client.rpc('withdraw_sourcing_request', { p_request: id })).error).not.toBeNull();
  expect((await sql<{ status: string }>(`select status from public.sourcing_requests where id = $1`, [id]))[0]!.status).toBe('submitted');
  // anonymous: sent to sign in, never shown the request
  const anonCtx = await browser.newContext();
  const ar = await anonCtx.request.get(`/${L}/catalogue/requests/${id}`, { maxRedirects: 0 });
  expect([307, 308, 302, 303]).toContain(ar.status());
  expect(ar.headers().location ?? '').toContain('/login');
  await anonCtx.close();
  await ctx.close();
});

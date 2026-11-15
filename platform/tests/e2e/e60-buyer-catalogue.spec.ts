import { expect, test, type Page } from '@playwright/test';
import { createUser, sql, uniq, type TestUser } from './support/db';
import {
  axeClean, card, daysAgo, makePartner, makeProduct, makeReviewer, makeSupplier, partnerAcknowledge, partnerClarify, partnerView, requestEvents, requestItems, requestsForSupplier, requestsOfBuyer,
  savedProductIds, tb, tcm, today, type Product,
} from './support/p5-buyer';
import { loginUi, logoutUi } from './support/ui';

// E60 (journey 4): a Malaysian buyer finds products from India, filters, compares two, saves one, sends a real price request, signs out and in
// again and finds both still there; the partner sees the request. Real database, real RPCs, synthetic data. Persisted state is read with SQL.

const L = 'en' as const;
const t = (k: string, v: Record<string, string> = {}) => tb(L, k, v);
const tag = uniq('b60').replace(/-/g, '');
let p1: Product, p2: Product, p3: Product;
let buyer: TestUser;
let partner: Awaited<ReturnType<typeof makePartner>>;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const reviewer = await makeReviewer();
  partner = await makePartner('b60-partner');
  const supA = await makeSupplier(partner, reviewer, { name: `Chennai Handlooms ${tag}`, stateCity: 'Chennai' });
  const supB = await makeSupplier(partner, reviewer, { name: `Mumbai Silks ${tag}`, stateCity: 'Mumbai' });
  p1 = await makeProduct(supA, reviewer, {
    name: `Cotton Saree ${tag}`, moq: 10, currency: 'INR', mode: 'tiers', image: true,
    tiers: [{ min_qty: 10, max_qty: 99, unit_price: '450.00' }, { min_qty: 100, max_qty: null, unit_price: '400.00' }],
    variants: [{ sku: 'RED', label: 'Red', moq: 25 }, { sku: 'BLUE', label: 'Blue' }], specs: { Material: 'Cotton', Length: '6 m' }, lead: [10, 20], availabilityOn: daysAgo(5), priceOn: daysAgo(3),
  });
  p2 = await makeProduct(supB, reviewer, { name: `Silk Scarf ${tag}`, moq: 20, currency: 'USD', mode: 'fixed', unitPrice: '12.50', specs: { Material: 'Silk' }, lead: [20, 30] });
  p3 = await makeProduct(supB, reviewer, { name: `Brass Lamp ${tag}`, category: 'home-kitchen', moq: 5, currency: 'MYR', mode: 'request', specs: { Material: 'Brass' } });
  buyer = await createUser('b60-buyer');
});

async function fillLogin(page: Page, u: TestUser) {
  await page.locator('#email').fill(u.email);
  await page.locator('#password').fill(u.password);
  await page.locator('main form button[type=submit]').click();
}

test('E60 buyer journey: search, filter, compare, save, request a price, sign out and in, follow up', async ({ page }) => {
  test.setTimeout(300_000);

  // ---- anonymous search: real cards, image, price with currency and date, availability statement
  await page.goto(`/${L}/catalogue?q=${tag}`);
  await expect(page.getByRole('heading', { level: 1, name: t('title') })).toBeVisible();
  await expect(page.locator('.catalogue-count')).toContainText(t('search.count', { n: '3' }));
  const c1 = card(page, p1.id);
  await expect(c1).toContainText(p1.name);
  await expect(c1).toContainText(`Chennai Handlooms ${tag}`);
  await expect(c1).toContainText('Chennai, India');
  await expect(c1).toContainText('From INR 400.00');
  await expect(c1).toContainText(tcm(L, 'labels.moq'));
  await expect(c1).toContainText(t('card.indicative'));
  await expect(c1).toContainText(tcm(L, 'availability.available'));
  await expect(c1).not.toContainText(/in stock/i);
  const img = c1.locator('img');
  await expect(img).toHaveAttribute('alt', t('card.imageAlt', { name: p1.name }));
  await expect(img).toHaveAttribute('src', `/api/v1/catalogue-media/${p1.mediaId}`);
  await expect.poll(async () => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  await expect(card(page, p2.id)).toContainText('USD 12.50');
  await expect(card(page, p3.id)).toContainText(tcm(L, 'price.onRequest'));
  await axeClean(page, 'search');

  // ---- filters: currency + price range, MOQ, and a search with no result
  await page.locator('#currency').selectOption('USD');
  await page.locator('#price_max').fill('100');
  await page.getByRole('button', { name: t('search.apply'), exact: true }).click();
  await expect(page).toHaveURL(/currency=USD/);
  await expect(card(page, p2.id)).toBeVisible();
  await expect(card(page, p1.id)).toHaveCount(0);
  await page.goto(`/${L}/catalogue?q=${tag}&moq_max=6`);
  await expect(card(page, p3.id)).toBeVisible();
  await expect(card(page, p1.id)).toHaveCount(0);
  await page.goto(`/${L}/catalogue?q=${tag}&currency=INR&price_max=1.00`);
  await expect(page.getByRole('heading', { name: t('search.noneTitle') })).toBeVisible();
  await expect(page.locator('main')).toContainText(t('search.tipFewerFilters'));
  await axeClean(page, 'search empty');
  // a price without a currency is not silently applied
  await page.goto(`/${L}/catalogue?q=${tag}&price_max=1`);
  await expect(page.locator('main')).toContainText(t('search.needCurrency'));
  await expect(card(page, p1.id)).toBeVisible();

  // ---- compare two products (anonymous): the tray keeps the choice, the table shows both currencies side by side, nothing converted
  await page.goto(`/${L}/catalogue?q=${tag}`);
  await page.waitForLoadState('networkidle');
  await card(page, p1.id).getByLabel(t('compare.add'), { exact: false }).check();
  await card(page, p2.id).getByLabel(t('compare.add'), { exact: false }).check();
  const tray = page.getByRole('complementary', { name: t('compare.trayLabel') });
  await expect(tray).toContainText(t('compare.selected', { n: '2', max: '4' }));
  await page.goto(`/${L}/catalogue?q=${tag}&category=textiles-apparel`); // another page: selection survives
  await expect(page.getByRole('complementary', { name: t('compare.trayLabel') })).toContainText(t('compare.selected', { n: '2', max: '4' }));
  await page.getByRole('link', { name: t('compare.open'), exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/catalogue/compare\\?ids=`));
  const table = page.locator('table.compare-table');
  await expect(table).toContainText(p1.name);
  await expect(table).toContainText(p2.name);
  await expect(table).toContainText('INR 450.00');
  await expect(table).toContainText('USD 12.50');
  await expect(table).toContainText(t('compare.notProvided'));
  await expect(page.locator('main')).toContainText(t('compare.mixedCurrencies', { currencies: 'INR, USD' }));
  await axeClean(page, 'compare');

  // ---- anonymous Save product: a clear sign-in prompt that comes back to the same page
  const searchUrl = `/${L}/catalogue?q=${tag}`;
  await page.goto(searchUrl);
  await card(page, p1.id).getByRole('link', { name: t('save.signInToSave') }).click();
  await expect(page).toHaveURL(/\/login\?next=/);
  await fillLogin(page, buyer);
  await expect(page).toHaveURL(new RegExp(`/catalogue\\?q=${tag}$`));

  // ---- signed in: save one product, the state comes from the database
  await page.waitForLoadState('networkidle');
  await card(page, p1.id).getByRole('button', { name: t('save.save') }).click();
  await expect(card(page, p1.id).getByRole('button', { name: t('save.remove') })).toBeVisible();
  expect((await savedProductIds(buyer.id)).map((r) => r.product_id)).toEqual([p1.id]);

  // ---- product page: details, tiers, variants, supplier review wording, no private supplier data
  await card(page, p1.id).getByRole('link', { name: p1.name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: p1.name })).toBeVisible();
  const main = page.locator('main');
  await expect(main).toContainText('INR 450.00');
  await expect(main).toContainText('INR 400.00');
  await expect(main).toContainText(t('detail.notQuotation'));
  await expect(main).toContainText('Red');
  await expect(main).toContainText('6 m');
  await expect(main).toContainText('INOK reviewed documents for this supplier on');
  await expect(main).not.toContainText(/trusted|in stock/i);
  await axeClean(page, 'product');

  // ---- Request Price: a quantity below the option minimum gets a friendly message, nothing is saved
  await page.getByRole('link', { name: new RegExp(tcm(L, 'buttons.requestPrice')) }).first().click();
  await expect(page).toHaveURL(new RegExp(`/catalogue/${p1.id}/request$`));
  await page.waitForLoadState('networkidle');
  await page.locator('#variantSku').selectOption('RED');
  await page.locator('#quantity').fill('12');
  await page.locator('#destinationState').selectOption('Selangor');
  await page.locator('#destinationCity').fill('Shah Alam');
  await page.locator('#notes').fill('Please quote for the red colour, packed per 10.');
  await page.getByRole('button', { name: t('request.submit'), exact: true }).click();
  await expect(page.locator('.form-message-slot [class*=message-error]')).toContainText(t('request.belowMoq', { moq: '25' }));
  await expect(page.locator('#quantity')).toHaveValue('12'); // typed input is kept
  await expect(page.locator('#notes')).toHaveValue('Please quote for the red colour, packed per 10.');
  expect(await requestsOfBuyer(buyer.id)).toHaveLength(0);
  await axeClean(page, 'request with error');

  // valid quantity; a double click must still create ONE request
  await page.locator('#quantity').fill('30');
  const needed = new Date(Date.now() + 45 * 86_400_000).toISOString().slice(0, 10);
  await page.locator('#neededBy').fill(needed);
  await page.getByRole('button', { name: t('request.submit'), exact: true }).dblclick();
  await expect(page).toHaveURL(/\/catalogue\/requests\/[0-9a-f-]{36}\?sent=1$/, { timeout: 30_000 });
  const requestId = page.url().match(/requests\/([0-9a-f-]{36})/)![1]!;
  const rows = await requestsOfBuyer(buyer.id);
  expect(rows).toHaveLength(1);
  const row = rows[0]!;
  expect(row).toMatchObject({ id: requestId, status: 'submitted', destination_state: 'Selangor', destination_city: 'Shah Alam', supplier_id: p1.supplier.id, partner_org_id: partner.org });
  expect(String(row.needed_by).slice(0, 10)).toBe(needed);
  const items = await requestItems(requestId);
  expect(items).toHaveLength(1);
  expect(Number(items[0]!.quantity)).toBe(30);
  expect(items[0]!.snapshot).toMatchObject({ name: p1.name, currency: 'INR', price_mode: 'tiers' });
  // the success screen shows the saved reference and the tracking page
  await expect(page.getByTestId('request-sent')).toContainText(row.reference);
  await expect(page.getByTestId('request-reference')).toHaveText(row.reference);
  await expect(page.locator('main')).toContainText(tcm(L, 'status.sourcing.submitted'));
  await expect(page.locator('main')).toContainText('INR 450.00'); // the snapshot of the terms as shown
  await axeClean(page, 'request detail');

  // ---- sign out and in again: the request and the saved product are still there
  await logoutUi(page, L);
  await loginUi(page, buyer, L);
  await page.goto(`/${L}/catalogue/requests`);
  await expect(page.locator(`[data-request-id="${requestId}"]`)).toContainText(row.reference);
  await expect(page.locator(`[data-request-id="${requestId}"]`)).toContainText(p1.name);
  await axeClean(page, 'my requests');
  await page.goto(`/${L}/catalogue/saved`);
  await expect(card(page, p1.id)).toContainText(p1.name);
  await axeClean(page, 'saved');

  // ---- the partner sees the request (real RPC as the partner owner; the partner UI is built by another agent)
  const seen = await partnerView(partner, requestId);
  expect(seen).toMatchObject({ reference: row.reference, status: 'submitted', your_side: 'partner' });
  expect(seen.items[0].snapshot.name).toBe(p1.name);
  expect(await requestsForSupplier(p1.supplier.id)).toHaveLength(1);

  // ---- the partner asks a question; the buyer sees it, replies, the partner acknowledges; the buyer withdraws
  await partnerClarify(partner, requestId, 'Which colour do you need for the first lot?');
  await page.goto(`/${L}/catalogue/requests/${requestId}`);
  await expect(page.locator('main')).toContainText(tcm(L, 'status.sourcing.clarification_requested'));
  await expect(page.locator('main')).toContainText('Which colour do you need for the first lot?');
  await page.waitForLoadState('networkidle');
  await page.locator('#note').fill('Red for the first lot, please.');
  await page.getByRole('button', { name: t('requests.replySend'), exact: true }).click();
  await expect(page).toHaveURL(/replied=1/);
  expect((await requestEvents(requestId)).map((e) => e.kind)).toEqual(['submitted', 'clarification_requested', 'buyer_replied']);
  expect((await requestEvents(requestId)).find((e) => e.kind === 'buyer_replied')?.note).toBe('Red for the first lot, please.');
  await partnerAcknowledge(partner, requestId);
  await page.goto(`/${L}/catalogue/requests/${requestId}`);
  await expect(page.locator('main')).toContainText(tcm(L, 'status.sourcing.acknowledged'));
  await page.waitForLoadState('networkidle');
  await page.getByText(t('requests.withdrawOpen')).click();
  await page.getByRole('button', { name: t('requests.withdrawConfirm') }).click();
  await expect(page).toHaveURL(/withdrawn=1/);
  expect((await sql<{ status: string }>(`select status from public.sourcing_requests where id = $1`, [requestId]))[0]!.status).toBe('withdrawn');
  await expect(page.locator('main')).toContainText(tcm(L, 'status.sourcing.withdrawn'));
  await expect(page.getByRole('button', { name: t('requests.withdrawConfirm') })).toHaveCount(0);
  void today;
});

import { expect, test } from '@playwright/test';
import { createOrgAs, createUser, signedClient, sql, uniq, type TestUser } from './support/db';
import { errorText } from './support/ui';
import { axeClean, card, daysAgo, makePartner, makeProduct, makeReviewer, makeSupplier, requestsOfBuyer, tb, tcm, type Product } from './support/p5-buyer';
import { loginUi } from './support/ui';

// E62 (usability): Tamil and Bahasa Melayu on search, product, compare and request, at 360px and 1280px (the project viewport), with axe;
// and the realistic mistakes: invalid quantity, a session that ends mid-form, a repeated submission, an old availability statement.

const tag = uniq('b62').replace(/-/g, '');
let p1: Product, p2: Product, old: Product;
let buyer: TestUser;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const reviewer = await makeReviewer();
  const partner = await makePartner('b62-partner');
  const sup = await makeSupplier(partner, reviewer, { name: `Usability Supplier ${tag}` });
  p1 = await makeProduct(sup, reviewer, { name: `Usable Saree ${tag}`, moq: 10, image: true, variants: [{ sku: 'RED', label: 'Red' }] });
  p2 = await makeProduct(sup, reviewer, { name: `Usable Scarf ${tag}`, moq: 5, currency: 'USD', mode: 'fixed', unitPrice: '9.00' });
  old = await makeProduct(sup, reviewer, { name: `Old Statement ${tag}`, moq: 5, availabilityOn: daysAgo(150), priceOn: daysAgo(150) });
  buyer = await createUser('b62-buyer');
  await createOrgAs(buyer, 'buyer', 'B62 Buyer Co'); // actions need an organisation
});

for (const L of ['ta', 'ms'] as const) {
  test(`E62 ${L}: search, product, compare and request pages read in the language and pass axe`, async ({ page }) => {
    test.setTimeout(240_000);
    const t = (k: string, v: Record<string, string> = {}) => tb(L, k, v);
    await page.goto(`/${L}/catalogue?q=${tag}`);
    await expect(page.getByRole('heading', { level: 1, name: t('title') })).toBeVisible();
    await expect(page.locator('.catalogue-count')).toContainText(t('search.count', { n: '3' }));
    await expect(page.locator('html')).toHaveAttribute('lang', L);
    await expect(card(page, p1.id)).toContainText(tcm(L, 'labels.moq'));
    await expect(card(page, p1.id)).toContainText('INR 400.00');
    await expect(card(page, p2.id)).toContainText('USD 9.00');
    await axeClean(page, `${L} search`);

    await page.goto(`/${L}/catalogue/${p1.id}`);
    await expect(page.getByRole('heading', { level: 1, name: p1.name })).toBeVisible();
    await expect(page.locator('main')).toContainText(t('detail.notQuotation'));
    await axeClean(page, `${L} product`);

    await page.goto(`/${L}/catalogue?q=${tag}`);
    await page.waitForLoadState('networkidle');
    await card(page, p1.id).locator(`#cmp-${p1.id}`).check();
    await card(page, p2.id).locator(`#cmp-${p2.id}`).check();
    await page.getByRole('link', { name: t('compare.open'), exact: true }).click();
    await expect(page.locator('table.compare-table')).toContainText('USD 9.00');
    await expect(page.locator('main')).toContainText(t('compare.mixedCurrencies', { currencies: 'INR, USD' }));
    await axeClean(page, `${L} compare`);

    await loginUi(page, buyer, L);
    await page.goto(`/${L}/catalogue/${p1.id}/request`);
    await expect(page.getByRole('heading', { level: 1, name: t('request.title') })).toBeVisible();
    await expect(page.getByLabel(t('request.state'))).toBeVisible();
    await axeClean(page, `${L} request`);
    // a refusal is worded in the language too: no state chosen
    await page.waitForLoadState('networkidle');
    await page.locator('#destinationState').evaluate((el: HTMLSelectElement) => (el.required = false));
    await page.getByRole('button', { name: t('request.submit'), exact: true }).click();
    await expect(page.locator('.form-message-slot')).toContainText(errorText(L, 'invalid_state'));
    expect(await requestsOfBuyer(buyer.id)).toHaveLength(0);
    await axeClean(page, `${L} request error`);
    await page.goto(`/${L}/catalogue/saved`);
    await expect(page.getByRole('heading', { level: 1, name: t('saved.title') })).toBeVisible();
    await axeClean(page, `${L} saved`);
    await page.goto(`/${L}/catalogue/requests`);
    await expect(page.getByRole('heading', { level: 3, name: t('requests.emptyTitle') })).toBeVisible();
    await axeClean(page, `${L} my requests`);
  });
}

test('E62 mistakes: invalid quantity, session ending mid-form, repeated submission, old availability', async ({ page, context }) => {
  test.setTimeout(240_000);
  const L = 'en' as const;
  const t = (k: string, v: Record<string, string> = {}) => tb(L, k, v);

  // ---- an old availability statement says so on the card, the product page and the comparison
  await page.goto(`/${L}/catalogue/${old.id}`);
  await expect(page.locator('.availability-note .message-warn')).toBeVisible();
  await expect(page.locator('.availability-note')).toContainText('last confirmed on');
  await expect(page.locator('main')).not.toContainText(/in stock/i);
  await page.goto(`/${L}/catalogue?q=${tag}`);
  await expect(card(page, old.id).locator('.message-warn')).toBeVisible();
  await expect(card(page, p1.id).locator('.message-warn')).toHaveCount(0);

  // ---- invalid quantity: the server refuses 1.5 and 0 in words (browser checks switched off to reach the server)
  await loginUi(page, buyer, L);
  await page.goto(`/${L}/catalogue/${p2.id}/request`);
  await page.waitForLoadState('networkidle');
  await page.locator('main form.form').evaluate((f: HTMLFormElement) => (f.noValidate = true));
  await page.locator('#destinationState').selectOption('Kedah');
  for (const bad of ['1.5', '0', 'abc']) {
    await page.locator('#quantity').evaluate((el: HTMLInputElement, v: string) => { el.type = 'text'; el.value = v; }, bad);
    const answered = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/request'));
    await page.getByRole('button', { name: t('request.submit'), exact: true }).click();
    await answered;
    await expect(page.locator('.form-message-slot')).toContainText(errorText(L, 'invalid_quantity'));
    await expect(page.locator('#quantity')).toHaveValue(bad); // the typed value is restored after the form reset
  }
  // below the minimum (MOQ 5): friendly, names the number
  await page.locator('#quantity').evaluate((el: HTMLInputElement) => { el.type = 'text'; el.value = '2'; });
  const answered2 = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/request'));
  await page.getByRole('button', { name: t('request.submit'), exact: true }).click();
  await answered2;
  await expect(page.locator('.form-message-slot')).toContainText(t('request.belowMoq', { moq: '5' }));
  expect(await requestsOfBuyer(buyer.id)).toHaveLength(0);

  // ---- the session ends while the form is open: words are kept, nothing is saved, and signing in again works
  await page.locator('#quantity').evaluate((el: HTMLInputElement) => { el.type = 'text'; el.value = '8'; });
  await page.locator('#destinationCity').fill('Alor Setar');
  await page.locator('#notes').fill('Typed before the session ended.');
  await context.clearCookies();
  await page.getByRole('button', { name: t('request.submit'), exact: true }).click();
  await expect(page.locator('.form-message-slot')).toContainText(errorText(L, 'unauthenticated'));
  await expect(page.locator('#notes')).toHaveValue('Typed before the session ended.');
  await expect(page.locator('#destinationCity')).toHaveValue('Alor Setar');
  expect(await requestsOfBuyer(buyer.id)).toHaveLength(0);
  await loginUi(page, buyer, L);
  await page.goto(`/${L}/catalogue/${p2.id}/request`);
  await page.waitForLoadState('networkidle');
  await page.locator('#quantity').fill('8');
  await page.locator('#destinationState').selectOption('Kedah');
  await page.getByRole('button', { name: t('request.submit'), exact: true }).click();
  await expect(page).toHaveURL(/requests\/[0-9a-f-]{36}\?sent=1$/);
  expect(await requestsOfBuyer(buyer.id)).toHaveLength(1);

  // ---- repeated submission with the same key (a retry after a lost answer) returns the same request
  const row = (await requestsOfBuyer(buyer.id))[0]!;
  const s = await signedClient(buyer);
  const args = { p_buyer_org: row.buyer_org_id, p_key: row.idempotency_key, p_items: [{ product_id: p2.id, quantity: 8 }], p_destination_state: 'Kedah', p_destination_city: null, p_needed_by: null, p_notes: null };
  const retry = await s.client.rpc('submit_sourcing_request', args);
  expect(retry.data).toMatchObject({ id: row.id, created: false });
  expect(await requestsOfBuyer(buyer.id)).toHaveLength(1);
  expect(Number((await sql(`select count(*)::int n from public.sourcing_request_items where request_id = $1`, [row.id]))[0]!.n)).toBe(1);
});

test('E62 compare keeps to four products and manages the selection', async ({ page }) => {
  const L = 'en' as const;
  const t = (k: string, v: Record<string, string> = {}) => tb(L, k, v);
  await page.goto(`/${L}/catalogue?q=${tag}`);
  await page.waitForLoadState('networkidle');
  await card(page, p1.id).locator(`#cmp-${p1.id}`).check();
  await expect(page.getByRole('complementary', { name: t('compare.trayLabel') })).toContainText(t('compare.needTwo'));
  await card(page, p2.id).locator(`#cmp-${p2.id}`).check();
  await page.getByRole('button', { name: t('compare.removeOne', { name: p1.name }) }).click();
  await expect(page.getByRole('complementary', { name: t('compare.trayLabel') })).toContainText(t('compare.selected', { n: '1', max: '4' }));
  await page.getByRole('button', { name: t('compare.clear') }).click();
  await expect(page.getByRole('complementary', { name: t('compare.trayLabel') })).toHaveCount(0);
  // a link with unknown or too many ids is tolerated
  await page.goto(`/${L}/catalogue/compare?ids=${p1.id},${p2.id},${old.id},${p1.id},zzz,${p2.id}`);
  await expect(page.locator('table.compare-table')).toContainText(old.name);
  await page.goto(`/${L}/catalogue/compare`);
  await expect(page.getByRole('heading', { name: t('compare.emptyTitle') })).toBeVisible();
  await axeClean(page, 'compare empty');
});

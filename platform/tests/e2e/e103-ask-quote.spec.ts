import { expect, test } from '@playwright/test';
import { seedDemo, type DemoData } from './support/demo-seed';
import { msg } from './support/i18n';
import { shot } from './support/qa-evidence';
import { loginUi } from './support/ui';

// E103 WP3: one "Ask for a quote" wording everywhere a buyer asks a business or a supplier for a price. The existing workflow behind each
// entry is unchanged (enquiry from a profile, price request from a product, buyer request when no business is chosen, sourcing request for
// several products or samples), and no database change is involved.
const LABEL = { en: 'Ask for a quote', ms: 'Minta sebut harga', ta: 'விலைப்புள்ளி கேள்' } as const;
let demo: DemoData;
test.beforeAll(async () => { test.setTimeout(900_000); demo = await seedDemo(); });

test('E103 the same label opens the right existing workflow from a business, a product and a general request', async ({ page }) => {
  test.setTimeout(300_000);
  const buyer = demo.buyers[0]!;
  const biz = demo.businesses[0]!;
  const pack = demo.products.find((p) => p.name.startsWith('Corrugated packaging'))!;
  await loginUi(page, buyer.user, 'en');

  // business profile -> enquiry dialog (existing enquiry workflow)
  await page.goto('/en/directory');
  await page.locator('#q').fill('packaging');
  await page.getByRole('button', { name: msg('en', 'dir.search'), exact: true }).click();
  await page.locator('a.lcard-link').filter({ hasText: biz.name }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('INOK Demo Packaging Supplies');
  await page.waitForLoadState('networkidle');
  const profileBtn = page.getByRole('button', { name: LABEL.en, exact: true }).first();
  await expect(profileBtn).toBeVisible();
  await shot(page, { role: 'buyer', journey: 'wp3', step: '01-profile', title: 'Business profile: Ask for a quote', expected: 'One button with the shared label', observed: 'Button shown', widths: [360, 1280] });
  await profileBtn.click();
  await expect(page.locator('#enq-topic')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('dialog')).toContainText(/quote/i);

  // catalogue product -> single-product price request (existing catalogue request workflow), with the More options link
  await page.goto(`/en/catalogue/${pack.id}`);
  await expect(page.getByRole('link', { name: LABEL.en }).first()).toBeVisible();
  await shot(page, { role: 'buyer', journey: 'wp3', step: '02-product', title: 'Product: Ask for a quote', expected: 'Same label on the product', observed: 'Link shown', widths: [360, 1280] });
  await page.goto(`/en/catalogue/${pack.id}/request`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(LABEL.en);
  const more = page.getByRole('link', { name: msg('en', 'p6.new') });
  await expect(more).toBeVisible();
  await expect(more).toHaveAttribute('href', /\/sourcing\/new$/);
  await shot(page, { role: 'buyer', journey: 'wp3', step: '03-product-request', title: 'Product quote request with More options', expected: 'Single-product form; link to several products or samples', observed: 'Form shown', widths: [360, 1280] });
  await more.click();
  await expect(page).toHaveURL(/\/sourcing\/new/);
  await expect(page.getByRole('heading', { name: msg('en', 'p6.new') })).toBeVisible();

  // no business chosen -> buyer request (existing five-step request workflow), described as what you need
  await page.goto('/en/requests');
  await expect(page.getByRole('link', { name: msg('en', 'req.post') }).first()).toBeVisible();
  expect(msg('en', 'req.post')).toBe('Describe what you need');
});

test('E103 Malay and Tamil use the translated shared label without overflow', async ({ page }) => {
  test.setTimeout(300_000);
  const buyer = demo.buyers[0]!;
  const pack = demo.products.find((p) => p.name.startsWith('Corrugated packaging'))!;
  await loginUi(page, buyer.user, 'en');
  for (const L of ['ms', 'ta'] as const) {
    expect(msg(L, 'dir2.send')).toBe(LABEL[L]);
    await page.goto(`/${L}/catalogue/${pack.id}/request`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(LABEL[L]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await shot(page, { role: 'buyer', journey: 'wp3', step: `04-product-request-${L}`, title: `Quote request in ${L}`, expected: 'Translated label, wraps correctly', observed: 'Renders', lang: L, widths: [360, 1280] });
  }
});

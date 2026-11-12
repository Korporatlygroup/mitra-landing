import { expect, test, type Page } from '@playwright/test';
import { pngWithMetadata } from './support/biz';
import { sql } from './support/db';
import { msg } from './support/i18n';
import { asUser, checkPage, createPartner, createReviewer, loginPartner, partnerPath, productRow, reviewProduct, seedProduct, seedSupplier } from './support/p5';
import type { Locale } from './support/ui';
import { signedClient } from './support/db';

// E51: the partner's product screens: create with price tiers (live checks), options and specifications, validation, preview, submit, MITRA's
// decision (done through the database as a reviewer), publish and unpublish, editing a live product (the live version stays), pictures, conflicts.

const t = (k: string, v?: Record<string, string>) => msg('en', k, v);
const main = (page: Page) => page.locator('main');
const group = (page: Page, name: string) => main(page).getByRole('group', { name, exact: true });
const btn = (page: Page, name: string) => main(page).getByRole('button', { name, exact: true });

test('E51 create a product with price ranges (live checks), options and specifications; validate; preview; send for review', async ({ page }) => {
  test.setTimeout(300_000);
  const p = await createPartner('e51a');
  const reviewer = await createReviewer('e51a-rev');
  await seedSupplier(p, reviewer, { name: 'Tier Supplier' });
  await loginPartner(page, p, 'en', '/products');
  await expect(main(page).getByRole('heading', { name: t('p5partner.products.emptyTitle') })).toBeVisible();
  await checkPage(page, 'products (empty)');
  await main(page).getByRole('link', { name: t('p5common.buttons.addProduct'), exact: true }).first().click();
  await expect(page).toHaveURL(/\/products\/new$/);

  await page.locator('#sku').fill('SAREE-001');
  await page.locator('#name').fill('Cotton saree');
  await page.locator('#category_slug').selectOption('textiles-apparel');
  await page.locator('#description').fill('Handwoven cotton saree, 6 metres.');
  await page.locator('#unit').selectOption('piece');
  await page.locator('#moq').fill('100');
  await page.locator('#currency').selectOption('INR');
  await page.locator('#pm-tiers').check();

  // live checks: gap, overlap, order, open last range
  await main(page).getByRole('button', { name: t('p5partner.productForm.tiers.add'), exact: true }).click();
  await main(page).getByRole('button', { name: t('p5partner.productForm.tiers.add'), exact: true }).click();
  const r1 = group(page, t('p5partner.productForm.tiers.row', { n: '1' }));
  const r2 = group(page, t('p5partner.productForm.tiers.row', { n: '2' }));
  const from = t('p5partner.productForm.tiers.from');
  const to = t('p5partner.productForm.tiers.to');
  const price = t('p5partner.productForm.tiers.price', { currency: 'INR' });
  await r1.getByLabel(from, { exact: true }).fill('100');
  await r1.getByLabel(to, { exact: true }).fill('499');
  await r1.getByLabel(price, { exact: true }).fill('250.5');
  await r2.getByLabel(from, { exact: true }).fill('600');
  await r2.getByLabel(price, { exact: true }).fill('240');
  await expect(r2.getByRole('alert')).toContainText(t('errors.tier_gap'));
  await r2.getByLabel(from, { exact: true }).fill('400');
  await expect(r2.getByRole('alert')).toContainText(t('errors.tier_overlap'));
  await r2.getByLabel(from, { exact: true }).fill('50');
  await expect(r2.getByRole('alert')).toContainText(t('errors.tier_not_ascending'));
  await r1.getByLabel(to, { exact: true }).fill('');
  await r2.getByLabel(from, { exact: true }).fill('500');
  await expect(r2.getByRole('alert')).toContainText(t('errors.tier_last_not_open'));
  await r1.getByLabel(to, { exact: true }).fill('499');
  await expect(r1.getByRole('alert')).toHaveCount(0);
  await expect(r2.getByRole('alert')).toHaveCount(0);
  await expect(main(page).getByTestId('tier-summary')).toContainText(t('p5partner.productForm.tiers.allGood'));
  // the first range must start at or below the smallest order
  await page.locator('#moq').fill('50');
  await expect(r1.getByRole('alert')).toContainText(t('errors.tier_does_not_cover_moq'));
  await page.locator('#moq').fill('100');
  await expect(r1.getByRole('alert')).toHaveCount(0);

  // options and specifications
  await main(page).getByRole('button', { name: t('p5partner.productForm.variants.add'), exact: true }).click();
  const v1 = group(page, t('p5partner.productForm.variants.row', { n: '1' }));
  await v1.getByLabel(t('p5partner.productForm.variants.label'), { exact: true }).fill('Green');
  await v1.getByLabel(t('p5partner.productForm.variants.sku'), { exact: true }).fill('SAREE-001-GRN');
  await v1.getByLabel(t('p5partner.productForm.variants.attributes'), { exact: true }).fill('Colour: Green');
  await main(page).getByRole('button', { name: t('p5partner.productForm.specs.add'), exact: true }).click();
  const s1 = group(page, t('p5partner.productForm.specs.row', { n: '1' }));
  await s1.getByLabel(t('p5partner.productForm.specs.key'), { exact: true }).fill('Material');
  await s1.getByLabel(t('p5partner.productForm.specs.value'), { exact: true }).fill('Cotton');
  await checkPage(page, 'product form (tiers)');

  await btn(page, t('p5common.buttons.saveDraft')).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}\/edit\?saved=1$/);
  const pid = page.url().match(/products\/([0-9a-f-]{36})\/edit/)![1]!;
  const row = await productRow(pid);
  expect(row.status).toBe('draft');
  const d = row.draft as { sku: string; moq: number; currency: string; price_mode: string; tiers: { min_qty: number; max_qty: number | null; unit_price: string }[]; variants: { sku: string; label: string; attributes: Record<string, string> }[]; specs: Record<string, string> };
  expect(d.sku).toBe('SAREE-001');
  expect(d.price_mode).toBe('tiers');
  // exact decimal strings (never floats): "250.5" was typed, "250.50" is stored
  expect(d.tiers.map((x) => [x.min_qty, x.max_qty, x.unit_price])).toEqual([
    [100, 499, '250.50'],
    [500, null, '240.00'],
  ]);
  expect(d.variants).toEqual([{ sku: 'SAREE-001-GRN', label: 'Green', attributes: { Colour: 'Green' } }]);
  expect(d.specs).toEqual({ Material: 'Cotton' });

  // reloaded editor shows the saved rows
  await expect(page.locator('#name')).toHaveValue('Cotton saree');
  await expect(group(page, t('p5partner.productForm.tiers.row', { n: '2' })).getByLabel(price, { exact: true })).toHaveValue('240.00');
  await checkPage(page, 'product form (edit)');

  // server-side validation shows an announced, translated message and keeps what was typed
  await page.locator('#description').fill('Handwoven cotton saree, 6 metres, many colours.');
  await btn(page, t('p5partner.productForm.saveAndSubmit')).click();
  await expect(main(page).getByRole('alert').filter({ hasText: t('errors.price_date_required') })).toBeVisible();
  await expect(page.locator('#description')).toHaveValue('Handwoven cotton saree, 6 metres, many colours.');
  await page.locator('#price_confirmed_on').fill(new Date().toISOString().slice(0, 10));
  await btn(page, t('p5partner.productForm.saveAndSubmit')).click();
  await expect(main(page).getByRole('alert').filter({ hasText: t('errors.availability_required') })).toBeVisible();
  await page.locator('#availability_status').selectOption('available');
  await page.locator('#availability_confirmed_on').fill(new Date().toISOString().slice(0, 10));
  await page.locator('#price_confirmed_on').fill(new Date().toISOString().slice(0, 10));
  await page.locator('#lead_time_min_days').fill('7');
  await page.locator('#lead_time_max_days').fill('14');
  await btn(page, t('p5partner.productForm.saveAndPreview')).click();
  await expect(page).toHaveURL(new RegExp(`/products/${pid}/preview$`));

  // preview: what a buyer would see
  const pv = main(page).getByTestId('product-preview');
  await expect(pv.getByText(t('p5partner.preview.banner'))).toBeVisible();
  await expect(pv.getByRole('heading', { name: 'Cotton saree' })).toBeVisible();
  await expect(pv.getByText(t('p5common.labels.moq'))).toBeVisible();
  await expect(pv).toContainText('240.00');
  await expect(pv).toContainText('250.50');
  await expect(pv.getByText('Colour: Green')).toBeVisible();
  await expect(pv.getByText('Material')).toBeVisible();
  await expect(pv.getByText(t('p5common.price.note'))).toBeVisible();
  await checkPage(page, 'product preview');

  // send for review
  await page.goto(partnerPath('en', p.orgId, `/products/${pid}`));
  await expect(main(page).getByText(t('p5common.status.product.draft'), { exact: true }).first()).toBeVisible();
  await btn(page, t('p5common.buttons.submitForReview')).click();
  await expect(page).toHaveURL(/\?sent=1$/);
  await expect(main(page).getByTestId('sent-banner')).toBeVisible();
  expect((await productRow(pid)).status).toBe('submitted');
  expect(await sql(`select 1 from public.product_revisions where product_id = $1 and status = 'submitted'`, [pid])).toHaveLength(1);
  await expect(main(page).getByTestId('revisions')).toContainText(t('p5partner.products.revisionStatus.submitted'));
  // being reviewed: no editing, no second submit
  await expect(main(page).getByRole('link', { name: t('p5partner.products.edit'), exact: true })).toHaveCount(0);
  await expect(btn(page, t('p5common.buttons.submitForReview'))).toHaveCount(0);
  await checkPage(page, 'product overview (in review)');

  // MITRA approves (database as reviewer): the partner publishes, then unpublishes and publishes again
  await reviewProduct(reviewer, pid, 'approve', null);
  await page.reload();
  await expect(main(page).getByText(t('p5common.status.product.approved'), { exact: true }).first()).toBeVisible();
  await btn(page, t('p5partner.products.publish')).click();
  await expect(page).toHaveURL(/[?]published=1$/);
  await expect(main(page).getByTestId('published-banner')).toBeVisible();
  let pr = await productRow(pid);
  expect(pr.status).toBe('published');
  expect(pr.live_revision_id).not.toBeNull();
  expect(await sql(`select 1 from public.catalogue_price_tiers where product_id = $1`, [pid])).toHaveLength(2);
  await btn(page, t('p5partner.products.unpublish')).click();
  await expect(page).toHaveURL(/unpublished=1$/);
  await expect(main(page).getByTestId('unpublished-banner')).toBeVisible();
  expect((await productRow(pid)).status).toBe('unpublished');
  await btn(page, t('p5partner.products.publish')).click();
  await expect(page).toHaveURL(/[?]published=1$/);
  pr = await productRow(pid);
  expect(pr.status).toBe('published');
});

test('E51 reviewer feedback (changes requested, refused), pause, and editing a live product keeps the live version', async ({ page }) => {
  test.setTimeout(300_000);
  const p = await createPartner('e51b');
  const reviewer = await createReviewer('e51b-rev');
  const sup = await seedSupplier(p, reviewer, { name: 'Feedback Supplier' });

  // changes requested: reason shown; fix and send again
  const a = await seedProduct(p, sup.id, reviewer, { stage: 'submitted', data: { name: 'Needs work' } });
  await reviewProduct(reviewer, a.id, 'request_changes', 'Please add the packaging details and a clearer description.');
  await loginPartner(page, p, 'en', '/products');
  await expect(main(page).locator('[data-testid=product-row]').getByText(t('p5common.status.product.changes_requested'))).toBeVisible();
  await page.goto(partnerPath('en', p.orgId, `/products/${a.id}`));
  await expect(main(page).getByTestId('admin-reason')).toContainText('Please add the packaging details and a clearer description.');
  await expect(main(page).getByTestId('admin-reason')).toContainText(t('p5partner.products.reasonChanges'));
  await checkPage(page, 'product (changes requested)');
  await main(page).getByRole('link', { name: t('p5partner.products.edit'), exact: true }).click();
  await page.locator('#packaging').fill('20 pieces per carton');
  await btn(page, t('p5partner.productForm.saveAndSubmit')).click();
  await expect(page).toHaveURL(/sent=1$/);
  expect((await productRow(a.id)).status).toBe('submitted');

  // refused
  await reviewProduct(reviewer, a.id, 'reject', 'This product is not allowed on the platform.');
  await page.reload();
  await expect(main(page).getByText(t('p5common.status.product.rejected'), { exact: true }).first()).toBeVisible();
  await expect(main(page).getByTestId('admin-reason')).toContainText('This product is not allowed on the platform.');
  await expect(main(page).getByTestId('admin-reason')).toContainText(t('p5partner.products.reasonRejected'));

  // paused by MITRA: explained, not editable
  const b = await seedProduct(p, sup.id, reviewer, { stage: 'published', data: { name: 'To be paused' } });
  await asUser(reviewer.id, `select public.suspend_product($1::uuid, $2)`, [b.id, 'A buyer reported the price as wrong.']);
  await page.goto(partnerPath('en', p.orgId, `/products/${b.id}`));
  await expect(main(page).getByText(t('p5common.status.product.suspended'), { exact: true }).first()).toBeVisible();
  await expect(main(page).getByTestId('suspended-note')).toContainText('A buyer reported the price as wrong.');
  await expect(main(page).getByRole('link', { name: t('p5partner.products.edit'), exact: true })).toHaveCount(0);
  await expect(main(page).getByRole('link', { name: t('p5partner.products.editLive'), exact: true })).toHaveCount(0);
  await expect(btn(page, t('p5partner.products.unpublish'))).toHaveCount(0);
  await checkPage(page, 'product (paused)');

  // edit after publish: the live version stays until the new one is approved and published
  const c = await seedProduct(p, sup.id, reviewer, { stage: 'published', data: { name: 'Live version' } });
  await page.goto(partnerPath('en', p.orgId, `/products/${c.id}`));
  await expect(main(page).getByText(t('p5partner.products.editKeepsLive'))).toBeVisible();
  await main(page).getByRole('link', { name: t('p5partner.products.editLive'), exact: true }).click();
  await page.locator('#name').fill('Second version');
  await btn(page, t('p5common.buttons.saveChanges')).click();
  await expect(main(page).getByRole('status').filter({ hasText: t('p5partner.productForm.saved') })).toBeVisible();
  const live = async () => (await sql<{ name: string }>(`select name from public.catalogue_items where product_id = $1`, [c.id]))[0]!.name;
  expect(await live()).toBe('Live version');
  expect((await productRow(c.id)).status).toBe('published');
  expect(((await productRow(c.id)).draft as { name: string }).name).toBe('Second version');
  await page.goto(partnerPath('en', p.orgId, `/products/${c.id}`));
  await btn(page, t('p5common.buttons.submitForReview')).click();
  await expect(page).toHaveURL(/sent=1$/);
  await expect(main(page).getByText(t('p5partner.products.revision.inReviewLong'))).toBeVisible();
  expect((await productRow(c.id)).status).toBe('published');
  expect(await live()).toBe('Live version');
  await reviewProduct(reviewer, c.id, 'approve', null);
  await page.reload();
  await expect(main(page).getByText(t('p5partner.products.revision.approvedLong'))).toBeVisible();
  expect(await live()).toBe('Live version');
  await btn(page, t('p5partner.products.publishNew')).click();
  await expect(page).toHaveURL(/[?]published=1$/);
  expect(await live()).toBe('Second version');
});

test('E51 pictures: upload shows after the file check, description is required, remove; and a conflicting edit is explained without losing input', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const p = await createPartner('e51c');
  const reviewer = await createReviewer('e51c-rev');
  const sup = await seedSupplier(p, reviewer, { name: 'Picture Supplier' });
  const prod = await seedProduct(p, sup.id, reviewer, { stage: 'draft', data: { name: 'Picture product' } });
  await loginPartner(page, p, 'en', `/products/${prod.id}/edit`);
  await expect(main(page).getByText(t('p5partner.media.visibility'))).toBeVisible();

  await main(page).locator('.uploader input[type=file]').setInputFiles(pngWithMetadata({ name: 'photo.png' }));
  await main(page).locator('#new-alt').fill('Green saree folded on a table');
  await main(page).locator('.uploader').getByRole('button', { name: t('p5partner.media.upload'), exact: true }).click();
  await expect(main(page).getByRole('status').filter({ hasText: t('p5partner.media.uploadedClean') })).toBeVisible();
  const card = main(page).locator('[data-testid=product-media]');
  await expect(card).toHaveCount(1);
  await expect(card.getByText(t('p5common.status.scan.clean'))).toBeVisible();
  await expect(card.locator('img')).toHaveAttribute('alt', 'Green saree folded on a table');
  const media = await sql<{ id: string; scan_status: string; alt: string }>(`select id, scan_status, alt from public.product_media where product_id = $1`, [prod.id]);
  expect(media).toHaveLength(1);
  expect(media[0]).toMatchObject({ scan_status: 'clean', alt: 'Green saree folded on a table' });
  await checkPage(page, 'product pictures');
  // change the description
  await card.getByLabel(t('p5partner.media.altLabel'), { exact: true }).fill('A folded green cotton saree');
  await card.getByRole('button', { name: t('p5partner.media.saveAlt'), exact: true }).click();
  await expect(card.getByRole('status').filter({ hasText: t('p5partner.media.saved') })).toBeVisible();
  expect((await sql<{ alt: string }>(`select alt from public.product_media where id = $1`, [media[0]!.id]))[0]!.alt).toBe('A folded green cotton saree');
  await card.getByRole('button', { name: t('p5partner.media.remove'), exact: true }).click();
  await expect(card).toHaveCount(0);
  expect(await sql(`select 1 from public.product_media where product_id = $1 and removed_at is null`, [prod.id])).toHaveLength(0);

  // conflict: someone else (another browser / member) saves the same draft first
  await page.goto(partnerPath('en', p.orgId, `/products/${prod.id}/edit`));
  await expect(page.locator('#name')).toHaveValue('Picture product');
  const other = await signedClient(p.manager);
  const cur = await productRow(prod.id);
  const r = await other.client.rpc('save_product_draft', { p_org: p.orgId, p_supplier: sup.id, p_product: prod.id, p_data: { packaging: 'Changed by someone else' }, p_expected_version: cur.draft_version });
  expect(r.error).toBeNull();
  await page.locator('#name').fill('My typed name');
  await btn(page, t('p5common.buttons.saveChanges')).click();
  await expect(main(page).getByRole('alert').filter({ hasText: t('errors.stale_version') })).toBeVisible();
  await expect(main(page).getByText(t('p5partner.common.conflictBody'))).toBeVisible();
  await expect(page.locator('#name')).toHaveValue('My typed name');
  expect(((await productRow(prod.id)).draft as { name: string }).name).toBe('Picture product');
  await main(page).getByRole('link', { name: t('p5partner.common.conflictReload'), exact: true }).click();
  await expect(page.locator('#packaging')).toHaveValue('Changed by someone else');
  await page.locator('#name').fill('My typed name');
  await btn(page, t('p5common.buttons.saveChanges')).click();
  await expect(main(page).getByRole('status').filter({ hasText: t('p5partner.productForm.saved') })).toBeVisible();
  expect(((await productRow(prod.id)).draft as { name: string }).name).toBe('My typed name');
  void browser;
});

test('E51 no approved supplier: Add Product explains what to do first', async ({ page }) => {
  const p = await createPartner('e51d');
  await loginPartner(page, p, 'en', '/products/new');
  await expect(main(page).getByTestId('no-approved-supplier')).toBeVisible();
  await checkPage(page, 'add product without supplier');
});

for (const locale of ['ta', 'ms'] as Locale[]) {
  test(`E51 ${locale}: product list, overview, form and preview are in the language and pass axe`, async ({ page }) => {
    test.setTimeout(180_000);
    const p = await createPartner(`e51${locale}`, { language: locale });
    const reviewer = await createReviewer(`e51${locale}-rev`);
    const sup = await seedSupplier(p, reviewer, { name: `Lang Supplier ${locale}` });
    const prod = await seedProduct(p, sup.id, reviewer, { stage: 'published' });
    const T = (k: string, v?: Record<string, string>) => msg(locale, k, v);
    await loginPartner(page, p, locale, '/products');
    await expect(main(page).getByRole('heading', { name: T('p5partner.products.title'), level: 1 })).toBeVisible();
    await expect(main(page).locator('[data-testid=product-row]').getByText(T('p5common.status.product.published'), { exact: true })).toBeVisible();
    await checkPage(page, `products ${locale}`);
    await page.goto(partnerPath(locale, p.orgId, `/products/${prod.id}`));
    await expect(main(page).getByText(T('p5partner.products.explain.published'))).toBeVisible();
    await checkPage(page, `product overview ${locale}`);
    await page.goto(partnerPath(locale, p.orgId, `/products/${prod.id}/edit`));
    await expect(main(page).getByRole('heading', { name: T('p5partner.productForm.priceTitle') })).toBeVisible();
    await checkPage(page, `product form ${locale}`);
    await page.goto(partnerPath(locale, p.orgId, `/products/${prod.id}/preview`));
    await expect(main(page).getByText(T('p5partner.preview.banner'))).toBeVisible();
    await checkPage(page, `product preview ${locale}`);
    await page.goto(partnerPath(locale, p.orgId, '/products/new'));
    await expect(main(page).getByRole('heading', { name: T('p5partner.productForm.basicTitle') })).toBeVisible();
    await checkPage(page, `new product ${locale}`);
  });
}

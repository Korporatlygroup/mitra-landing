import { expect, test } from '@playwright/test';
import { anonClient, sql, uniq } from './support/db';
import { msg } from './support/i18n';
import {
  actorGoto,
  approvedSupplier,
  audit,
  createAdmin,
  createPartner,
  createProduct,
  editProduct,
  productData,
  productRow,
  publicSearch,
  publishProduct,
  revisions,
  submitProduct,
} from './support/p5-admin';
import { freshContext } from './support/ui';

const t = (k: string, v?: Record<string, string>) => msg('en', k, v);

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function fromPrice(name: string): Promise<string | null> {
  const { data, error } = await anonClient().rpc('search_catalogue', { p_q: name, p_category: null, p_supplier: null, p_moq_max: null, p_price_min: null, p_price_max: null, p_currency: null, p_offset: 0, p_limit: 20 });
  if (error) throw new Error(error.message);
  const hit = (data.items as { name: string; from_price: string | number | null }[]).find((i) => i.name === name);
  return hit ? String(hit.from_price) : null;
}

/**
 * Journey 2 (tail): a submitted product is reviewed with a side-by-side view and a preview, rejected with a reason, revised and approved,
 * published and found by buyers; an edit of the published product shows a field-level difference; pausing it hides it at once.
 */
test('E71 product review: reject with reason, revise, approve, buyer finds it; edit after publish shows the difference; pause and reinstate', async ({ page, browser }) => {
  test.setTimeout(480_000);
  const reviewer = await createAdmin('admin_review', 'e71r');
  const partner = await createPartner({ prefix: 'e71p' });
  const sup = await approvedSupplier(partner, reviewer);
  const sku = uniq('E71').slice(0, 18);
  const name = `Brass lamp ${sku}`;

  // the partner (browser, aal2) adds a picture through the real upload route before sending the product
  const pctx = await freshContext(browser, page);
  const pp = await pctx.newPage();
  const productId = await createProduct(partner, sup.id, productData(sku, { name }), { submit: false });
  await actorGoto(pp, partner.owner, `/en/orgs/${partner.orgId}/partner`);
  const up = await pp.evaluate(
    async ({ id, b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const fd = new FormData();
      fd.append('file', new Blob([bin], { type: 'image/png' }), 'lamp.png');
      fd.append('alt', 'A brass lamp on a table');
      const r = await fetch(`/api/v1/products/${id}/media`, { method: 'POST', body: fd });
      return { status: r.status, body: await r.json() };
    },
    { id: productId, b64: PNG.toString('base64') },
  );
  expect(up.status).toBe(201);
  expect(up.body).toMatchObject({ ok: true, scanStatus: 'clean' });
  await submitProduct(partner, productId);
  expect((await productRow(productId)).status).toBe('submitted');
  expect(await publicSearch(name)).toHaveLength(0);

  // ---------------------------------------------------------------- reviewer: queue, side-by-side, preview, images
  const rctx = await freshContext(browser, page);
  const rp = await rctx.newPage();
  await actorGoto(rp, reviewer, '/en/admin/catalogue/products');
  const card = rp.locator('[data-testid=product-card]').filter({ hasText: name });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(t('p5admin.products.isNew'));
  await audit(rp, 'product queue');
  await card.getByRole('link', { name }).click();
  await expect(rp).toHaveURL(new RegExp(`/en/admin/catalogue/products/${productId}$`));
  await expect(rp.getByRole('heading', { level: 1 })).toHaveText(name);
  await expect(rp.getByTestId('diff-summary')).toHaveText(t('p5admin.products.detail.firstSubmission'));
  const rows = rp.locator('[data-testid=product-diff] tbody tr');
  expect(await rows.count()).toBeGreaterThan(8);
  await expect(rp.locator('[data-testid=product-diff] tbody tr[data-changed=false]')).toHaveCount(0);
  await expect(rp.locator('tr[data-field=tiers]')).toContainText('10-99 @ 250.00');
  await expect(rp.locator('tr[data-field=tiers]')).toContainText('100+ @ 210.00');
  await expect(rp.getByTestId('product-preview')).toContainText(name);
  await expect(rp.getByTestId('product-preview')).toContainText(t('p5common.price.tiers'));
  await expect(rp.getByTestId('product-image')).toHaveCount(1);
  await expect(rp.getByTestId('product-image')).toContainText(t('p5common.status.scan.clean'));
  // the image is served to the reviewer even though the product is not public
  await expect.poll(() => rp.locator('[data-testid=product-image] img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0);
  await audit(rp, 'product detail (first submission)');

  // ---------------------------------------------------------------- reject: a reason is required
  await rp.locator('#reject-reason').fill('no');
  await rp.getByRole('button', { name: t('p5admin.products.detail.rejectButton'), exact: true }).click();
  await expect(rp.getByRole('alert').filter({ hasText: t('errors.reason_required') })).toBeVisible();
  expect((await productRow(productId)).status).toBe('submitted');
  const why = 'The price tiers do not match the catalogue you uploaded. Please correct them.';
  await rp.locator('#reject-reason').fill(why);
  await rp.getByRole('button', { name: t('p5admin.products.detail.rejectButton'), exact: true }).click();
  await expect(rp.getByTestId('done-banner')).toContainText(t('p5admin.messages.productRejected'));
  expect((await productRow(productId)).status).toBe('rejected');
  let revs = await revisions(productId);
  expect(revs).toHaveLength(1);
  expect(revs[0]).toMatchObject({ rev_no: 1, status: 'rejected', reason: why, decided_by: reviewer.id });
  expect(revs[0]!.decided_at).not.toBeNull();
  await expect(rp.getByTestId('product-decision')).toContainText(why);
  await expect(rp.getByTestId('product-decision')).toContainText(t('p5admin.products.revStatus.rejected'));
  await expect(rp.locator('#reject-reason')).toHaveCount(0);
  await rp.goto('/en/admin/catalogue/products');
  await expect(rp.locator('[data-testid=product-card]').filter({ hasText: name })).toHaveCount(0);
  expect(await publicSearch(name)).toHaveLength(0);

  // ---------------------------------------------------------------- the partner revises and sends again; approve
  await editProduct(partner, sup.id, productId, { description: 'Hand finished brass lamp, corrected price tiers.', tiers: [{ min_qty: 10, max_qty: 99, unit_price: '245.00' }, { min_qty: 100, max_qty: null, unit_price: '205.00' }] });
  await submitProduct(partner, productId);
  revs = await revisions(productId);
  expect(revs.map((r) => [r.rev_no, r.status])).toEqual([[1, 'superseded'], [2, 'submitted']]);
  expect(revs[0]!.reason).toBe(why); // the earlier decision and its reason stay on record
  await rp.goto(`/en/admin/catalogue/products/${productId}`);
  await expect(rp.locator('tr[data-field=tiers]')).toContainText('10-99 @ 245.00');
  await rp.getByRole('button', { name: t('p5admin.products.detail.approveButton'), exact: true }).click();
  await expect(rp.getByTestId('done-banner')).toContainText(t('p5admin.messages.productApproved'));
  expect((await productRow(productId)).status).toBe('approved');
  revs = await revisions(productId);
  expect(revs[1]).toMatchObject({ rev_no: 2, status: 'approved', decided_by: reviewer.id });
  // approved is not published: buyers still cannot see it
  expect(await publicSearch(name)).toHaveLength(0);

  // ---------------------------------------------------------------- the partner publishes; the buyer discovers it
  await publishProduct(partner, productId);
  expect((await productRow(productId)).status).toBe('published');
  expect((await publicSearch(name)).map((i) => i.name)).toEqual([name]);
  expect(await fromPrice(name)).toBe('205');

  // ---------------------------------------------------------------- edit after publish: field-level difference against the live revision
  await editProduct(partner, sup.id, productId, {
    moq: 20,
    description: 'Hand finished brass lamp, now with a deeper base.',
    tiers: [{ min_qty: 20, max_qty: 99, unit_price: '260.00' }, { min_qty: 100, max_qty: null, unit_price: '220.00' }],
  });
  await submitProduct(partner, productId);
  expect((await productRow(productId)).status).toBe('published'); // the live copy is untouched while the change is reviewed
  expect(await fromPrice(name)).toBe('205');
  await rp.goto('/en/admin/catalogue/products');
  const changeCard = rp.locator('[data-testid=product-card]').filter({ hasText: name });
  await expect(changeCard).toContainText(t('p5admin.products.isChange'));
  await changeCard.getByRole('link', { name }).click();
  await expect(rp.getByTestId('diff-summary')).toHaveText(t('p5admin.products.detail.changedCount', { n: '3' }));
  const changed = await rp.locator('[data-testid=product-diff] tbody tr[data-changed=true]').evaluateAll((els) => els.map((e) => e.getAttribute('data-field')));
  expect(changed.sort()).toEqual(['description', 'moq', 'tiers']);
  await expect(rp.locator('tr[data-field=tiers]')).toContainText('10-99 @ 245.00');
  await expect(rp.locator('tr[data-field=tiers]')).toContainText('20-99 @ 260.00');
  await expect(rp.locator('tr[data-field=moq] td').nth(1)).toContainText('10');
  await expect(rp.locator('tr[data-field=moq] td').nth(2)).toContainText('20');
  await expect(rp.locator('tr[data-field=name]')).toHaveAttribute('data-changed', 'false');
  await audit(rp, 'product detail (change to a published product)');
  await rp.getByRole('button', { name: t('p5admin.products.detail.approveButton'), exact: true }).click();
  await expect(rp.getByTestId('done-banner')).toContainText(t('p5admin.messages.productApproved'));
  expect(await fromPrice(name)).toBe('205'); // approved, not yet published
  await publishProduct(partner, productId);
  expect(await fromPrice(name)).toBe('220');
  expect((await revisions(productId)).map((r) => [r.rev_no, r.status])).toEqual([[1, 'superseded'], [2, 'superseded'], [3, 'published']]);

  // ---------------------------------------------------------------- pause (reason required), hidden at once; reinstate does not republish
  await rp.goto(`/en/admin/catalogue/products/${productId}`);
  await rp.locator('#susp-reason').fill('no');
  await rp.getByRole('button', { name: t('p5admin.products.detail.suspendButton'), exact: true }).click();
  await expect(rp.getByRole('alert').filter({ hasText: t('errors.reason_required') })).toBeVisible();
  expect((await productRow(productId)).status).toBe('published');
  const pauseReason = 'Listing is under investigation after a buyer complaint.';
  await rp.locator('#susp-reason').fill(pauseReason);
  await rp.getByRole('button', { name: t('p5admin.products.detail.suspendButton'), exact: true }).click();
  await expect(rp.getByTestId('done-banner')).toContainText(t('p5admin.messages.productSuspended'));
  expect(await productRow(productId)).toMatchObject({ status: 'suspended', suspended_reason: pauseReason });
  expect(await publicSearch(name)).toHaveLength(0);
  await rp.locator('#reinst-reason').fill('Complaint was checked and closed.');
  await rp.getByRole('button', { name: t('p5admin.products.detail.reinstateButton'), exact: true }).click();
  await expect(rp.getByTestId('done-banner')).toContainText(t('p5admin.messages.productReinstated'));
  expect(await productRow(productId)).toMatchObject({ status: 'unpublished', suspended_reason: null });
  expect(await publicSearch(name)).toHaveLength(0);
  const audits = await sql<{ action: string }>(`select action from public.audit_log where entity_id = $1 and action like 'product.%' order by id`, [productId]);
  expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['product.rejected', 'product.approved', 'product.suspended', 'product.reinstated']));
});

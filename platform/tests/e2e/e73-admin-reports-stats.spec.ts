import { expect, test, type Page } from '@playwright/test';
import { sql, uniq, signedClient } from './support/db';
import { msg } from './support/i18n';
import {
  actorGoto,
  approveProductAs,
  approvedSupplier,
  audit,
  call,
  createAdmin,
  createBuyer,
  createPartner,
  createProduct,
  createSupplier,
  productData,
  productRow,
  publicSearch,
  publishedProduct,
  supplierRow,
} from './support/p5-admin';
import { freshContext, type Locale } from './support/ui';

const t = (k: string, v?: Record<string, string>) => msg('en', k, v);
const n = async (q: string) => Number((await sql<{ n: string }>(q))[0]!.n);

async function tile(page: Page, id: string): Promise<string> {
  return (await page.getByTestId(`${id}-value`).innerText()).trim();
}

async function sourcingRequest(buyer: { user: { email: string; password: string }; orgId: string }, productId: string) {
  const s = await signedClient(buyer.user);
  const needed = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
  return s.client.rpc('submit_sourcing_request', {
    p_buyer_org: buyer.orgId,
    p_key: uniq('key-e73'),
    p_items: [{ product_id: productId, quantity: 50 }],
    p_destination_state: 'Selangor',
    p_destination_city: 'Shah Alam',
    p_needed_by: needed,
    p_notes: 'E73 request',
  });
}

test('E73 statistics equal the database, reports are handled, pausing hides products at once, paused partners and suppliers cannot publish or accept requests', async ({ page, browser }) => {
  test.setTimeout(540_000);
  const rv = await createAdmin('admin_review', 'e73r');
  const sp = await createAdmin('admin_support', 'e73s');
  const ops = await createAdmin('admin_ops', 'e73o');
  const partner = await createPartner({ prefix: 'e73p' });
  const sup = await approvedSupplier(partner, rv);
  const tag = uniq('E73').slice(0, 14);
  const nameA = `Lamp A ${tag}`;
  const nameB = `Lamp B ${tag}`;
  const nameC = `Lamp C ${tag}`;
  const a = await publishedProduct(partner, sup.id, rv, productData(`${tag}A`, { name: nameA }));
  const b = await publishedProduct(partner, sup.id, rv, productData(`${tag}B`, { name: nameB }));
  // C is approved but not published yet (used to prove a paused partner cannot publish)
  const c = await createProduct(partner, sup.id, productData(`${tag}C`, { name: nameC }));
  await approveProductAs(rv, c);
  const buyer = await createBuyer('e73buy');

  // ---------------------------------------------------------------- 1. "not enough data" is shown honestly, then real figures
  const noRequestsYet = (await n(`select count(*) n from public.sourcing_requests`)) === 0;
  const opsCtx = await freshContext(browser, page);
  const op = await opsCtx.newPage();
  await actorGoto(op, ops, '/en/admin/catalogue');
  if (noRequestsYet) {
    await expect(op.getByTestId('stat-response-rate-value')).toHaveText(t('p5admin.home.notEnough'));
    await expect(op.getByTestId('stat-median-value')).toHaveText(t('p5admin.home.notEnough'));
  }
  // the report-only role sees the numbers but no review queues
  await expect(op.locator('main a[href$="/admin/catalogue/suppliers"]')).toHaveCount(0);

  // buyer reports both products
  const bc = (await signedClient(buyer.user)).client;
  const r1 = await call(bc, 'report_product', { p_product: a, p_reason: 'misleading', p_note: 'The photo does not match the description.' });
  const r2 = await call(bc, 'report_product', { p_product: b, p_reason: 'counterfeit', p_note: 'Looks like a copy of a known brand.' });
  // a sourcing request that the partner answers, so the response figures have data
  const req = await sourcingRequest(buyer, a);
  expect(req.error).toBeNull();
  await call(partner.owner.client, 'respond_sourcing_request', { p_request: req.data.id, p_action: 'acknowledge', p_note: null, p_expected_version: null });

  const expected = {
    'stat-approved-suppliers': await n(`select count(*) n from public.suppliers s join public.partner_profiles pp on pp.org_id = s.partner_org_id and pp.status = 'approved' join public.organisations o on o.id = s.partner_org_id and o.status = 'active' where s.status = 'approved'`),
    'stat-published-products': await n(`select count(*) n from private.visible_product_ids()`),
    'stat-suppliers-awaiting': await n(`select count(*) n from public.suppliers where draft_submitted_version is not null`),
    'stat-products-awaiting': await n(`select count(*) n from public.product_revisions where status = 'submitted'`),
    'stat-open-reports': await n(`select count(*) n from public.product_reports where status = 'open'`),
    'stat-requests': await n(`select count(*) n from public.sourcing_requests`),
    'stat-import-failed': await n(`select count(*) n from public.import_jobs where status = 'failed'`),
  };
  await op.reload();
  for (const [id, want] of Object.entries(expected)) expect(await tile(op, id), id).toBe(String(want.toLocaleString('en')));
  expect(expected['stat-open-reports']).toBeGreaterThanOrEqual(2);
  await expect(op.getByTestId('stat-response-rate-value')).toHaveText(/^\d+%$/);
  await expect(op.getByTestId('stat-median-value')).not.toHaveText(t('p5admin.home.notEnough'));
  await audit(op, 'overview');
  await op.goto('/en/admin/catalogue/imports');
  expect(await tile(op, 'stat-import-failed')).toBe(String(expected['stat-import-failed']));
  await audit(op, 'import activity');

  // ---------------------------------------------------------------- 2. report queue (support administrator)
  const spCtx = await freshContext(browser, page);
  const sp1 = await spCtx.newPage();
  await actorGoto(sp1, sp, '/en/admin/catalogue/reports');
  const cardA = sp1.locator('[data-testid=report-card]').filter({ hasText: nameA });
  const cardB = sp1.locator('[data-testid=report-card]').filter({ hasText: nameB });
  await expect(cardA).toHaveCount(1);
  await expect(cardA).toContainText('The photo does not match the description.');
  await expect(cardA).toContainText(t('p5common.reportReasons.misleading'));
  await expect(cardB).toContainText(t('p5common.reportReasons.counterfeit'));
  const queued = await sp1.locator('[data-testid=report-card]').count();
  expect(queued).toBeLessThanOrEqual(25);
  expect(queued).toBe(Math.min(25, await n(`select count(*) n from public.product_reports where status = 'open'`)));
  await audit(sp1, 'report queue');

  // dismiss A (a reason is required); the product stays on sale
  await cardA.locator('summary', { hasText: t('p5admin.reports.dismissSummary') }).click();
  await cardA.locator(`#dis-${r1.id}`).fill('no');
  await cardA.getByRole('button', { name: t('p5admin.reports.dismissButton'), exact: true }).click();
  await expect(cardA.getByRole('alert')).toContainText(t('errors.reason_required'));
  await cardA.locator(`#dis-${r1.id}`).fill('Checked: the photo and the description agree.');
  await cardA.getByRole('button', { name: t('p5admin.reports.dismissButton'), exact: true }).click();
  await expect(sp1.getByTestId('done-banner')).toContainText(t('p5admin.messages.reportDismissed'));
  const rep1 = (await sql<{ status: string; handled_by: string; handler_note: string }>(`select status, handled_by, handler_note from public.product_reports where id = $1`, [r1.id]))[0]!;
  expect(rep1).toEqual({ status: 'dismissed', handled_by: sp.id, handler_note: 'Checked: the photo and the description agree.' });
  expect((await productRow(a)).status).toBe('published');
  expect((await publicSearch(nameA)).length).toBe(1);

  // pause B from its report: removed from buyer search at once, report closed with the reason
  expect((await publicSearch(nameB)).length).toBe(1);
  await sp1.goto('/en/admin/catalogue/reports');
  const cb = sp1.locator('[data-testid=report-card]').filter({ hasText: nameB });
  await cb.locator('summary', { hasText: t('p5admin.reports.suspendSummary') }).click();
  await cb.locator(`#sus-${r2.id}`).fill('Counterfeit goods are not allowed on MITRA.');
  await cb.getByRole('button', { name: t('p5admin.reports.suspendButton'), exact: true }).click();
  await expect(sp1.getByTestId('done-banner')).toContainText(t('p5admin.messages.reportActioned'));
  expect(await productRow(b)).toMatchObject({ status: 'suspended', suspended_reason: 'Counterfeit goods are not allowed on MITRA.' });
  expect((await sql<{ status: string }>(`select status from public.product_reports where id = $1`, [r2.id]))[0]!.status).toBe('actioned');
  expect(await publicSearch(nameB)).toHaveLength(0);
  await sp1.goto('/en/admin/catalogue/reports?status=actioned');
  const done = sp1.locator('[data-testid=report-card]').filter({ hasText: nameB });
  await expect(done.getByTestId('report-handler-note')).toHaveText('Counterfeit goods are not allowed on MITRA.');
  await expect(done.getByTestId('report-product-status')).toHaveText(t('p5common.status.product.suspended'));
  await sp1.goto('/en/admin/catalogue/reports?status=dismissed');
  await expect(sp1.locator('[data-testid=report-card]').filter({ hasText: nameA }).getByTestId('report-handler-note')).toBeVisible();
  const report = (await sql<{ n: string }>(`select count(*) n from public.audit_log where action in ('product.report_dismissed','product.report_actioned') and entity_id in ($1, $2)`, [r1.id, r2.id]))[0]!;
  expect(Number(report.n)).toBe(2);

  // ---------------------------------------------------------------- 3. a paused partner cannot publish or accept requests; buyers do not see its products
  const rvCtx = await freshContext(browser, page);
  const rp = await rvCtx.newPage();
  await actorGoto(rp, rv, '/en/admin/catalogue/partners');
  const pcard = rp.locator('[data-testid=partner-card]').filter({ hasText: partner.name });
  await pcard.locator('summary', { hasText: t('p5admin.partners.suspendSummary') }).click();
  await pcard.locator(`#sp-${partner.orgId}`).fill('no');
  await pcard.getByRole('button', { name: t('p5admin.partners.suspendButton'), exact: true }).click();
  await expect(pcard.getByRole('alert')).toContainText(t('errors.reason_required'));
  await pcard.locator(`#sp-${partner.orgId}`).fill('Paused while MITRA checks the partner records.');
  await pcard.getByRole('button', { name: t('p5admin.partners.suspendButton'), exact: true }).click();
  await expect(rp.getByTestId('done-banner')).toContainText(t('p5admin.messages.partnerSuspended'));
  expect((await sql<{ status: string; decision_reason: string }>(`select status::text, decision_reason from public.partner_profiles where org_id = $1`, [partner.orgId]))[0]).toEqual({ status: 'suspended', decision_reason: 'Paused while MITRA checks the partner records.' });
  expect(await publicSearch(nameA)).toHaveLength(0);
  const cur = await call(partner.owner.client, 'get_my_product', { p_org: partner.orgId, p_product: c });
  const pub = await partner.owner.client.rpc('publish_product', { p_org: partner.orgId, p_product: c, p_expected_version: cur.version });
  expect(pub.error?.message).toBe('partner_not_approved');
  expect((await productRow(c)).status).toBe('approved');
  expect((await sourcingRequest(buyer, a)).error?.message).toBe('supplier_not_available');
  await rp.goto('/en/admin/catalogue/partners?status=suspended');
  const pc2 = rp.locator('[data-testid=partner-card]').filter({ hasText: partner.name });
  await pc2.locator('summary', { hasText: t('p5admin.partners.reinstateSummary') }).click();
  await pc2.getByRole('button', { name: t('p5admin.partners.reinstateButton'), exact: true }).click();
  await expect(rp.getByTestId('done-banner')).toContainText(t('p5admin.messages.partnerApproved'));
  expect((await publicSearch(nameA)).length).toBe(1);

  // ---------------------------------------------------------------- 4. a paused supplier: same, and it comes back on reinstatement
  await rp.goto(`/en/admin/catalogue/suppliers/${sup.id}`);
  await rp.locator('#susp-reason').fill('Supplier asked to stop trading for now.');
  await rp.getByRole('button', { name: t('p5admin.suppliers.detail.suspendButton'), exact: true }).click();
  await expect(rp.getByTestId('done-banner')).toContainText(t('p5admin.messages.supplierSuspended'));
  expect(await supplierRow(sup.id)).toMatchObject({ status: 'suspended', suspended_reason: 'Supplier asked to stop trading for now.' });
  expect(await publicSearch(nameA)).toHaveLength(0);
  const pub2 = await partner.owner.client.rpc('publish_product', { p_org: partner.orgId, p_product: c, p_expected_version: cur.version });
  expect(pub2.error).not.toBeNull();
  expect((await productRow(c)).status).toBe('approved');
  expect((await sourcingRequest(buyer, a)).error?.message).toBe('supplier_not_available');
  await rp.locator('#reinst-reason').fill('Supplier is trading again.');
  await rp.getByRole('button', { name: t('p5admin.suppliers.detail.reinstateButton'), exact: true }).click();
  await expect(rp.getByTestId('done-banner')).toContainText(t('p5admin.messages.supplierReinstated'));
  expect((await supplierRow(sup.id)).status).toBe('approved');
  expect((await publicSearch(nameA)).length).toBe(1);
  const evs = (await sql<{ kind: string; reason: string | null }>(`select kind, reason from public.supplier_events where supplier_id = $1 and kind in ('suspended','reinstated') order by id`, [sup.id]));
  expect(evs).toEqual([{ kind: 'suspended', reason: 'Supplier asked to stop trading for now.' }, { kind: 'reinstated', reason: 'Supplier is trading again.' }]);
});

for (const locale of ['ta', 'ms'] as const satisfies readonly Locale[]) {
  test(`E73 main admin screens in ${locale}: translated, axe clean, no sideways scroll`, async ({ page }) => {
    test.setTimeout(300_000);
    const tl = (k: string, v?: Record<string, string>) => msg(locale, k, v);
    const sup = await createAdmin('admin_super', `e73${locale}a`);
    const rv = await createAdmin('admin_review', `e73${locale}r`);
    const partner = await createPartner({ prefix: `e73${locale}` });
    const s = await approvedSupplier(partner, rv);
    const submitted = await createProduct(partner, s.id, productData(uniq('L').slice(0, 14), { name: `Lamp ${locale}` }));
    const live = await publishedProduct(partner, s.id, rv, productData(uniq('M').slice(0, 14), { name: `Lamp live ${locale}` }));
    const buyer = await createBuyer(`e73${locale}b`);
    await call((await signedClient(buyer.user)).client, 'report_product', { p_product: live, p_reason: 'spam', p_note: 'Looks like spam.' });
    const waiting = await createSupplier(partner, { submit: true, name: `Waiting ${locale}` });

    await actorGoto(page, sup, `/${locale}/admin/catalogue`);
    const screens: [string, string][] = [
      [`/${locale}/admin/catalogue`, 'p5admin.home.title'],
      [`/${locale}/admin/catalogue/partners`, 'p5admin.partners.title'],
      [`/${locale}/admin/catalogue/suppliers`, 'p5admin.suppliers.title'],
      [`/${locale}/admin/catalogue/products`, 'p5admin.products.title'],
      [`/${locale}/admin/catalogue/reports`, 'p5admin.reports.title'],
      [`/${locale}/admin/catalogue/imports`, 'p5admin.imports.title'],
    ];
    for (const [path, title] of screens) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(tl(title));
      await audit(page, `${locale} ${path}`);
    }
    // detail screens with decision forms
    await page.goto(`/${locale}/admin/catalogue/suppliers/${waiting.id}`);
    await expect(page.getByRole('button', { name: tl('p5admin.suppliers.detail.approveButton'), exact: true })).toBeVisible();
    await expect(page.locator('legend')).toHaveText(tl('p5admin.suppliers.detail.checksLegend'));
    await expect(page.getByLabel(tl('p5common.verification.checks.contact_reachable'))).toBeVisible();
    await audit(page, `${locale} supplier detail`);
    await page.goto(`/${locale}/admin/catalogue/products/${submitted}`);
    await expect(page.getByRole('button', { name: tl('p5admin.products.detail.approveButton'), exact: true })).toBeVisible();
    await expect(page.getByTestId('product-diff')).toBeVisible();
    await audit(page, `${locale} product detail`);
    // an error is announced in the language of the page
    await page.locator('#reject-reason').fill('no');
    await page.getByRole('button', { name: tl('p5admin.products.detail.rejectButton'), exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: tl('errors.reason_required') })).toBeVisible();
  });
}

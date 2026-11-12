import { expect, test, type Page } from '@playwright/test';
import { signedClient, sql } from './support/db';
import { msg } from './support/i18n';
import { checkPage, createBuyer, createPartner, createReviewer, loginPartner, partnerPath, requestRow, seedProduct, seedRequest, seedSupplier } from './support/p5';
import type { Locale } from './support/ui';

// E53: buyer requests inbox. Requests are created through the real RPC as a buyer (a published product with price ranges), then everything the
// partner does goes through the UI and is checked in the database.

const t = (k: string, v?: Record<string, string>) => msg('en', k, v);
const main = (page: Page) => page.locator('main');

async function setup(prefix: string, language?: Locale) {
  const p = await createPartner(prefix, { language });
  const reviewer = await createReviewer(`${prefix}-rev`);
  const sup = await seedSupplier(p, reviewer, { name: `Req Supplier ${prefix}` });
  const prod = await seedProduct(p, sup.id, reviewer, {
    stage: 'published',
    data: {
      name: 'Tiered saree',
      price_mode: 'tiers',
      unit_price: undefined,
      moq: 10,
      tiers: [
        { min_qty: 10, max_qty: 99, unit_price: '450.00' },
        { min_qty: 100, max_qty: null, unit_price: '400.00' },
      ],
    },
  });
  const buyer = await createBuyer(prefix);
  return { p, reviewer, sup, prod, buyer };
}

test('E53 inbox: partner sees the buyer request with the terms the buyer saw, acknowledges, and the request stays a snapshot', async ({ page }) => {
  test.setTimeout(240_000);
  const { p, prod, buyer } = await setup('e53a');
  const rq = await seedRequest(buyer, prod.id, 120);
  await loginPartner(page, p, 'en', '/requests');
  const row = main(page).locator('[data-testid=request-row]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(rq.reference);
  await expect(row).toContainText(buyer.name);
  await expect(row).toContainText(t('p5partner.requests.statusNew'));
  await checkPage(page, 'requests list');

  // the home page counts it as new
  await page.goto(partnerPath('en', p.orgId));
  await expect(main(page).getByTestId('stat-requestsNew')).toContainText('1');

  await page.goto(partnerPath('en', p.orgId, '/requests'));
  await row.getByRole('link', { name: rq.reference }).click();
  await expect(main(page).getByRole('heading', { name: rq.reference, level: 1 })).toBeVisible();
  const item = main(page).getByTestId('request-item');
  await expect(item).toContainText('Tiered saree');
  await expect(item.getByTestId('item-quantity')).toContainText('120');
  await expect(item.getByTestId('item-price')).toContainText('400.00');
  await expect(item).toContainText('450.00');
  await expect(main(page)).toContainText('Shah Alam');
  await expect(main(page)).toContainText('Please share lead time for the first order.');
  await expect(main(page)).toContainText(buyer.name);
  await expect(main(page).getByText(t('p5partner.requests.privacyNote'))).toBeVisible();
  await checkPage(page, 'request detail');

  // a later price change does not change what the buyer saw
  await sql(`update public.catalogue_price_tiers set unit_price = 999.00 where product_id = $1`, [prod.id]);
  await page.reload();
  await expect(item.getByTestId('item-price')).toContainText('400.00');

  // notification was marked as read by opening the request
  expect(await sql(`select 1 from public.notifications where entity_type = 'sourcing_request' and entity_id = $1 and read_at is null and user_id = $2`, [rq.id, p.manager.id])).toHaveLength(0);

  // acknowledge (no note needed)
  await main(page).getByRole('button', { name: t('p5partner.requests.acknowledge'), exact: true }).click();
  await expect(main(page).getByTestId('done-banner')).toContainText(t('p5partner.requests.acknowledged'));
  await expect.poll(async () => (await requestRow(rq.id)).status).toBe('acknowledged');
  await page.reload();
  await expect(main(page).getByTestId('status-explain')).toContainText(t('p5partner.requests.explain.acknowledged'));
  await expect(main(page).getByRole('button', { name: t('p5partner.requests.acknowledge'), exact: true })).toHaveCount(0);
  await expect(main(page).getByTestId('request-events')).toContainText(t('p5partner.requests.events.acknowledged'));
});

test('E53 clarification needs a note; the buyer reply is visible; a stale page is explained; a paused partner cannot act', async ({ page }) => {
  test.setTimeout(240_000);
  const { p, prod, buyer } = await setup('e53b');
  const rq = await seedRequest(buyer, prod.id, 20);
  await loginPartner(page, p, 'en', `/requests/${rq.id}`);

  // clarification without a note is refused
  await main(page).getByRole('button', { name: t('p5partner.requests.askClarification'), exact: true }).click();
  await expect(main(page).getByRole('alert').filter({ hasText: t('errors.invalid_note') })).toBeVisible();
  expect((await requestRow(rq.id)).status).toBe('submitted');

  // with a note
  await page.locator('#note').fill('Which colours do you need, and is delivery to a warehouse?');
  await main(page).getByRole('button', { name: t('p5partner.requests.askClarification'), exact: true }).click();
  await expect(main(page).getByTestId('done-banner')).toContainText(t('p5partner.requests.clarifySent'));
  await expect.poll(async () => (await requestRow(rq.id)).status).toBe('clarification_requested');
  const ev = await sql<{ kind: string; note: string }>(`select kind, note from public.sourcing_request_events where request_id = $1 order by id`, [rq.id]);
  expect(ev.map((e) => e.kind)).toEqual(['submitted', 'clarification_requested']);
  expect(ev[1]!.note).toBe('Which colours do you need, and is delivery to a warehouse?');

  // the buyer answers (RPC as the buyer): the partner sees the reply and can act again
  const b = await signedClient(buyer.user);
  const rep = await b.client.rpc('reply_sourcing_request', { p_request: rq.id, p_note: 'Green and blue, delivery to our warehouse in Shah Alam.' });
  expect(rep.error).toBeNull();
  await page.goto(partnerPath('en', p.orgId, '/requests'));
  await expect(main(page).locator('[data-testid=request-row]').getByText(t('p5partner.requests.statusNew'))).toBeVisible();
  await page.goto(partnerPath('en', p.orgId, `/requests/${rq.id}`));
  await expect(main(page).getByTestId('request-events')).toContainText('Green and blue, delivery to our warehouse in Shah Alam.');
  await expect(main(page).getByTestId('request-events')).toContainText(t('p5partner.requests.events.buyer_replied'));
  await checkPage(page, 'request detail with reply');

  // stale page: the request moves on in another window before this one is used
  await page.locator('#note').fill('Thank you, noted.');
  await sql(`update public.sourcing_requests set version = version + 1 where id = $1`, [rq.id]);
  await main(page).getByRole('button', { name: t('p5partner.requests.acknowledge'), exact: true }).click();
  await expect(main(page).getByRole('alert').filter({ hasText: t('errors.stale_version') })).toBeVisible();
  await expect(main(page).getByText(t('p5partner.common.conflictBody'))).toBeVisible();
  await expect(page.locator('#note')).toHaveValue('Thank you, noted.');

  // a paused partner sees the status page instead of the request
  await sql(`update public.partner_profiles set status = 'suspended' where org_id = $1`, [p.orgId]);
  await page.goto(partnerPath('en', p.orgId, `/requests/${rq.id}`));
  await expect(main(page).getByTestId('partner-gate')).toBeVisible();
  await expect(main(page).getByRole('button', { name: t('p5partner.requests.acknowledge'), exact: true })).toHaveCount(0);
  await checkPage(page, 'requests (paused partner)');
});

test('E53 a viewer can read a request but not answer it; another partner cannot open it', async ({ page }) => {
  const { p, prod, buyer } = await setup('e53c');
  const rq = await seedRequest(buyer, prod.id, 15);
  const viewer = await createPartner('e53c-v', { managerRole: 'viewer' });
  await sql(`insert into public.memberships (org_id, user_id, role) values ($1, $2, 'viewer') on conflict do nothing`, [p.orgId, viewer.manager.id]);
  await loginPartner(page, { ...viewer, orgId: p.orgId }, 'en', `/requests/${rq.id}`);
  await expect(main(page).getByRole('heading', { name: rq.reference, level: 1 })).toBeVisible();
  await expect(main(page).getByText(t('p5partner.requests.cannotRespond'))).toBeVisible();
  await expect(main(page).getByRole('button', { name: t('p5partner.requests.acknowledge'), exact: true })).toHaveCount(0);
  // same user, own partner organisation: the request is not theirs (404)
  const r = await page.goto(partnerPath('en', viewer.orgId, `/requests/${rq.id}`));
  expect(r?.status()).toBe(404);
});

for (const locale of ['ta', 'ms'] as Locale[]) {
  test(`E53 ${locale}: inbox and request detail are in the language and pass axe`, async ({ page }) => {
    test.setTimeout(180_000);
    const { p, prod, buyer } = await setup(`e53${locale}`, locale);
    const rq = await seedRequest(buyer, prod.id, 30);
    const T = (k: string, v?: Record<string, string>) => msg(locale, k, v);
    await loginPartner(page, p, locale, '/requests');
    await expect(main(page).getByRole('heading', { name: T('p5partner.requests.title'), level: 1 })).toBeVisible();
    await expect(main(page).getByText(T('p5partner.requests.statusNew'), { exact: true }).first()).toBeVisible();
    await checkPage(page, `requests ${locale}`);
    await page.goto(partnerPath(locale, p.orgId, `/requests/${rq.id}`));
    await expect(main(page).getByRole('heading', { name: T('p5partner.requests.itemsTitle') })).toBeVisible();
    await expect(main(page).getByRole('button', { name: T('p5partner.requests.acknowledge'), exact: true })).toBeVisible();
    await checkPage(page, `request detail ${locale}`);
    await page.goto(partnerPath(locale, p.orgId, '/notifications'));
    await expect(main(page).getByRole('heading', { name: T('p5partner.notifications.title'), level: 1 })).toBeVisible();
    await checkPage(page, `notifications ${locale}`);
    await page.goto(partnerPath(locale, p.orgId, '/settings'));
    await checkPage(page, `settings ${locale}`);
  });
}

import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createOrgAs, createUser, addMember, serviceClient, sql, type TestUser } from './support/db';
import { makePartner } from './support/p5-buyer';
import { loginUi } from './support/ui';
import { msg } from './support/i18n';
import { smallPdf } from './support/biz';
import { CRON_SECRET } from './support/env';

const future = () => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
async function audit(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}
let buyer: TestUser;
let first: Awaited<ReturnType<typeof makePartner>>;
let second: Awaited<ReturnType<typeof makePartner>>;
let staff: TestUser;
let otherStaff: TestUser;

test.beforeAll(async () => {
  buyer = await createUser('p6-buyer');
  await createOrgAs(buyer, 'buyer', 'Synthetic sourcing buyer');
  first = await makePartner('p6-partner-a');
  second = await makePartner('p6-partner-b');
  staff = await createUser('p6-staff-a');
  otherStaff = await createUser('p6-staff-b');
  await addMember(first.org, staff.id, 'staff');
  await addMember(second.org, otherStaff.id, 'staff');
});

for (const locale of ['en', 'ta', 'ms'] as const) {
  test(`P6 persisted buyer-to-partner journey in ${locale}`, async ({ browser, page }) => {
    test.setTimeout(180_000);
    await loginUi(page, buyer, locale);
    await page.goto(`/${locale}/sourcing/new`);
    await expect(page.getByRole('heading', { name: msg(locale, 'p6.new') })).toBeVisible();
    await audit(page);
    await page.locator('#product-0').fill('Synthetic cotton rolls');
    await page.locator('#quantity-0').fill('10');
    await page.locator('#unit-0').fill('rolls');
    await page.locator('#category-0').selectOption('textiles-apparel');
    await page.locator('#p6-state').selectOption('Selangor');
    await page.locator(`input[name=partner][value="${first.org}"]`).check();
    await page.locator(`input[name=partner][value="${second.org}"]`).check();
    await page.getByRole('button', { name: msg(locale, 'p6.send'), exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/sourcing/[0-9a-f-]{36}$`));
    const rfq = page.url().split('/').pop()!;
    let documentId = '';
    await expect(page.locator('strong').filter({ hasText: 'Synthetic cotton rolls' }).first()).toBeVisible();
    await audit(page);
    expect((await sql<{ n: number }>('select count(*)::int as n from public.sourcing_rfq_items where rfq_id=$1', [rfq]))[0]!.n).toBe(1);

    const partnerContext = await browser.newContext({ baseURL: page.url().split(`/${locale}/`)[0] });
    const partnerPage = await partnerContext.newPage();
    try {
      await loginUi(partnerPage, staff, locale);
      await partnerPage.goto(`/${locale}/sourcing/${rfq}?partner=${first.org}`);
      await expect(partnerPage.locator('strong').filter({ hasText: 'Synthetic cotton rolls' }).first()).toBeVisible();
      await audit(partnerPage);
      await partnerPage.getByRole('button', { name: msg(locale, 'p6.accept'), exact: true }).first().click();
      await partnerPage.locator('[id^="price-"]').fill('12.50');
      await partnerPage.locator('#p6-valid').fill(future());
      await partnerPage.getByRole('button', { name: msg(locale, 'p6.submitQuote'), exact: true }).click();
      await expect.poll(async () => (await sql<{ n: number }>(
        'select count(*)::int as n from public.sourcing_rfq_quotes where rfq_id=$1', [rfq]))[0]!.n).toBe(1);
      await partnerPage.locator(`#sourcing-file-${first.org}`).setInputFiles(smallPdf());
      await partnerPage.getByRole('button', { name: msg(locale, 'p6.uploadDocument') }).click();
      await expect.poll(async () => (await sql<{ id: string }>(
        'select id from public.sourcing_rfq_documents where rfq_id=$1 and partner_org_id=$2',
        [rfq, first.org]))[0]?.id).toBeTruthy();
      documentId = (await sql<{ id: string }>(
        'select id from public.sourcing_rfq_documents where rfq_id=$1 and partner_org_id=$2',
        [rfq, first.org]))[0]!.id;
    } finally {
      await partnerContext.close();
    }

    await page.reload();
    await expect(page.getByText('INR 125.00', { exact: true })).toBeVisible();
    const docUrl = `/api/v1/sourcing/${rfq}/documents/${documentId}`;
    expect((await page.request.get(docUrl)).status()).toBe(200);
    const otherContext = await browser.newContext({ baseURL: page.url().split(`/${locale}/`)[0] });
    try {
      const otherPage = await otherContext.newPage();
      await loginUi(otherPage, otherStaff, locale);
      expect((await otherPage.request.get(docUrl)).status()).toBe(404);
    } finally { await otherContext.close(); }
    await page.locator(`#message-${first.org}`).fill('Synthetic request details for the first partner');
    await page.locator(`#message-${first.org}`).locator('xpath=ancestor::form').getByRole('button',
      { name: msg(locale, 'p6.sendMessage') }).click();
    await expect.poll(async () => (await sql<{ n: number }>(
      'select count(*)::int as n from public.sourcing_rfq_messages where rfq_id=$1 and partner_org_id=$2',
      [rfq, first.org]))[0]!.n).toBe(1);
    await page.locator('#sample-partner').selectOption(first.org);
    await page.getByRole('button', { name: msg(locale, 'p6.requestSample') }).click();
    await expect.poll(async () => (await sql<{ n: number }>(
      'select count(*)::int as n from public.sourcing_rfq_samples where rfq_id=$1', [rfq]))[0]!.n).toBe(1);
    const quote = (await sql<{ id: string }>('select id from public.sourcing_rfq_quotes where rfq_id=$1', [rfq]))[0]!.id;
    await page.locator(`#counter-${quote}`).fill('115.00');
    await page.locator(`#counter-note-${quote}`).fill('Could you offer this price?');
    await page.getByRole('button', { name: msg(locale, 'p6.suggest') }).click();
    await expect.poll(async () => (await sql<{ n: number }>(
      'select count(*)::int as n from public.sourcing_rfq_counters where quote_id=$1', [quote]))[0]!.n).toBe(1);

    const revisionContext = await browser.newContext({ baseURL: page.url().split(`/${locale}/`)[0] });
    const revisionPage = await revisionContext.newPage();
    try {
      await loginUi(revisionPage, staff, locale);
      await revisionPage.goto(`/${locale}/sourcing/${rfq}?partner=${first.org}`);
      await expect(revisionPage.getByText('Synthetic request details for the first partner')).toBeVisible();
      await revisionPage.getByRole('button', { name: msg(locale, 'p6.accept'), exact: true }).first().click();
      await revisionPage.locator('[id^="price-"]').fill('11.50');
      await revisionPage.getByRole('button', { name: msg(locale, 'p6.reviseQuote') }).click();
      await expect.poll(async () => (await sql<{ n: number }>(
        'select count(*)::int as n from public.sourcing_rfq_quote_revisions where quote_id=$1', [quote]))[0]!.n).toBe(2);
    } finally {
      await revisionContext.close();
    }
    await page.reload();
    await expect(page.getByText('INR 115.00', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: msg(locale, 'p6.choose'), exact: true }).click();
    await expect(page.getByText(msg(locale, 'p6.status.preferred_selected')).first()).toBeVisible();
    expect((await sql<{ n: number }>('select count(*)::int as n from public.sourcing_rfqs where id=$1 and status=$2',
      [rfq, 'preferred_selected']))[0]!.n).toBe(1);
    await page.locator('#template-title').fill('Synthetic repeat list');
    await page.getByRole('button', { name: msg(locale, 'p6.saveTemplate') }).click();
    await expect(page.locator('.form-message-slot').filter({ hasText: msg(locale, 'p6.templateSaved') })).toBeVisible();
    await page.goto(`/${locale}/sourcing`);
    await page.getByRole('link', { name: msg(locale, 'p6.useTemplate') }).last().click();
    await expect(page.locator('#product-0')).toHaveValue('Synthetic cotton rolls');
    const path = (await sql<{ storage_path: string }>(
      'select storage_path from public.sourcing_rfq_documents where id=$1', [documentId]))[0]!.storage_path;
    await sql('delete from public.sourcing_rfq_documents where id=$1', [documentId]);
    expect((await sql<{ n: number }>(
      'select count(*)::int as n from private.sourcing_storage_cleanup where storage_path=$1', [path]))[0]!.n).toBe(1);
    await sql("update private.sourcing_storage_cleanup set queued_at=now()-interval '11 minutes' where storage_path=$1", [path]);
    const cleaned = await page.request.post('/api/v1/jobs/rescan', {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(cleaned.status()).toBe(200);
    expect((await sql<{ n: number }>(
      'select count(*)::int as n from private.sourcing_storage_cleanup where storage_path=$1', [path]))[0]!.n).toBe(0);
    const { error: deletedObject } = await serviceClient().storage.from('verification-docs').download(path);
    expect(deletedObject).toBeTruthy();
  });
}

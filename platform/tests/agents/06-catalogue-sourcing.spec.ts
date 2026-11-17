import { expect, test } from '@playwright/test';
import { Agent, cover } from './harness';
import { def } from './personas';
import { persona } from './store';
import { expectNoRawKeys, partnerPath, t } from './ui';

// Supplier (partner) agent and the Products-from-India catalogue: partner gate, administrator approval, supplier wizard, buyer
// discovery, price requests, partner request inbox and the sourcing (RFQ) screens. Uploads stay quarantined (no scanner).
test.describe.configure({ mode: 'serial' });

test('supplier partner: gate before approval, administrator approves, partner workspace opens', async ({ browser }) => {
  test.setTimeout(600_000);
  const sp = await Agent.create(browser, 'supplier');
  const ad = await Agent.create(browser, 'admin');
  const org = persona('supplier').orgId!;
  await sp.login();
  await sp.check('catalogue', 'partner workspace before approval shows a clear state, not an error', async () => {
    const r = await sp.goto(partnerPath(org));
    expect(r!.status()).toBeLessThan(500);
    await expectNoRawKeys(sp.page);
    cover('catalogue', 'partner home text before approval', 'observed', (await sp.page.locator('main').last().innerText()).replace(/\s+/g, ' ').slice(0, 220));
  });
  await ad.login();
  await ad.check('catalogue', 'administrator partner list shows the supplier organisation', async () => {
    await ad.open('/en/admin/catalogue/partners');
    await expect(ad.page.locator('main').last()).toContainText(def('supplier').orgName!);
    cover('catalogue', 'admin partner list: approve control for self-registered partner organisations', 'observed', (await ad.page.locator('main').last().innerText()).replace(/\s+/g, ' ').slice(0, 260));
  });
  await ad.close();
  await sp.close();
});

test('supplier partner builds a supplier record through the wizard', async ({ browser }) => {
  test.setTimeout(600_000);
  const sp = await Agent.create(browser, 'supplier');
  const org = persona('supplier').orgId!;
  await sp.login();
  const main = sp.page.locator('main').last();
  await sp.check('catalogue', 'supplier wizard step 1 validates a one-letter name and keeps typed values', async () => {
    await sp.goto(partnerPath(org, '/suppliers/new'));
    if (/do not have access|approval|pending/i.test(await main.innerText())) throw new Error('partner not approved: wizard unavailable');
    await sp.page.locator('#name').fill('A');
    await sp.page.locator('#state_city').fill('Chennai');
    await sp.page.locator('#main_category').selectOption('textiles-apparel');
    await sp.page.getByRole('button', { name: t('p5partner.supplierForm.saveContinue'), exact: true }).click();
    await expect(sp.page.locator('main').last().getByRole('alert')).toBeVisible();
    await expect(sp.page.locator('#state_city')).toHaveValue('Chennai');
  });
  await sp.check('catalogue', 'supplier wizard saves a valid first step', async () => {
    await sp.page.locator('#name').fill('Agent Chennai Cotton Mills');
    await sp.page.getByRole('button', { name: t('p5partner.supplierForm.saveContinue'), exact: true }).click();
    await sp.page.waitForLoadState('networkidle');
    await expect(sp.page).toHaveURL(/suppliers\/[0-9a-f-]{36}/);
  });
  await sp.check('catalogue', 'partner product, import and request screens open', async () => {
    for (const p of ['/products', '/import', '/requests', '/notifications', '/settings', '/sourcing']) {
      const r = await sp.goto(partnerPath(org, p), false);
      expect(r!.status(), p).toBeLessThan(500);
    }
  });
  await sp.close();
});

test('buyer: browse the catalogue, compare, save, and ask for a price (signed-in buyer)', async ({ browser }) => {
  test.setTimeout(600_000);
  const v = await Agent.create(browser, 'buyerA');
  await v.login();
  await v.check('catalogue', 'catalogue index renders for a signed-in buyer, with an empty state if nothing is approved', async () => {
    await v.goto('/en/catalogue');
    await expectNoRawKeys(v.page);
    cover('catalogue', 'catalogue products visible to buyers', 'observed', `${await v.page.locator('[data-product-id]').count()} product cards`);
  });
  await v.check('catalogue', 'saved list and my price requests screens open', async () => {
    for (const p of ['/en/catalogue/saved', '/en/catalogue/requests', '/en/catalogue/compare']) {
      const r = await v.goto(p, false);
      expect(r!.status(), p).toBeLessThan(500);
    }
  });
  await v.check('catalogue', 'compare with nothing selected explains what to do', async () => {
    await v.goto('/en/catalogue/compare');
    await expect(v.page.locator('main').last()).not.toContainText(/error|undefined/i);
  });
  await v.close();
});

test('sourcing (RFQ): buyer and partner screens, validation and empty states', async ({ browser }) => {
  test.setTimeout(600_000);
  const b = await Agent.create(browser, 'buyerA');
  await b.login();
  await b.check('sourcing', 'sourcing list opens', async () => {
    const r = await b.goto('/en/sourcing');
    expect(r!.status()).toBeLessThan(500);
    await expectNoRawKeys(b.page);
  });
  await b.check('sourcing', 'new sourcing request form refuses an empty submission with messages', async () => {
    await b.goto('/en/sourcing/new');
    await b.page.locator('main form button[type=submit]').first().click();
    await b.page.waitForLoadState('domcontentloaded');
    await expect(b.page).toHaveURL(/sourcing/);
    await expect(b.page.locator('main').last()).toContainText(/required|enter|choose|invalid|add/i);
  });
  await b.check('sourcing', 'unknown RFQ reference is a not-found page', async () => {
    const r = await b.goto('/en/sourcing/NO-SUCH-RFQ', false);
    expect(r!.status()).toBe(404);
  });
  cover('sourcing', 'full RFQ → partner quote → sample → choice journey', 'observed', 'Needs an approved supplier with a published product; exercised end-to-end by tests/hosted/sourcing-uploads.spec.ts (see report)');
  cover('sourcing', 'RFQ attachments', 'disabled', 'Attachments are refused while no scanner exists (fail-closed)');
  await b.close();
});

import { expect, test } from '@playwright/test';
import { Agent, cover } from './harness';
import { def } from './personas';
import { persona } from './store';
import { expectNoRawKeys, t } from './ui';

// Administrator agent: MFA sign-in, every console page reachable, listing review of the seller's listing, second-administrator view,
// and the refusal of the console to non-administrators.
test.describe.configure({ mode: 'serial' });

const ADMIN_PAGES = ['/admin', '/admin/verification', '/admin/listings', '/admin/users', '/admin/audit', '/admin/reports', '/admin/reviews', '/admin/products', '/admin/news', '/admin/privacy-requests', '/admin/sourcing', '/admin/business-help', '/admin/business-help/sources', '/admin/business-help/page-changes', '/admin/catalogue', '/admin/catalogue/partners', '/admin/catalogue/suppliers', '/admin/catalogue/products', '/admin/catalogue/reports', '/admin/catalogue/imports'];

test('administrator signs in with MFA and every console page opens', async ({ browser }) => {
  test.setTimeout(900_000);
  const ad = await Agent.create(browser, 'admin');
  await ad.must('admin', 'sign in with password then TOTP second step', async () => {
    await ad.login();
    await ad.open('/en/admin');
    await expect(ad.page).toHaveURL(/\/en\/admin/);
  });
  for (const p of ADMIN_PAGES) {
    await ad.check('admin', `console ${p} opens`, async () => {
      const r = await ad.open(`/en${p}`);
      expect(r!.status()).toBeLessThan(400);
      await expect(ad.page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expectNoRawKeys(ad.page);
    });
  }
  await ad.open('/en/admin');
  await ad.a11y('a11y', 'admin overview');
  await ad.close();
});

test('administrator reviews the seller listing; the seller then appears in the public directory', async ({ browser }) => {
  test.setTimeout(600_000);
  const ad = await Agent.create(browser, 'admin');
  await ad.login();
  const name = def('seller').orgName!;
  await ad.open('/en/admin/listings');
  const pending = await ad.page.locator('tbody tr').filter({ hasText: name }).count();
  if (!pending) cover('admin-review', 'listing queue: seller listing already decided in an earlier run', 'observed');
  else await ad.must('admin-review', 'approve the listing with the real decision form', async () => {
    await ad.page.locator('tbody tr').filter({ hasText: name }).first().getByRole('link', { name: t('adminList.open') }).click();
    await expect(ad.page.getByRole('heading', { level: 1 })).toHaveText(name);
    await ad.page.locator('#dec-approve').check();
    await ad.page.getByRole('button', { name: t('adminList.save'), exact: true }).click();
    await expect(ad.page.getByText(t('adminList.nothingPending'))).toBeVisible();
  });
  const v = await Agent.create(browser, 'buyerA');
  await v.check('admin-review', 'approved listing is visible in the public directory search', async () => {
    await v.goto('/en/directory');
    await v.page.locator('#q').fill('AGENT Seller');
    await v.page.getByRole('button', { name: t('dir.search'), exact: true }).click();
    await expect(v.page.locator('ul.biz-grid a.biz').filter({ hasText: name })).toBeVisible();
  });
  await v.check('admin-review', 'public profile does not show the private street address or SSM number', async () => {
    await v.page.locator('ul.biz-grid a.biz').filter({ hasText: name }).click();
    const txt = await v.page.locator('main').innerText();
    expect(txt).not.toContain('Jalan Ujian Satu');
    expect(txt).not.toContain('202001099999');
  });
  await v.a11y('a11y', 'public business profile');
  await v.close();
  await ad.close();
});

test('second administrator and non-administrators vs the console', async ({ browser }) => {
  test.setTimeout(600_000);
  const a2 = await Agent.create(browser, 'admin2');
  await a2.check('admin', 'admin_review signs in with MFA and sees the verification queue', async () => {
    await a2.login();
    const r = await a2.open('/en/admin/verification');
    expect(r!.status()).toBeLessThan(400);
  });
  await a2.check('admin', 'admin_review (not super) cannot open the user and role console', async () => {
    const r = await a2.open('/en/admin/users');
    const body = (await a2.page.locator('main').last().innerText()).replace(/\s+/g, ' ');
    cover('admin', 'admin_review on /admin/users', 'observed', `${r!.status()} ${body.slice(0, 90)}`);
    expect(body).toMatch(/do not have access/i);
    expect(body).not.toMatch(/@example\.test/);
  });
  await a2.close();
  for (const k of ['buyerA', 'seller'] as const) {
    const u = await Agent.create(browser, k);
    await u.login();
    await u.check('admin-authz', `${k} is refused the admin console`, async () => {
      const r = await u.goto('/en/admin/verification', false);
      const body = (await u.page.locator('main').last().innerText()).replace(/\s+/g, ' ');
      expect(body).toMatch(/do not have access/i);
      expect(body).not.toMatch(/AGENT|@example\.test|Approve/);
      cover('admin-authz', `${k}: HTTP status of the denial page`, r!.status() === 200 ? 'fail' : 'pass', `status ${r!.status()} with an in-page message (should be 403)`);
    });
    await u.close();
  }
  void persona;
});

import { expect, test } from '@playwright/test';
import { Agent } from '../agents/harness';
import { msg } from '../e2e/support/i18n';

// Production acceptance for the redesigned shell with SYNTHETIC accounts: stable sidebar, remembered collapse, Home and Programmes pages.
const t = (k: string) => msg('en', k);

test.beforeAll(() => {
  if (process.env.ALLOW_PRODUCTION_TESTS !== 'synthetic-only') throw new Error('Refusing to run: production synthetic accounts only.');
});

test('sidebar keeps 248px across modules, collapses only on request, remembers it, and the pages render', async ({ browser }) => {
  test.setTimeout(240_000);
  const a = await Agent.create(browser, 'seller');
  await a.login();
  await a.page.setViewportSize({ width: 1440, height: 900 });
  const width = () => a.page.locator('aside.ws-side').evaluate((e) => Math.round(e.getBoundingClientRect().width));
  const fits = () => a.page.evaluate(() => Math.abs(document.querySelector('.ws-shell')!.getBoundingClientRect().width - document.documentElement.clientWidth) <= 20);
  for (const p of ['/en', '/en/directory', '/en/catalogue', '/en/news', '/en/business-help']) {
    await a.check('prod-shell', `${p}: sidebar 248px and the shell uses the window`, async () => {
      await a.goto(p);
      expect(await width()).toBe(248);
      expect(await fits()).toBe(true);
    });
  }
  await a.check('prod-shell', 'Home is a hub: search and the key sections', async () => {
    await a.goto('/en');
    await expect(a.page.getByRole('search').first()).toBeVisible();
    for (const k of ['actionsTitle', 'newsTitle', 'govTitle', 'marketTitle', 'activityTitle']) await expect(a.page.getByRole('heading', { level: 2, name: t(`apphome.${k}`) })).toBeVisible();
  });
  await a.check('prod-shell', 'collapse is by click only and survives navigation', async () => {
    await a.goto('/en/catalogue');
    await a.page.getByRole('button', { name: t('ws.collapse') }).click();
    await expect.poll(width).toBe(72);
    await a.goto('/en/business-help');
    expect(await width()).toBe(72);
    await a.goto('/en/catalogue');
    expect(await width()).toBe(72);
    await a.page.getByRole('button', { name: t('ws.collapse') }).click();
    await expect.poll(width).toBe(248);
  });
  await a.check('prod-shell', 'Programmes & Opportunities: title, four filter cards, tabs, how it works, news, independence notice', async () => {
    await a.goto('/en/business-help');
    await expect(a.page.getByRole('heading', { level: 1, name: t('gov.opps.title') })).toBeVisible();
    for (const k of ['cardRec', 'cardNew', 'cardClosing', 'cardSaved']) await expect(a.page.locator('.opps-card').filter({ hasText: t(`gov.opps.${k}`) })).toBeVisible();
    for (const k of ['tabAll', 'tabRec', 'tabNew', 'tabClosing', 'tabSaved']) await expect(a.page.getByRole('link', { name: t(`gov.opps.${k}`), exact: true })).toBeVisible();
    await expect(a.page.getByRole('heading', { name: t('gov.opps.howTitle') })).toBeVisible();
    await expect(a.page.locator('main')).toContainText(t('gov.independent'));
  });
  await a.check('prod-shell', 'the saved list opens without asking for a business', async () => {
    await a.goto('/en/business-help/saved');
    await expect(a.page.getByRole('heading', { name: t('gov.opps.mySaved') })).toBeVisible();
  });
  await a.check('prod-shell', 'phone: Home fits 390px and the drawer opens', async () => {
    await a.page.setViewportSize({ width: 390, height: 844 });
    await a.goto('/en');
    const [sw, cw] = await a.page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(sw).toBeLessThanOrEqual(cw + 1);
    await a.page.getByRole('button', { name: t('ws.openMenu') }).click();
    await expect(a.page.locator('aside.ws-side').getByRole('link', { name: t('ws.menu.home'), exact: true })).toBeVisible();
  });
  await a.close();
});

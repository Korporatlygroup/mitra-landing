import { expect, test } from '@playwright/test';
import { Agent } from '../agents/harness';
import { loadStore, persona } from '../agents/store';
import { msg } from '../e2e/support/i18n';

// Production acceptance for My Business 360° with SYNTHETIC accounts only. Empty states are expected while no assistance programme
// or news item has been approved by an administrator: the test asserts they are shown honestly, never invented figures.
const t = (k: string, v?: Record<string, string | number>) => msg('en', k, v);

test.describe.configure({ mode: 'serial' });
test.beforeAll(() => {
  if (process.env.ALLOW_PRODUCTION_TESTS !== 'synthetic-only') throw new Error('Refusing to run: production synthetic accounts only.');
  if (!loadStore().personas.seller?.orgId) throw new Error('Run 01 and 02 first.');
});

test('360 page renders every section from real data, with honest empty states', async ({ browser }) => {
  test.setTimeout(180_000);
  const a = await Agent.create(browser, 'seller');
  await a.login();
  const org = persona('seller').orgId!;
  await a.check('prod-360', 'the business menu offers My Business 360° and it opens', async () => {
    await a.goto(`/en/orgs/${org}/business`);
    await a.page.locator(`a[href$="/business/360"]`).first().click();
    await a.page.waitForURL(/\/business\/360$/);
    await expect(a.page.getByRole('heading', { level: 1, name: t('b360.title') })).toBeVisible();
  });
  await a.check('prod-360', 'sections A-G are present', async () => {
    for (const k of ['overview', 'nextTitle', 'assist.title', 'readiness.title', 'training.title', 'market.title', 'news.title']) {
      await expect(a.page.getByRole('heading', { level: 2, name: t(`b360.${k}`) })).toBeVisible();
    }
  });
  await a.check('prod-360', 'profile completion is a real fraction of saved facts (not a fixed number)', async () => {
    const hint = await a.page.locator('.metric', { hasText: t('b360.completion') }).innerText();
    expect(hint).toMatch(/\d+%/);
    expect(hint).toMatch(/\d+ of 10 checks done/);
    const done = Number(/(\d+) of 10/.exec(hint)![1]);
    const ticks = await a.page.locator('#b360-c ~ ul li, section[aria-labelledby="b360-c"] li').filter({ hasText: '✓' }).count();
    expect(ticks).toBe(done);
  });
  await a.check('prod-360', 'every action link stays inside this organisation or a public area', async () => {
    const hrefs = await a.page.locator('main a[href^="/"]').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
    const orgIds = hrefs.flatMap((h) => h.match(/orgs\/([0-9a-f-]{36})/)?.[1] ?? []);
    expect(orgIds.every((x) => x === org)).toBe(true);
  });
  await a.check('prod-360', 'with no approved programme or news the page says so instead of inventing content', async () => {
    const main = a.page.locator('main').last();
    await expect(main).toContainText(new RegExp(`${t('b360.assist.noProfile')}|${t('b360.assist.none')}`));
    await expect(main).toContainText(t('b360.training.none'));
    await expect(main).toContainText(t('b360.news.none'));
  });
  await a.check('prod-360', 'the page fits a phone', async () => {
    await a.page.setViewportSize({ width: 390, height: 844 });
    await a.goto(`/en/orgs/${org}/business/360`);
    const [sw, cw] = await a.page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(sw).toBeLessThanOrEqual(cw + 1);
  });
  await a.close();
});

test('another account cannot open this business 360 page', async ({ browser }) => {
  const other = await Agent.create(browser, 'buyerB');
  await other.login();
  await other.check('prod-360', 'a member of a different business is refused', async () => {
    await other.goto(`/en/orgs/${persona('seller').orgId}/business/360`, false);
    const body = await other.page.locator('body').innerText();
    expect(body).not.toContain('PROD TEST Seller');
    expect(body).not.toContain(t('b360.overview'));
  });
  await other.close();
});

import path from 'node:path';
import { test } from '@playwright/test';
import { createOrgUi, loginUi } from './support/ui';
import { createUser } from './support/db';

// Evidence for the redesign release candidate: screenshots of the main screens at 360, 390, 768, 1024, 1280, 1440 and 1920 px.
// Run on request: SHOTS=1 npx playwright test e97 (not part of the normal suite).
test.skip(process.env.SHOTS !== '1', 'screenshots are produced on request');

const out = path.join(import.meta.dirname, '..', '..', 'docs', 'redesign-screenshots');
const WIDTHS = [360, 390, 768, 1024, 1280, 1440, 1920];

test('screenshots of the signed-in screens', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'sizes are set explicitly');
  test.setTimeout(300_000);
  const u = await createUser('shots', { name: 'Aisha Rahman' });
  await loginUi(page, u, 'en');
  await createOrgUi(page, 'business', 'Kedai Aisha', 'en');
  const orgId = page.url().match(/orgs\/([0-9a-f-]{36})/)![1]!;
  const screens: [string, string][] = [
    ['home', '/en'],
    ['assistance', '/en/business-help'],
    ['assistance-saved', '/en/business-help/saved'],
    ['news', '/en/news'],
    ['directory', '/en/directory'],
    ['products', '/en/catalogue'],
    ['requests', '/en/requests'],
    ['notifications', '/en/notifications'],
    ['settings-account', '/en/account'],
    ['settings-security', '/en/account?section=security'],
    ['business-360', `/en/orgs/${orgId}/business/360`],
    ['onboarding-registration', `/en/orgs/${orgId}/business/onboarding?step=2`],
    ['onboarding-representative', `/en/orgs/${orgId}/business/onboarding?step=4`],
  ];
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: w < 500 ? 844 : w >= 1920 ? 1080 : 900 });
    for (const [name, url] of screens) {
      await page.goto(url);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await page.screenshot({ path: path.join(out, `${name}-${w}.png`), fullPage: false });
    }
  }
});

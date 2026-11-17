import { expect, test, type Page } from '@playwright/test';
import { uniqEmail, strongPassword } from './support/db';
import { confirmEmailUi, createOrgUi } from './support/ui';
import { confirmLink, waitForMail } from './support/mail';
import { msg } from './support/i18n';

// List-your-business intent, the one signed-in shell, the real Home and the "tell us about you first" gate.
const t = (k: string, v: Record<string, string> = {}) => msg('en', k, v);

async function signUpWithIntent(page: Page): Promise<{ email: string; password: string }> {
  const email = uniqEmail('intent');
  const password = strongPassword();
  await page.goto('/en/list-your-business');
  await expect(page).toHaveURL(/\/en\/signup\?intent=sell$/);
  await page.locator('#displayName').fill('Intent Tester');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#acceptTerms').check();
  await page.locator('#acceptPrivacy').check();
  await page.locator('main form button[type=submit]').click();
  await expect(page).toHaveURL(/\/signup\/check-email$/);
  return { email, password };
}

test.describe('List your business keeps the seller intent', () => {
  test('guest: sign-up, confirm the email, land in business onboarding (no second account, no extra step)', async ({ page }) => {
    const u = await signUpWithIntent(page);
    const mail = await waitForMail(u.email, { match: /\/auth\/callback\?/ });
    await page.goto(confirmLink(mail));
    await expect(page).toHaveURL(/\/en\/orgs\/new\?purpose=sell$/);
    await expect(page.locator('#type-business')).toBeChecked();
  });

  test('signed in without a business: the button goes straight to business registration', async ({ page }) => {
    const u = await signUpWithIntent(page);
    await confirmEmailUi(page, u.email); // lands in onboarding from the intent
    await page.goto('/en');
    await page.goto('/en/list-your-business');
    await expect(page).toHaveURL(/\/en\/orgs\/new\?purpose=sell$/);
    await expect(page).not.toHaveURL(/signup/);
  });

  test('signed in with a business: the button opens their organisations, not account creation', async ({ page }) => {
    const u = await signUpWithIntent(page);
    await confirmEmailUi(page, u.email);
    await createOrgUi(page, 'business', 'Intent Kedai', 'en');
    await page.goto('/en/list-your-business');
    await expect(page).toHaveURL(/\/en\/orgs$/);
    await expect(page.locator('ul.card-list').getByText('Intent Kedai').first()).toBeVisible();
  });

  test('the header and home buttons point at the same entry, and a plain visitor still gets the generic sign-up', async ({ page }) => {
    await page.goto('/en');
    expect(await page.locator('a[href$="/list-your-business"]').count()).toBeGreaterThan(0);
    await page.goto('/en/signup');
    await expect(page.locator('input[name=intent]')).toHaveCount(0);
    await page.goto('/en/signup?intent=evil');
    await expect(page.locator('input[name=intent]')).toHaveCount(0); // only "sell" is ever carried
  });
});

test.describe('One shell, a real Home, and the details gate', () => {
  test('Home is a hub inside the shell; the sidebar stays on news, directory, assistance and Home returns', async ({ page }, info) => {
    const mobile = info.project.name === 'mobile';
    const u = await signUpWithIntent(page);
    await confirmEmailUi(page, u.email);
    const side = page.locator('aside.ws-side');
    const openMenu = async () => { if (mobile) await page.getByRole('button', { name: t('ws.openMenu') }).click(); };

    await page.goto('/en');
    await expect(page.getByRole('heading', { level: 1, name: /Intent Tester/ })).toBeVisible();
    for (const k of ['actionsTitle', 'newsTitle', 'govTitle', 'marketTitle', 'activityTitle']) {
      await expect(page.getByRole('heading', { level: 2, name: t(`apphome.${k}`) })).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: t('apphome.startTitle') })).toBeVisible(); // no organisation yet: the invitation to fill in details

    for (const path of ['/en/news', '/en/directory', '/en/business-help', '/en/catalogue', '/en/sourcing' ]) {
      await page.goto(path);
      await expect(side, `${path} keeps the sidebar`).toHaveCount(1);
      await openMenu();
      await expect(side.getByRole('link', { name: t('ws.menu.home'), exact: true })).toBeVisible();
      await side.getByRole('link', { name: t('ws.menu.home'), exact: true }).click();
      await expect(page).toHaveURL(/\/en$/);
      await expect(page.getByRole('heading', { level: 1, name: /Hello/ })).toBeVisible();
    }
  });

  test('without details a person can look around, but action pages ask for details first (skippable, not bypassable)', async ({ page }) => {
    const u = await signUpWithIntent(page);
    await confirmEmailUi(page, u.email);
    for (const path of ['/en/requests/new', '/en/enquiries', '/en/sourcing/new', '/en/requests']) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/en\/orgs\?required=1$/);
      await expect(page.getByText(t('orgs.requiredNote'))).toBeVisible();
    }
    for (const path of ['/en/directory', '/en/news', '/en/business-help']) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path}$`)); // browsing is open
    }
  });

  test('every sidebar link for a business owner opens a real page (no 404, no blank, shell kept)', async ({ page }) => {
    const u = await signUpWithIntent(page);
    await confirmEmailUi(page, u.email);
    await createOrgUi(page, 'business', 'Menu Kedai', 'en');
    await page.goto('/en');
    const hrefs = await page.locator('aside.ws-side a[href^="/"]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('href') ?? ''))]);
    expect(hrefs.length).toBeGreaterThan(10);
    for (const h of hrefs) {
      const res = await page.goto(h);
      expect(res?.status(), h).toBeLessThan(400);
      // The setup wizard is the one deliberate exception: it has its own focused header with Save and exit.
      if (!h.includes('/business/onboarding')) await expect(page.locator('aside.ws-side'), h).toHaveCount(1);
      await expect(page.getByText(t('notFound.title')), h).toHaveCount(0);
    }
  });
});

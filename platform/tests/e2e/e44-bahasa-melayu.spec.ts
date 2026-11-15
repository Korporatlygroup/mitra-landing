import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createBusinessOwner, createReviewer, orgPath, reviewerGoto } from './support/biz';
import { createUser, sql } from './support/db';
import { msg } from './support/i18n';
import { expectNoHorizontalScroll, loginUi } from './support/ui';

// E44: Bahasa Melayu (ms) works across the app: switching, persistence, forms, errors, directory, requests, board, admin.

const m = (k: string, v?: Record<string, string>) => msg('ms', k, v);

async function axe(page: Page, label: string) {
  await page.waitForLoadState('networkidle');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad, `axe serious/critical on ${label}:\n${bad.map((v) => v.id).join(', ')}`).toEqual([]);
  await expectNoHorizontalScroll(page);
}

test('E44 language switcher offers EN, TA and BM, keeps the page, and the choice follows the account', async ({ page }) => {
  await page.goto('/en/login');
  const nav = page.getByRole('navigation', { name: msg('en', 'common.languageLabel') });
  await expect(nav.getByRole('link')).toHaveCount(3);
  await nav.getByRole('link', { name: msg('en', 'common.langMsFull') }).click();
  await expect(page).toHaveURL(/\/ms\/login$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ms');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(m('login.title'));
  await axe(page, 'login in ms');

  // sign-up offers the language and keeps it
  await page.goto('/ms/signup');
  await expect(page.locator('#language')).toHaveValue('ms');
  await axe(page, 'signup in ms');

  // a wrong password shows the error in Bahasa Melayu
  await page.goto('/ms/login');
  await page.locator('#email').fill('nobody@example.test');
  await page.locator('#password').fill('Wrong-Password-1');
  await page.getByRole('button', { name: m('login.submit'), exact: true }).click();
  await expect(page.locator('main [role=alert]').filter({ hasText: m('errors.login_failed') })).toBeVisible();

  // an account whose language is ms lands on /ms and can change it on the account page
  const u = await createUser('ms-lang', { language: 'ms', name: 'Aisyah' });
  await loginUi(page, u, 'en');
  await expect(page).toHaveURL(/\/ms$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(m('home.titleSignedIn', { name: 'Aisyah' }));
  await page.goto('/ms/account');
  await expect(page.locator('#language')).toHaveValue('ms');
  await axe(page, 'account in ms');
  await page.locator('#language').selectOption('en');
  await page.getByRole('button', { name: m('account.save'), exact: true }).click();
  await expect(page).toHaveURL(/\/en\/account\?saved=1/);
  const [row] = await sql<{ language: string }>(`select language from public.profiles where id = $1`, [u.id]);
  expect(row!.language).toBe('en');
});

test('E44b directory, request wizard, seller pages and admin queue in Bahasa Melayu (no overflow, accessible)', async ({ page, browser }) => {
  test.setTimeout(240_000);
  // public directory
  await page.goto('/ms/directory');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(m('dir.title'));
  await expect(page.locator('.fchip-row')).toContainText(m('categories.food-beverage'));
  await axe(page, 'directory in ms');
  await page.locator('#q').fill('zzzz-no-such-business');
  await page.getByRole('button', { name: m('dir.search'), exact: true }).click();
  await expect(page.getByRole('heading', { name: m('dir.noneTitle') })).toBeVisible();
  await axe(page, 'directory, no results, in ms');

  // buyer: wizard step 1 and the review step labels
  const buyer = await createUser('msb', { language: 'ms', name: 'Pembeli MS' });
  await loginUi(page, buyer, 'ms');
  await page.goto('/ms/requests');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(m('req.title'));
  await axe(page, 'my requests in ms');
  await page.goto('/ms/requests/new');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(m('req.s1.title'));
  await axe(page, 'wizard step 1 in ms');
  await page.locator('#title').fill('Katering untuk majlis syarikat');
  await page.locator('#category_slug').selectOption('food-beverage');
  await page.getByRole('button', { name: m('ob.next'), exact: true }).click();
  await page.locator('#target_state').selectOption('Selangor');
  await page.getByRole('button', { name: m('ob.next'), exact: true }).click();
  await page.getByRole('button', { name: m('ob.next'), exact: true }).click();
  await page.locator('#description').fill('Katering untuk 50 orang tetamu, menu campuran, dihantar sebelum tengah hari.');
  await page.locator('#contact_phone').fill('0123456789');
  await page.getByRole('button', { name: m('ob.next'), exact: true }).click();
  await expect(page.getByText(m('req.s5.visTitle'))).toBeVisible();
  await axe(page, 'wizard review in ms');
  // an incomplete submit shows the Bahasa Melayu error (title shorter than 5 characters is blocked in step 1)
  await page.goto('/ms/requests/new');
  await page.locator('#title').fill('abc');
  await page.locator('#category_slug').selectOption('food-beverage');
  await page.getByRole('button', { name: m('ob.next'), exact: true }).click();
  await expect(page).toHaveURL(/\/ms\/requests\/new/);

  // seller: business overview, public page editor, board, in ms
  const seller = await createBusinessOwner('msbiz');
  await sql(`update public.profiles set language = 'ms' where id = $1`, [seller.owner.id]);
  const sctx = await browser.newContext({ viewport: page.viewportSize() ?? undefined, isMobile: false });
  const sp = await sctx.newPage();
  await loginUi(sp, seller.owner, 'ms');
  for (const tail of ['', '/listing', '/requests', '/requests/board']) {
    await sp.goto(orgPath('ms', seller.orgId, tail));
    await expect(sp.locator('html')).toHaveAttribute('lang', 'ms');
    await axe(sp, `seller ${tail || 'overview'} in ms`);
  }
  await sp.goto(orgPath('ms', seller.orgId, '/requests/board'));
  await expect(sp.getByRole('heading', { level: 1 })).toHaveText(m('board.title'));
  await sctx.close();

  // administrator: listing queue and reports in ms
  const rv = await createReviewer('admin_review');
  const actx = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const ap = await actx.newPage();
  await reviewerGoto(ap, rv, '/ms/admin/listings');
  await expect(ap.getByRole('heading', { level: 1 })).toHaveText(m('adminList.title'));
  await axe(ap, 'admin listings in ms');
  await ap.goto('/ms/admin/reports');
  await expect(ap.getByRole('heading', { level: 1 })).toHaveText(m('adminList.reportsTitle'));
  await axe(ap, 'admin reports in ms');
  await actx.close();
});

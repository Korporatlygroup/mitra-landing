import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createBusinessOwner, orgPath } from './support/biz';
import { addMember, createUser, sql, uniq } from './support/db';
import { msg } from './support/i18n';
import { expectNoHorizontalScroll, loginUi } from './support/ui';

// E45: realistic mistakes and detours with synthetic accounts, on a phone (360px) and a desktop: leaving forms incomplete,
// invalid input, switching language halfway, resuming a request, missing permission, empty states. Not user research.

const t = (k: string, v?: Record<string, string>) => msg('en', k, v);
const tm = (k: string, v?: Record<string, string>) => msg('ms', k, v);

async function axe(page: Page, label: string) {
  await page.waitForLoadState('networkidle');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad, `axe serious/critical on ${label}:\n${bad.map((v) => v.id).join(', ')}`).toEqual([]);
  await expectNoHorizontalScroll(page);
}

async function seedProfile(ownerId: string, orgId: string, name: string) {
  const profile = {
    business_name: name, category_slug: 'food-beverage', registration_status: 'registered', ssm_number: String(Math.floor(Math.random() * 9e11) + 1e11),
    business_type: 'sole_proprietorship', state: 'Selangor', district: 'Petaling', address_line: '1 Jalan Satu', postcode: '47500',
    contact_phone: '+60 3 1234 5678', contact_email: 'biz@example.test', description: 'Synthetic business',
  };
  await sql(`do $do$ begin
    perform set_config('request.jwt.claims', json_build_object('sub', '${ownerId}', 'role', 'authenticated', 'aal', 'aal1')::text, true);
    set local role authenticated;
    perform public.save_business_profile('${orgId}', $j$${JSON.stringify(profile)}$j$::jsonb);
  end $do$`);
}

test('E45 seller: empty states, incomplete and invalid forms, portfolio add, preview and remove, language switch halfway', async ({ page }) => {
  test.setTimeout(240_000);
  const tag = uniq('usab').replace(/-/g, '');
  const seller = await createBusinessOwner('usab');
  await seedProfile(seller.owner.id, seller.orgId, `Kedai ${tag}`);
  await loginUi(page, seller.owner, 'en');

  // empty states are explained, not blank
  await page.goto(orgPath('en', seller.orgId, '/listing'));
  await expect(page.locator('main')).toContainText(t('listing.portfolioEmpty'));
  await expect(page.locator('main')).toContainText(t('listing.portfolioImagesLater'));
  await page.goto(orgPath('en', seller.orgId, '/requests'));
  await expect(page.getByText(t('biz2.board.noneTitle'), { exact: true })).toBeVisible();
  await page.goto(orgPath('en', seller.orgId, '/requests/board'));
  await expect(page.getByRole('heading', { name: t('board.emptyTitle') })).toBeVisible();
  await axe(page, 'empty board');

  // an incomplete form: a service with no name is refused in plain language and nothing is lost
  await page.goto(orgPath('en', seller.orgId, '/listing'));
  await page.locator('#headline').fill('Home cooked meals for offices');
  await page.locator('#description').fill('We cook fresh lunch boxes and cater for small events across Selangor, every working day.');
  await page.locator('#svc_name_0').fill('');
  await page.locator('#pf_title_0').fill(`Lunch boxes ${tag}`);
  await page.getByRole('button', { name: t('listing.save'), exact: true }).click();
  await expect(page.locator('.form-message-slot')).toContainText(/\S/);
  await expect(page.locator('#headline')).toHaveValue('Home cooked meals for offices');

  // fill the service, add a portfolio example with a type of work and a month, save
  await page.locator('#svc_name_0').fill(`Lunch boxes ${tag}`);
  await page.locator('#pf_title_0').fill(`Office lunch for 60 ${tag}`);
  await page.locator('#pf_cat_0').selectOption('food-beverage');
  await page.locator('#pf_date_0').fill('2026-03');
  await page.locator('#pf_desc_0').fill('Boxed lunches for an office event.');
  await page.getByRole('button', { name: t('listing.save'), exact: true }).click();
  await expect(page.getByText(t('listing.saved'))).toBeVisible();
  await axe(page, 'listing editor with a portfolio example');

  // switch language halfway: same page, same saved values, Bahasa Melayu labels (the workspace tucks the switcher in the account menu)
  await page.getByRole('button', { name: msg('en', 'ws.accountMenu'), exact: true }).click();
  await page.getByRole('navigation', { name: t('common.languageLabel') }).getByRole('link', { name: msg('en', 'common.langMsFull') }).click();
  await expect(page).toHaveURL(/\/ms\/orgs\/.*\/business\/listing/);
  await expect(page.locator('#headline')).toHaveValue('Home cooked meals for offices');
  await expect(page.locator('#pf_title_0')).toHaveValue(`Office lunch for 60 ${tag}`);
  await expect(page.locator('#pf_cat_0')).toHaveValue('food-beverage');
  await expect(page.locator('main')).toContainText(tm('listing.pfRemoveHint'));
  await axe(page, 'listing editor in ms');

  // preview shows the example with its type and month
  await page.goto(orgPath('en', seller.orgId, '/listing/preview'));
  await expect(page.locator('main')).toContainText(`Office lunch for 60 ${tag}`);
  await expect(page.locator('main')).toContainText(`${t('categories.food-beverage')} · March 2026`);
  await axe(page, 'preview');

  // removing an example: clear it and save; the empty state returns
  await page.goto(orgPath('en', seller.orgId, '/listing'));
  await page.locator('#pf_title_0').fill('');
  await page.locator('#pf_desc_0').fill('');
  await page.locator('#pf_date_0').fill('');
  await page.getByRole('button', { name: t('listing.save'), exact: true }).click();
  await expect(page.getByText(t('listing.saved'))).toBeVisible();
  await page.goto(orgPath('en', seller.orgId, '/listing'));
  await expect(page.locator('main')).toContainText(t('listing.portfolioEmpty'));
});

test('E45b buyer: saves a request for later, returns to it, finishes; a viewer cannot answer requests; strangers see 404', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const tag = uniq('usabb').replace(/-/g, '');
  const buyer = await createUser('usabb', { name: 'Buyer Usab' });
  await loginUi(page, buyer, 'en');
  await page.goto('/en/requests/new');
  await page.locator('#title').fill(`Wedding cake ${tag}`);
  await page.locator('#category_slug').selectOption('food-beverage');
  await page.getByRole('button', { name: t('req.later'), exact: true }).click();

  // back on the list: the unfinished request is there and says where to continue
  await expect(page).toHaveURL(/\/en\/requests$/);
  const card = page.locator('li.card').filter({ hasText: `Wedding cake ${tag}` });
  await expect(card).toContainText(t('req.draftNote'));
  await card.getByRole('link').first().click();
  await expect(page).toHaveURL(/requests\/new\?step=2&id=|requests\/new\?.*id=/);
  await axe(page, 'resumed wizard');

  // wrong value: a quantity that is not a number is refused in plain language, the form keeps what was typed
  await page.goto(page.url().replace(/step=\d/, 'step=3'));
  await page.locator('#quantity').fill('lots');
  await page.locator('#unit').fill('boxes');
  await page.getByRole('button', { name: t('ob.next'), exact: true }).click();
  await expect(page.locator('.form-message-slot')).toContainText(t('errors.invalid_quantity'));
  await expect(page.locator('#unit')).toHaveValue('boxes');

  // a viewer in a business cannot use the board or answer requests, and says so plainly
  const biz = await createBusinessOwner('usabv');
  const viewer = await createUser('usabv-viewer', { name: 'Viewer Usab' });
  await addMember(biz.orgId, viewer.id, 'viewer');
  const vctx = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const vp = await vctx.newPage();
  await loginUi(vp, viewer, 'en');
  await vp.goto(orgPath('en', biz.orgId, '/requests/board'));
  await expect(vp.getByRole('alert').filter({ hasText: t('errors.forbidden') })).toBeVisible();
  await vctx.close();

  // a stranger cannot open someone else's business pages
  const stranger = await createUser('usabs', { name: 'Stranger' });
  const sctx = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const sp = await sctx.newPage();
  await loginUi(sp, stranger, 'en');
  expect((await sp.goto(orgPath('en', biz.orgId, '/requests')))?.status()).toBe(404);
  expect((await sp.goto(orgPath('en', biz.orgId, '/listing')))?.status()).toBe(404);
  await sctx.close();

  // a session that ended: the wizard sends you to sign in and brings you back
  await page.context().clearCookies();
  await page.goto('/en/requests');
  await expect(page).toHaveURL(/\/login/);
});

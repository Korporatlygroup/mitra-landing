import { expect, test, type Page } from '@playwright/test';
import { createBusinessOwner, fillStep1, fillStep2, fillStep3, fillStep4, gotoStep, orgPath } from './support/biz';
import { sql } from './support/db';
import { msg } from './support/i18n';
import { loginUi } from './support/ui';

const t = (k: string, v?: Record<string, string>) => msg('en', k, v);
const alertWith = (page: Page, text: string) => page.locator('main [role=alert]').filter({ hasText: text });
const noNative = (page: Page) => page.evaluate(() => ((document.querySelector('main form') as HTMLFormElement).noValidate = true));
const next = (page: Page) => page.getByRole('button', { name: t('ob.next'), exact: true });
const later = (page: Page) => page.getByRole('button', { name: t('ob.later'), exact: true });

// E22: server-side validation of the onboarding forms (native checks bypassed), values kept, errors announced.
test('E22 step 1: empty name and missing category are refused, typed values are kept', async ({ page }) => {
  const { owner, orgId } = await createBusinessOwner('e22a');
  await loginUi(page, owner);

  await gotoStep(page, 'en', orgId, 1);
  await noNative(page);
  await page.locator('#business_name').fill('');
  await page.locator('#reg-yes').check();
  await next(page).click();
  await expect(alertWith(page, t('errors.invalid_name'))).toBeVisible();
  await expect(page.locator('#reg-yes')).toBeChecked();
  await expect(page).toHaveURL(/step=1$/);

  // Name given, category missing (mandatory).
  await page.locator('#business_name').fill('Kedai Kopi Ali');
  await next(page).click();
  await expect(alertWith(page, t('errors.category_required'))).toBeVisible();
  await expect(page.locator('#business_name')).toHaveValue('Kedai Kopi Ali');
  await expect(page.locator('#reg-yes')).toBeChecked();
  expect(await sql(`select 1 from public.business_profiles where org_id = $1`, [orgId])).toHaveLength(0);

  // Missing the registered question.
  await page.locator('#category_slug').selectOption('retail-shop');
  await page.locator('#reg-yes').evaluate((el: HTMLInputElement) => (el.checked = false));
  await next(page).click();
  await expect(page.locator('main [role=alert]').filter({ hasText: /./ })).toBeVisible();
  await expect(page.locator('#business_name')).toHaveValue('Kedai Kopi Ali');
});

test('E22 step 2: bad SSM numbers are refused; both valid formats are accepted', async ({ page }) => {
  const { owner, orgId } = await createBusinessOwner('e22b');
  await loginUi(page, owner);
  await gotoStep(page, 'en', orgId, 1);
  await fillStep1(page, 'en', { name: 'Ssm Test', category: 'retail-shop', registered: true });
  await next(page).click();
  await expect(page).toHaveURL(/step=2$/);

  for (const bad of ['123', 'ABCDEFGHIJKL', '12345678-A', '2020010123456', 'no number']) {
    await page.goto(page.url()); // fresh page each round: an earlier round's late response must not overwrite what is typed now
    await page.waitForLoadState('networkidle');
    await noNative(page);
    await fillStep2(page, { ssm: bad, businessType: 'sdn_bhd' });
    await next(page).click();
    await page.waitForLoadState('networkidle');
    await expect(alertWith(page, t('errors.invalid_ssm')), `"${bad}" is refused`).toBeVisible();
    await expect(page.locator('#ssm_number')).toHaveValue(bad);
    await expect(page.locator('#business_type')).toHaveValue('sdn_bhd');
    await expect(page).toHaveURL(/step=2$/);
  }
  await fillStep2(page, { ssm: '1234567-A', businessType: 'partnership' });
  await next(page).click();
  await expect(page).toHaveURL(/step=3$/);
  expect((await sql(`select ssm_number from public.business_profiles where org_id = $1`, [orgId]))[0]!.ssm_number).toBe('1234567-A');
  await gotoStep(page, 'en', orgId, 2);
  await fillStep2(page, { ssm: '202001012345' });
  await next(page).click();
  await expect(page).toHaveURL(/step=3$/);
});

test('E22 step 3: missing state, bad postcode; typed values kept', async ({ page }) => {
  const { owner, orgId } = await createBusinessOwner('e22c');
  await loginUi(page, owner);
  await gotoStep(page, 'en', orgId, 1);
  await fillStep1(page, 'en', { name: 'Place Test', category: 'retail-shop', registered: false });
  await next(page).click();
  await expect(page).toHaveURL(/step=3$/);

  await noNative(page);
  await fillStep3(page, { district: 'Klang', address: '3 Jalan Satu', postcode: '47301' });
  await next(page).click();
  await expect(alertWith(page, t('errors.invalid_state'))).toBeVisible();
  await expect(page.locator('#district')).toHaveValue('Klang');
  await expect(page.locator('#address_line')).toHaveValue('3 Jalan Satu');

  for (const bad of ['1234', '12ab5', 'abcde', '12 45']) {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400); // the previous round's response must be applied before typing again
    await fillStep3(page, { state: 'Selangor', postcode: bad });
    await next(page).click();
    await page.waitForLoadState('networkidle');
    await expect(alertWith(page, t('errors.invalid_postcode')), `postcode "${bad}"`).toBeVisible();
    await expect(page.locator('#postcode')).toHaveValue(bad);
    await expect(page.locator('#state')).toHaveValue('Selangor');
    await expect(page.locator('#district')).toHaveValue('Klang');
  }
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
  await fillStep3(page, { postcode: '47301' });
  await next(page).click();
  await expect(page).toHaveURL(/step=4$/);
});

test('E22 step 4: empty name and bad phone are refused', async ({ page }) => {
  const { owner, orgId } = await createBusinessOwner('e22d');
  await loginUi(page, owner);
  await gotoStep(page, 'en', orgId, 1);
  await fillStep1(page, 'en', { name: 'Rep Test', category: 'retail-shop', registered: false });
  await next(page).click();
  await fillStep3(page, { state: 'Johor' });
  await next(page).click();
  await expect(page).toHaveURL(/step=4$/);

  await noNative(page);
  await page.locator('#rep_name').fill('');
  await page.locator('#rep_phone').fill('012-3456789');
  await next(page).click();
  await expect(alertWith(page, t('errors.invalid_name'))).toBeVisible();
  await expect(page.locator('#rep_phone')).toHaveValue('012-3456789');

  await fillStep4(page, { repName: 'Aminah' });
  await page.locator('#rep_phone').fill('not a phone');
  await next(page).click();
  await expect(alertWith(page, t('errors.invalid_phone'))).toBeVisible();
  await expect(page.locator('#rep_name')).toHaveValue('Aminah');
});

test('E22 "Save and finish later" works at every step and the data is kept', async ({ page }) => {
  const { owner, orgId } = await createBusinessOwner('e22e');
  await loginUi(page, owner);
  const overview = new RegExp(`/orgs/${orgId}/business$`);

  await gotoStep(page, 'en', orgId, 1);
  await fillStep1(page, 'en', { name: 'Later Co', category: 'agriculture', registered: true });
  await later(page).click();
  await expect(page).toHaveURL(overview);

  await gotoStep(page, 'en', orgId, 2);
  await fillStep2(page, { ssm: '202001012345', businessType: 'llp' });
  await later(page).click();
  await expect(page).toHaveURL(overview);

  await gotoStep(page, 'en', orgId, 3);
  await fillStep3(page, { state: 'Kedah', district: 'Alor Setar', address: '9 Jalan Nanti', postcode: '05100' });
  await later(page).click();
  await expect(page).toHaveURL(overview);

  await gotoStep(page, 'en', orgId, 4);
  await fillStep4(page, { repName: 'Tan Wei', repRole: 'partner' });
  await later(page).click();
  await expect(page).toHaveURL(overview);

  const p = (await sql(`select business_name, ssm_number, business_type, state, district from public.business_profiles where org_id = $1`, [orgId]))[0];
  expect(p).toMatchObject({ business_name: 'Later Co', ssm_number: '202001012345', business_type: 'llp', state: 'Kedah', district: 'Alor Setar' });
  expect((await sql(`select address_line, postcode from public.business_private where org_id = $1`, [orgId]))[0]).toMatchObject({ address_line: '9 Jalan Nanti', postcode: '05100' });
  expect((await sql(`select full_name, role_title from public.business_representatives where org_id = $1`, [orgId]))[0]).toMatchObject({ full_name: 'Tan Wei', role_title: 'partner' });

  // Coming back shows the saved values.
  await gotoStep(page, 'en', orgId, 3);
  await expect(page.locator('#address_line')).toHaveValue('9 Jalan Nanti');
  await expect(page.locator('#postcode')).toHaveValue('05100');
  await page.goto(orgPath('en', orgId));
  await expect(page.locator('main')).toContainText(t('biz.next.documents'));

  // Invalid data is still refused when saving for later.
  await gotoStep(page, 'en', orgId, 3);
  await noNative(page);
  await page.locator('#postcode').fill('99');
  await later(page).click();
  await expect(alertWith(page, t('errors.invalid_postcode'))).toBeVisible();
  await expect(page).toHaveURL(/step=3$/);
});

test('E22 later steps are not reachable before the business profile exists', async ({ page }) => {
  const { owner, orgId } = await createBusinessOwner('e22f');
  await loginUi(page, owner);
  for (const step of [2, 3, 4, 5]) {
    await gotoStep(page, 'en', orgId, step);
    await expect(page).toHaveURL(/step=1$/);
  }
});

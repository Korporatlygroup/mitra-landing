import { expect, test } from '@playwright/test';
import { claimOf, clickSend, createBusinessOwner, docsOf, fillStep1, fillStep2, fillStep3, fillStep4, gotoStep, orgPath, smallPdf, submitClaimUi, uploadDoc } from './support/biz';
import { msg } from './support/i18n';
import { expectNoHorizontalScroll, loginUi } from './support/ui';

const t = (k: string, v?: Record<string, string>) => msg('en', k, v);

// E20: a registered business goes through all five steps and sends three claims for review.
test('E20 registered business: steps 1 to 5, upload, send all three claims', async ({ page }) => {
  test.setTimeout(180_000);
  const { owner, orgId, orgName } = await createBusinessOwner('e20');
  await loginUi(page, owner);

  // Overview before anything is done.
  await page.goto(orgPath('en', orgId));
  await expect(page.locator('.org-btn')).toContainText(orgName);
  await expect(page.locator('main')).toContainText(t('biz.unverified'));
  await expect(page.locator('main')).toContainText(t('biz.notStarted'));

  // Step 1
  await gotoStep(page, 'en', orgId, 1);
  await expect(page.locator('main')).toContainText(t('ob.stepOf', { n: '1', total: '5' }));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('ob.s1.title'));
  await expect(page.locator('#category_slug option').first()).toHaveText(t('ob.s1.categoryChoose'));
  await fillStep1(page, 'en', { name: orgName, category: 'food-beverage', registered: true });
  await page.getByRole('button', { name: t('ob.next'), exact: true }).click();

  // Step 2 (registered only)
  await expect(page).toHaveURL(/step=2$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('ob.s2.title'));
  await expect(page.locator('main')).toContainText(t('ob.stepOf', { n: '2', total: '5' }));
  await fillStep2(page, { ssm: '202001012345', businessType: 'sdn_bhd' });
  await page.getByRole('button', { name: t('ob.next'), exact: true }).click();

  // Step 3
  await expect(page).toHaveURL(/step=3$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('ob.s3.title'));
  await expect(page.locator('main')).toContainText(t('ob.s3.privacy'));
  await fillStep3(page, { state: 'Selangor', district: 'Petaling', address: '12 Jalan Rahsia Satu', postcode: '47301' });
  await page.getByRole('button', { name: t('ob.next'), exact: true }).click();

  // Step 4
  await expect(page).toHaveURL(/step=4$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('ob.s4.title'));
  await expect(page.locator('main')).toContainText(t('ob.s4.note'));
  await fillStep4(page, { repName: 'Siti Authorised', repRole: 'director' });
  await page.getByRole('button', { name: t('ob.next'), exact: true }).click();

  // Step 5: three claim sections, each with its own upload and send controls.
  await expect(page).toHaveURL(/step=5$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('ob.s5.title'));
  for (const ct of ['business_registration', 'business_location', 'representative_authority'] as const) {
    await expect(page.getByRole('heading', { level: 3, name: new RegExp(t(`claimTypes.${ct}`)) })).toBeVisible();
  }
  await expectNoHorizontalScroll(page);

  for (const ct of ['business_registration', 'business_location', 'representative_authority'] as const) {
    await gotoStep(page, 'en', orgId, 5);
    const slot = await uploadDoc(page, 'en', ct, smallPdf(`e20-${ct}`));
    await expect(slot).toContainText(t('documents.received'));
    await expect(page.locator('main')).toContainText(t('documents.scanClean'));
    await clickSend(page, 'en', ct, { note: 'Number is on the first page.' });
    await expect(page).toHaveURL(/\/business\/verification\?sent=1$/);
    await expect(page.locator('main [role=status]').filter({ hasText: t('ver.sent') })).toBeVisible();
  }

  // Verification page and overview show the submitted state for all three.
  await page.goto(orgPath('en', orgId, '/verification'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('ver.title'));
  for (const ct of ['business_registration', 'business_location', 'representative_authority'] as const) {
    const heading = page.getByRole('heading', { level: 2, name: new RegExp(t(`claimTypes.${ct}`)) });
    await expect(heading).toContainText(t('claimStatus.submitted'));
  }
  await page.goto(orgPath('en', orgId));
  await expect(page.locator('li.card')).toHaveCount(3);
  for (const li of await page.locator('li.card').all()) await expect(li).toContainText(t('claimStatus.submitted'));
  await expect(page.locator('main')).toContainText(t('biz.next.wait'));
  await expectNoHorizontalScroll(page);

  // Database agrees.
  for (const ct of ['business_registration', 'business_location', 'representative_authority'] as const) {
    const c = await claimOf(orgId, ct);
    expect(c).toMatchObject({ status: 'submitted', version: 1 });
    const docs = await docsOf(orgId, ct);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.scan_status).toBe('clean');
  }

  // Preview: registered but nothing reviewed yet, never the private address.
  await page.goto(orgPath('en', orgId, '/preview'));
  await expect(page.locator('main')).toContainText(t('preview.registeredNote'));
  await expect(page.locator('main')).toContainText(t('preview.notReviewedYet'));
  await expect(page.locator('main')).toContainText(t('preview.unverified'));
  await expect(page.locator('main')).not.toContainText('Jalan Rahsia');
  await expect(page.locator('main')).not.toContainText('47301');
});

test('E20 helper flow reaches the same result (onboarding through submitClaimUi)', async ({ page }) => {
  const { owner, orgId } = await createBusinessOwner('e20b');
  await loginUi(page, owner);
  const { onboardUi } = await import('./support/biz');
  await onboardUi(page, 'en', orgId);
  await submitClaimUi(page, 'en', orgId, 'business_registration');
  await expect(page.getByRole('heading', { level: 2, name: new RegExp(t('claimTypes.business_registration')) })).toContainText(t('claimStatus.submitted'));
});

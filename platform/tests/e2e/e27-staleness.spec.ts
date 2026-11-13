import { expect, test } from '@playwright/test';
import { claimOf, createBusinessOwner, createReviewer, decideAs, eventsOf, fillStep1, fillStep3, gotoStep, onboardUi, orgPath, submitClaimUi } from './support/biz';
import { msg } from './support/i18n';
import { loginUi } from './support/ui';

const t = (k: string, v?: Record<string, string>) => msg('en', k, v);

// E27: after approval, changing the facts that were reviewed makes the claim stale and removes the reviewed status.
test('E27 changing the business name or location after approval makes the affected claims stale until resubmitted', async ({ page, browser }) => {
  test.setTimeout(300_000);
  const { owner, orgId, orgName } = await createBusinessOwner('e27');
  await loginUi(page, owner);
  await onboardUi(page, 'en', orgId, { name: orgName, registered: true });
  await submitClaimUi(page, 'en', orgId, 'business_registration');
  await submitClaimUi(page, 'en', orgId, 'business_location');
  const reg = (await claimOf(orgId, 'business_registration'))!;
  const loc = (await claimOf(orgId, 'business_location'))!;

  const rv = await createReviewer('admin_review');
  const rctx = await browser.newContext({ baseURL: page.url().split('/').slice(0, 3).join('/'), viewport: page.viewportSize() ?? undefined });
  const rp = await rctx.newPage();
  await decideAs(rp, rv, reg.id, 'approve', 'Registration documents match');
  await decideAs(rp, rv, loc.id, 'approve', 'Location documents match', { login: false });
  await rctx.close();
  expect((await claimOf(orgId, 'business_registration'))!.status).toBe('approved');
  expect((await claimOf(orgId, 'business_location'))!.status).toBe('approved');

  // Reviewed: overview chips and the preview line for both scopes.
  await page.goto(orgPath('en', orgId));
  await expect(page.locator('li.card', { hasText: t('claimTypes.business_registration') })).toContainText(t('claimStatus.approved'));
  await expect(page.locator('li.card', { hasText: t('claimTypes.business_location') })).toContainText(t('claimStatus.approved'));
  await page.goto(orgPath('en', orgId, '/preview'));
  await expect(page.locator('main')).toContainText(`for: ${t('claimScope.business_registration')}`);
  await expect(page.locator('main')).toContainText(`for: ${t('claimScope.business_location')}`);
  await expect(page.locator('main')).not.toContainText(t('preview.nothingReviewed'));

  // Rename the business: the registration claim goes stale, the location claim is unaffected.
  await gotoStep(page, 'en', orgId, 1);
  await fillStep1(page, 'en', { name: `${orgName} Baru` });
  await page.getByRole('button', { name: t('ob.later'), exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/orgs/${orgId}/business$`));
  expect((await claimOf(orgId, 'business_registration'))!.status).toBe('stale');
  expect((await claimOf(orgId, 'business_location'))!.status).toBe('approved');
  await expect(page.locator('li.card', { hasText: t('claimTypes.business_registration') })).toContainText(t('claimStatus.stale'));
  await expect(page.locator('li.card', { hasText: t('claimTypes.business_location') })).toContainText(t('claimStatus.approved'));
  await page.goto(orgPath('en', orgId, '/preview'));
  await expect(page.locator('main')).not.toContainText(`for: ${t('claimScope.business_registration')}`);
  await expect(page.locator('main')).toContainText(`for: ${t('claimScope.business_location')}`);

  // Change the location: now nothing is reviewed any more.
  await gotoStep(page, 'en', orgId, 3);
  await fillStep3(page, { district: 'Klang Baru' });
  await page.getByRole('button', { name: t('ob.later'), exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/orgs/${orgId}/business$`));
  expect((await claimOf(orgId, 'business_location'))!.status).toBe('stale');
  await page.goto(orgPath('en', orgId));
  await expect(page.locator('main')).toContainText(t('biz.unverified'));
  await page.goto(orgPath('en', orgId, '/preview'));
  await expect(page.locator('main')).toContainText(t('preview.unverified'));
  await expect(page.locator('main')).toContainText(t('preview.nothingReviewed'));
  await expect(page.locator('main')).not.toContainText('for: ');

  // The owner is told on the verification page, with the history, and can send again.
  await page.goto(orgPath('en', orgId, '/verification'));
  for (const ct of ['business_registration', 'business_location'] as const) {
    await expect(page.getByRole('heading', { level: 2, name: new RegExp(t(`claimTypes.${ct}`)) })).toContainText(t('claimStatus.stale'));
  }
  expect((await eventsOf(reg.id)).map((e) => e.event)).toContain('marked_stale');
  await expect(page.locator('ol.timeline').first()).toContainText(t('events.marked_stale'));

  await submitClaimUi(page, 'en', orgId, 'business_registration', { file: null, resubmit: true });
  expect(await claimOf(orgId, 'business_registration')).toMatchObject({ status: 'submitted', version: 2 });
  await page.goto(orgPath('en', orgId, '/verification'));
  await expect(page.getByRole('heading', { level: 2, name: new RegExp(t('claimTypes.business_registration')) })).toContainText(t('claimStatus.submitted'));
  // Still not reviewed until a reviewer decides again.
  await page.goto(orgPath('en', orgId, '/preview'));
  await expect(page.locator('main')).not.toContainText(`for: ${t('claimScope.business_registration')}`);
});

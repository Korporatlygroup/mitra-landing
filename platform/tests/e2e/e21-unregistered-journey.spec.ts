import { expect, test } from '@playwright/test';
import { claimOf, createBusinessOwner, fillStep1, fillStep3, fillStep4, gotoStep, orgPath, submitClaimUi } from './support/biz';
import { sql } from './support/db';
import { msg } from './support/i18n';
import { expectNoHorizontalScroll, loginUi, type Locale } from './support/ui';

// E21: a business that is not registered with SSM gets a limited profile, with no SSM step and no registration claim.
for (const locale of ['ta', 'en'] as const satisfies readonly Locale[]) {
  test(`E21 unregistered business journey in ${locale}`, async ({ page }) => {
    test.setTimeout(180_000);
    const t = (k: string, v?: Record<string, string>) => msg(locale, k, v);
    const { owner, orgId, orgName } = await createBusinessOwner(`e21-${locale}`);
    await loginUi(page, owner, locale);

    // Step 1: "not registered" skips step 2.
    await gotoStep(page, locale, orgId, 1);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('ob.s1.title'));
    await expect(page.locator('main')).toContainText(t('ob.stepOf', { n: '1', total: '5' }));
    await expect(page.locator('#category_slug option').first()).toHaveText(t('ob.s1.categoryChoose'));
    await expect(page.getByLabel(t('ob.s1.no'))).toBeVisible();
    await expectNoHorizontalScroll(page);
    await fillStep1(page, locale, { name: orgName, category: 'tailoring-apparel', registered: false });
    await page.getByRole('button', { name: t('ob.next'), exact: true }).click();
    await expect(page).toHaveURL(/step=3$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('ob.s3.title'));

    // Visiting step 2 as unregistered redirects to step 3.
    await gotoStep(page, locale, orgId, 2);
    await expect(page).toHaveURL(/step=3$/);

    // Step 3 and 4.
    await expect(page.locator('main')).toContainText(t('ob.s3.privacy'));
    await expectNoHorizontalScroll(page);
    await fillStep3(page, { state: 'Pulau Pinang', district: 'Georgetown', address: '7 Lorong Peribadi Dua', postcode: '10200' });
    await page.getByRole('button', { name: t('ob.next'), exact: true }).click();
    await expect(page).toHaveURL(/step=4$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('ob.s4.title'));
    await expect(page.locator('main')).toContainText(t('ob.s4.note'));
    await fillStep4(page, { repName: 'Kumar Pemilik', repRole: 'owner' });
    await page.getByRole('button', { name: t('ob.next'), exact: true }).click();

    // Step 5: only the location and authority claims; no registration claim anywhere.
    await expect(page).toHaveURL(/step=5$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('ob.s5.title'));
    await expect(page.getByRole('heading', { level: 3, name: new RegExp(t('claimTypes.business_location')) })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: new RegExp(t('claimTypes.representative_authority')) })).toBeVisible();
    await expect(page.getByRole('heading', { name: new RegExp(t('claimTypes.business_registration')) })).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    await submitClaimUi(page, locale, orgId, 'business_location');
    await submitClaimUi(page, locale, orgId, 'representative_authority');
    expect(await claimOf(orgId, 'business_registration')).toBeNull();

    // Overview: two claims, no registration item.
    await page.goto(orgPath(locale, orgId));
    await expect(page.locator('li.card')).toHaveCount(2);
    await expect(page.locator('main')).not.toContainText(t('claimTypes.business_registration'));
    await expect(page.locator('main')).toContainText(t('biz.unverified'));
    await expectNoHorizontalScroll(page);

    // Preview: limited, unverified, no street address or postcode, category and place only.
    await page.goto(orgPath(locale, orgId, '/preview'));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('preview.title'));
    await expect(page.locator('main')).toContainText(t('preview.unregistered'));
    await expect(page.locator('main')).toContainText(t('preview.unverified'));
    await expect(page.locator('main')).toContainText('Georgetown, Pulau Pinang');
    const html = await page.content();
    for (const secret of ['Lorong Peribadi', '10200']) {
      expect(await page.locator('main').innerText()).not.toContain(secret);
      expect(html).not.toContain(secret);
    }
    expect(await page.locator('main').innerText()).not.toContain(t('preview.registeredNote'));
    await expectNoHorizontalScroll(page);

    // The private details are stored, but only in the private table.
    const p = await sql(`select ssm_number, registration_status from public.business_profiles where org_id = $1`, [orgId]);
    expect(p[0]).toMatchObject({ ssm_number: null, registration_status: 'unregistered' });
  });
}

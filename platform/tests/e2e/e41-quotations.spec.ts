import { expect, test } from '@playwright/test';
import { createBusinessOwner } from './support/biz';
import { createOrgAs, createUser, signedClient, sql } from './support/db';
import { msg } from './support/i18n';
import { adminLogin, freshContext, loginUi, logoutUi } from './support/ui';

const t = (key: string) => msg('en', key);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test('E41 buyer and seller negotiate a quote, select the latest version and track the lead', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const seller = await createBusinessOwner('p4-seller');
  const buyer = await createUser('p4-buyer');
  const buyerOrg = await createOrgAs(buyer, 'buyer', 'Synthetic buyer org');
  const enquiryId = String((await sql<{ id: string }>(
    `insert into public.enquiries(buyer_org_id,seller_org_id,origin,topic,opened_by_org_id,created_by)
     values($1,$2,'listing','Synthetic uniforms needed',$1,$3) returning id`, [buyerOrg, seller.orgId, buyer.id],
  ))[0]!.id);
  const url = `/en/enquiries/${enquiryId}`;
  const reviewText = `The seller replied clearly and gave a useful quotation for ${enquiryId.slice(0,8)}.`;

  await loginUi(page, seller.owner, 'en');
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Synthetic uniforms needed');
  await page.locator('#reply-body').fill('We can make these uniforms.');
  await page.getByRole('button', { name: t('p4.sendReply') }).click();
  await expect(page.locator('main')).toContainText('We can make these uniforms.');

  await page.locator('#scope').fill('100 custom uniforms');
  await page.locator('#description1').fill('Uniforms');
  await page.locator('#quantity1').fill('100');
  await page.locator('#unit1').fill('pieces');
  await page.locator('#unitPrice1').fill('12.50');
  await page.locator('#validUntil').fill(inDays(7));
  await page.locator('#deliveryTiming').fill('Within three weeks');
  await page.locator('#taxTreatment').fill('Tax included as stated');
  await page.getByRole('button', { name: t('p4.saveDraft') }).click();
  await expect(page.locator('main')).toContainText('MYR 1250.00');
  await page.getByRole('button', { name: t('p4.sendQuote') }).click();
  await expect(page.locator('main')).toContainText('100 custom uniforms');

  const buyerContext = await freshContext(browser, page);
  const bp = await buyerContext.newPage();
  await loginUi(bp, buyer, 'en');
  await bp.goto(url);
  await expect(bp.locator('main')).toContainText('MYR 1250.00');
  await bp.locator('#revision-reason').fill('Please include 10 extra shirts.');
  await bp.getByRole('button', { name: t('p4.requestChange') }).click();
  await expect(bp.locator('main')).toContainText('Please include 10 extra shirts.');

  await page.reload();
  await page.locator('#scope').fill('110 custom uniforms and shirts');
  await page.locator('#description1').fill('Uniforms and shirts');
  await page.locator('#quantity1').fill('110');
  await page.locator('#unit1').fill('pieces');
  await page.locator('#unitPrice1').fill('12.50');
  await page.locator('#validUntil').fill(inDays(7));
  await page.locator('#deliveryTiming').fill('Within three weeks');
  await page.locator('#taxTreatment').fill('Tax included as stated');
  await page.getByRole('button', { name: t('p4.saveDraft') }).click();
  await page.getByRole('button', { name: t('p4.sendQuote') }).click();
  await expect(page.locator('main')).toContainText('MYR 1375.00');
  await expect.poll(async () => (await sql<{ status: string }>('select status from public.quotations where enquiry_id=$1', [enquiryId]))[0]?.status).toBe('sent');

  await bp.reload();
  await expect(bp.getByText('Version 2')).toBeVisible();
  await expect(bp.getByText('MYR 1375.00').first()).toBeVisible();
  await bp.getByRole('button', { name: t('p4.accept') }).click();
  await expect(bp.getByText(t('p4.selectedNotice'))).toBeVisible();
  const quote = (await sql<{ status: string; accepted_version_id: string; current_version_id: string }>(
    `select status,accepted_version_id,current_version_id from public.quotations where enquiry_id=$1`, [enquiryId],
  ))[0]!;
  expect(quote.status).toBe('accepted');
  expect(quote.accepted_version_id).toBe(quote.current_version_id);

  await page.goto(`/en/orgs/${seller.orgId}/business/leads`);
  await expect(page.locator('main')).toContainText(t('p4.leadsTitle'));
  await page.goto(url);
  await page.locator('#stage').selectOption('reported_won');
  await page.locator('#lead-note').fill('Customer selected the offer; payment is not recorded.');
  await page.getByRole('button', { name: t('p4.saveLead') }).click();
  await expect(page.locator('main')).toContainText('Customer selected the offer');

  await bp.reload();
  await expect(bp.locator('main')).not.toContainText('Customer selected the offer');
  await bp.locator('#review-text').fill(reviewText);
  await bp.getByRole('button', { name: t('p4.submitReview') }).click();
  await expect(bp.locator('main')).toContainText(reviewText);
  const adminContext = await freshContext(browser, page);
  const adminPage = await adminContext.newPage();
  await adminLogin(adminPage);
  await adminPage.goto('/en/admin/reviews');
  await expect(adminPage.locator('main')).toContainText(reviewText);
  const reviewCard = adminPage.locator('li.rrow').filter({ hasText: reviewText });
  const reviewId = await reviewCard.locator('input[name=reviewId]').inputValue();
  await reviewCard.locator('summary').click(); // the decision form is collapsed until opened
  await reviewCard.locator('textarea[name=reason]').fill('Specific and relevant enquiry feedback.');
  await reviewCard.getByRole('button', { name: t('p4.decideReview') }).click();
  await expect.poll(async () => (await sql<{ status: string }>('select status from public.business_reviews where id=$1', [reviewId]))[0]?.status).toBe('published');
  await adminPage.reload();
  await expect(reviewCard).toHaveCount(0);
  await page.goto(url);
  await page.locator('#seller-response').fill('Thank you for the clear request.');
  await page.getByRole('button', { name: t('p4.sendResponse') }).click();
  await expect(page.locator('main')).toContainText('Thank you for the clear request.');
  await adminPage.goto('/en/admin/reviews');
  const responseCard = adminPage.locator('li.rrow').filter({ hasText: reviewText }).filter({ hasText: 'Thank you for the clear request.' });
  await responseCard.locator('summary').click();
  await responseCard.locator('textarea[name=reason]').fill('Relevant and respectful business response.');
  await responseCard.getByRole('button', { name: t('p4.decideReview') }).click();
  await expect.poll(async () => (await sql<{ seller_response_status: string }>('select seller_response_status from public.business_reviews where id=$1', [reviewId]))[0]?.seller_response_status).toBe('published');
  await adminContext.close();
  await bp.reload();
  await expect(bp.locator('main')).toContainText('Thank you for the clear request.');
  await logoutUi(bp, 'en');
  await loginUi(bp, buyer, 'en');
  await bp.goto(url);
  await expect(bp.locator('main')).toContainText('MYR 1375.00');

  const other = await createUser('p4-other');
  const oc = await signedClient(other);
  const denied = await oc.client.from('quotations').select('id').eq('enquiry_id', enquiryId);
  expect(denied.error).toBeNull();
  expect(denied.data).toEqual([]);
});

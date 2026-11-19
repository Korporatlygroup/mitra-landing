import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createBusinessOwner } from './support/biz';
import { createOrgAs, createUser, sql } from './support/db';
import { msg } from './support/i18n';
import { dl, fillBookingTerms, openPanelSection, openQuoteEditor } from './support/deals-ui';
import { freshContext, loginUi } from './support/ui';

// Evidence for the acceptance report: a real buyer and a real seller, in two separate browser sessions, hold a conversation and a quotation
// through the platform's own messaging and quotation screens. Every message and quotation is persisted; the spec asserts the database rows,
// the sender/recipient organisations, ordering, and that an unrelated third user cannot read the thread.
// Screenshots (SHOTS=1) go to docs/journey-evidence/. All names here are fictional demonstration data.
const t = (key: string) => msg('en', key);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const out = path.join(import.meta.dirname, '..', '..', 'docs', 'journey-evidence');
const SHOTS = process.env.SHOTS === '1';
const WIDTHS = [390, 1280];

async function shot(page: Page, role: string, step: string) {
  if (!SHOTS) return;
  const original = page.viewportSize() ?? { width: 1280, height: 800 };
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: w < 500 ? 844 : 900 });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.screenshot({ path: path.join(out, `${step}__${role}__${w}.png`) });
  }
  await page.setViewportSize(original);
}

test('Buyer and seller hold a real conversation and a quotation', async ({ page, browser }) => {
  test.setTimeout(300_000);
  const seller = await createBusinessOwner('demo-seller');
  const buyer = await createUser('demo-buyer', { name: 'Demo Buyer' });
  const outsider = await createUser('demo-outsider', { name: 'Unrelated User' });
  const buyerOrg = await createOrgAs(buyer, 'buyer', 'INOK Demo Buyer Trading');
  await createOrgAs(outsider, 'buyer', 'INOK Demo Outsider');
  const topic = 'Custom-printed packaging boxes (50 pieces)';
  const enquiryId = String(
    (
      await sql<{ id: string }>(
        `insert into public.enquiries(buyer_org_id,seller_org_id,origin,topic,opened_by_org_id,created_by)
         values($1,$2,'listing',$3,$1,$4) returning id`,
        [buyerOrg, seller.orgId, topic, buyer.id],
      )
    )[0]!.id,
  );
  const url = `/en/enquiries/${enquiryId}`;

  // --- buyer session ---
  const buyerCtx = await freshContext(browser, page);
  const bp = await buyerCtx.newPage();
  await loginUi(bp, buyer, 'en');
  await bp.goto('/en/enquiries');
  await shot(bp, 'buyer', '01-messages-list');
  await bp.goto(url);
  await bp.waitForLoadState('networkidle');
  const m1 = 'Hello, I am looking for 50 custom-printed packaging boxes. Could you provide a quotation and estimated delivery time to Kuala Lumpur?';
  await bp.locator('#reply-body').fill(m1);
  await shot(bp, 'buyer', '02-buyer-writes-first-message');
  await bp.getByRole('button', { name: dl('send') }).click();
  await expect(bp.locator('main')).toContainText(m1);
  await shot(bp, 'buyer', '03-buyer-message-sent');

  // --- seller session (the default page) ---
  await loginUi(page, seller.owner, 'en');
  await page.goto('/en/enquiries');
  await shot(page, 'seller', '04-seller-messages-list');
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('main')).toContainText(m1);
  await shot(page, 'seller', '05-seller-reads-buyer-message');
  const m2 = 'Thank you for your enquiry. We can supply 50 boxes. Could you confirm the dimensions and printing requirements?';
  await page.locator('#reply-body').fill(m2);
  await page.getByRole('button', { name: dl('send') }).click();
  await expect(page.locator('main')).toContainText(m2);
  await shot(page, 'seller', '06-seller-replies');

  // --- buyer answers ---
  await bp.reload();
  await expect(bp.locator('main')).toContainText(m2);
  await shot(bp, 'buyer', '07-buyer-sees-seller-reply');
  const m3 = 'The dimensions are 30 x 20 x 15 cm, with a single-colour logo.';
  await bp.locator('#reply-body').fill(m3);
  await bp.getByRole('button', { name: dl('send') }).click();
  await expect(bp.locator('main')).toContainText(m3);

  // --- seller prepares and sends the quotation ---
  await page.reload();
  await expect(page.locator('main')).toContainText(m3);
  const m4 = 'Thank you. I have prepared a quotation based on those specifications. Please review the quotation attached to your request.';
  await page.locator('#reply-body').fill(m4);
  await page.getByRole('button', { name: dl('send') }).click();
  await expect(page.locator('main')).toContainText(m4);
  await openQuoteEditor(page);
  await page.locator('#scope').fill('50 custom-printed packaging boxes, 30 x 20 x 15 cm, one-colour logo');
  await page.locator('#description1').fill('Printed packaging box');
  await page.locator('#quantity1').fill('50');
  await page.locator('#unit1').fill('pieces');
  await page.locator('#unitPrice1').fill('4.80');
  await page.locator('#validUntil').fill(inDays(14));
  await page.locator('#deliveryTiming').fill('Within ten working days, delivered to Kuala Lumpur');
  await fillBookingTerms(page);
  await page.locator('#taxTreatment').fill('Tax included as stated');
  await shot(page, 'seller', '08-seller-prepares-quotation');
  await page.getByRole('button', { name: t('p4.saveDraft') }).click();
  await expect(page.locator('body')).toContainText('MYR 240.00');
  await page.getByRole('button', { name: t('p4.sendQuote') }).click();
  await shot(page, 'seller', '09-seller-sent-quotation');

  // --- buyer reviews and accepts ---
  await bp.reload();
  await expect(bp.getByText('MYR 240.00').first()).toBeVisible();
  await shot(bp, 'buyer', '10-buyer-views-quotation');
  await bp.getByRole('button', { name: dl('accept') }).click();
  await expect(bp.locator('main')).toContainText(dl('ev_order_created'));
  await shot(bp, 'buyer', '11-buyer-accepts-quotation');
  await bp.goto('/en/enquiries');
  await shot(bp, 'buyer', '12-buyer-conversation-list');
  await page.goto(`/en/orgs/${seller.orgId}/business/leads`);
  await shot(page, 'seller', '13-seller-leads');

  // --- persistence, ordering, identities, isolation ---
  const rows = await sql<{ body: string; sender_org_id: string; sender_user_id: string }>(
    'select body, sender_org_id, sender_user_id from public.enquiry_messages where enquiry_id=$1 order by created_at, id',
    [enquiryId],
  );
  expect(rows.map((r) => r.body)).toEqual([m1, m2, m3, m4]);
  expect(rows.map((r) => r.sender_org_id)).toEqual([buyerOrg, seller.orgId, buyerOrg, seller.orgId]);
  expect(rows.map((r) => r.sender_user_id)).toEqual([buyer.id, seller.owner.id, buyer.id, seller.owner.id]);
  const quote = (await sql<{ status: string }>('select status from public.quotations where enquiry_id=$1', [enquiryId]))[0]!;
  expect(quote.status).toBe('accepted');

  const outsiderCtx = await freshContext(browser, page);
  const op = await outsiderCtx.newPage();
  await loginUi(op, outsider, 'en');
  const res = await op.goto(url);
  expect(res?.status()).toBe(404);
  await expect(op.locator('main')).not.toContainText(m1);
  await expect(op.locator('main')).not.toContainText('MYR 240.00');
});

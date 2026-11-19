import { expect, test } from '@playwright/test';
import { createBusinessOwner, createReviewer, reviewerGoto } from './support/biz';
import { createOrgAs, createUser, signedClient, sql } from './support/db';
import { dl } from './support/deals-ui';
import { msg } from './support/i18n';
import { shot } from './support/qa-evidence';
import { freshContext, loginUi } from './support/ui';

// E105 WP5: a problem with an agreement is an "issue" between two businesses: a reason from a short list plus a description, recorded on the
// agreement, the other side is told, INOK staff can read it in a read-only list. No money outcome exists and the words dispute/refund never appear.
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function agreedOrder(prefix: string) {
  const seller = await createBusinessOwner(`${prefix}-seller`);
  const buyer = await createUser(`${prefix}-buyer`);
  const buyerOrg = await createOrgAs(buyer, 'buyer', `Synthetic ${prefix} buyer`);
  const enquiryId = String((await sql<{ id: string }>(
    `insert into public.enquiries(buyer_org_id,seller_org_id,origin,topic,opened_by_org_id,created_by)
     values($1,$2,'listing','Printing of 500 flyers',$1,$3) returning id`, [buyerOrg, seller.orgId, buyer.id],
  ))[0]!.id);
  const sc = (await signedClient(seller.owner)).client, bc = (await signedClient(buyer)).client;
  const saved = await sc.rpc('save_quote_draft', { p_enquiry: enquiryId, p_draft: {
    currency: 'MYR', scope: '500 A5 flyers, full colour', exclusions: '', tax_treatment: 'No tax charged', delivery_timing: 'Within a week', terms: '', valid_until: `${inDays(7)}T23:59:59+08:00`,
    delivery_fee: '0.00', tax_amount: '0.00', lines: [{ description: 'A5 flyers', quantity: '500', unit: 'piece', unit_price: '0.40' }] }, p_expected_version: 0 });
  expect(saved.error).toBeNull();
  const qid = String(saved.data);
  const sent = await sc.rpc('send_quote_version', { p_quotation: qid, p_expected_version: 0 });
  expect(sent.error).toBeNull();
  const qv = Number((await sql<{ v: number }>('select version v from public.quotations where id=$1', [qid]))[0]!.v);
  const acc = await bc.rpc('respond_to_quote', { p_quotation: qid, p_version: String(sent.data), p_action: 'accept', p_reason: null, p_expected_version: qv });
  expect(acc.error).toBeNull();
  const orderId = String((await sql<{ id: string }>('select id from public.orders where enquiry_id=$1', [enquiryId]))[0]!.id);
  const started = await sc.rpc('order_action', { p_order: orderId, p_action: 'start', p_note: null });
  expect(started.error).toBeNull();
  return { seller, buyer, enquiryId, orderId, sc, bc };
}

test('E105 the buyer reports an issue with a reason; it is recorded, the seller sees it, staff read it, no money outcome', async ({ page, browser }, info) => {
  test.setTimeout(420_000);
  const { seller, buyer, enquiryId, orderId } = await agreedOrder('d105');
  const ref = (await sql<{ reference: string }>('select reference from public.orders where id=$1', [orderId]))[0]!.reference;

  await loginUi(page, buyer, 'en');
  await page.goto(`/en/orders/${orderId}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: dl('act_dispute') })).toBeVisible();
  await expect(page.locator('main')).toContainText(dl('issueHelp'));
  await shot(page, { role: 'buyer', journey: 'wp5', step: '01-report-issue-form', title: 'Buyer reports an issue', expected: 'Reason list, description, plain wording, no payment words', observed: 'Form shown', widths: [360, 1280] });
  // the reason is required: the form does not send without it
  await page.locator('#note-dispute').fill('The flyers have not arrived after two weeks.');
  await page.getByRole('button', { name: dl('act_dispute') }).click();
  expect((await sql<{ s: string }>('select status s from public.orders where id=$1', [orderId]))[0]!.s).toBe('in_progress');
  await page.locator('#issue-reason').selectOption('not_delivered');
  await page.getByRole('button', { name: dl('act_dispute') }).click();
  await expect(page.locator('main')).toContainText(dl('os_disputed'));
  await expect(page.locator('.deal-timeline')).toContainText(`${dl('ir_not_delivered')}: The flyers have not arrived after two weeks.`);
  await shot(page, { role: 'buyer', journey: 'wp5', step: '02-issue-reported', title: 'Issue recorded on the agreement', expected: 'Status "Issue reported" and the reason in the activity', observed: 'Recorded', widths: [360, 1280] });

  // stored as one note with the reason code, on the existing order event; status is the existing "disputed" state (shown as "Issue reported")
  const ev = (await sql<{ note: string }>(`select note from public.deal_events where order_id=$1 and kind='order.disputed'`, [orderId]))[0]!;
  expect(ev.note).toBe('[not_delivered] The flyers have not arrived after two weeks.');
  await expect(page.locator('main')).not.toContainText(/dispute|refund|paid|escrow/i);

  // the seller is notified and sees the same words in the agreement and in the conversation
  const notes = await sql<{ kind: string; user_id: string }>(`select kind,user_id from public.notifications where entity_id=$1 and kind='order.disputed'`, [orderId]);
  expect(notes.map((n) => n.user_id)).toEqual([seller.owner.id]);
  const sctx = await freshContext(browser, page);
  const sp = await sctx.newPage();
  await loginUi(sp, seller.owner, 'en');
  await sp.goto(`/en/orders/${orderId}`);
  await expect(sp.locator('.deal-timeline')).toContainText(`${dl('ir_not_delivered')}: The flyers`);
  await sp.goto(`/en/enquiries/${enquiryId}`);
  await expect(sp.locator('main')).toContainText(`${dl('ir_not_delivered')}: The flyers`);
  await expect(sp.getByRole('button', { name: dl('act_confirm') })).toHaveCount(0);
  await sctx.close();

  // staff with the report permission read it in a read-only list; a reviewer without it, and anyone else, get nothing
  const ops = await createReviewer('admin_ops', 'iss');
  const actx = await freshContext(browser, page);
  const ap = await actx.newPage();
  await reviewerGoto(ap, ops, '/en/admin/issues');
  const card = ap.getByTestId('issue-card').filter({ hasText: ref });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(ref);
  await expect(card).toContainText(dl('ir_not_delivered'));
  await expect(card).toContainText('The flyers have not arrived after two weeks.');
  await expect(card).toContainText('Synthetic d105 buyer');
  await expect(card.getByRole('button')).toHaveCount(0); // read only
  if (info.project.name === 'desktop') await expect(ap.getByRole('link', { name: msg('en', 'adm.orderIssues') }).first()).toBeVisible(); // the phone menu is a drawer
  await shot(ap, { role: 'admin', journey: 'wp5', step: '03-admin-issues', title: 'Staff read the reported issues', expected: 'Read-only card: agreement, reason, details, parties', observed: 'Card shown', widths: [1280] });
  await actx.close();

  const rev = await createReviewer('admin_review', 'iss2');
  const rctx = await freshContext(browser, page);
  const rp = await rctx.newPage();
  await reviewerGoto(rp, rev, '/en/admin/issues');
  await expect(rp.locator('p[role=alert]')).toContainText(dl('issuesNoAccess'));
  await rctx.close();
  const direct = await (await signedClient(buyer)).client.rpc('admin_order_issues', { p_limit: 10 });
  expect(direct.error?.message ?? '').toContain('not_found');
  // nothing about money was created or changed
  expect(Number((await sql<{ n: string }>(`select count(*) n from information_schema.columns where table_name='orders' and column_name ~ '(paid|refund|escrow|payout)'`))[0]!.n)).toBe(0);
});

test('E105 Malay and Tamil show the issue form and reasons without sideways scroll', async ({ page }) => {
  test.setTimeout(300_000);
  const { buyer, orderId } = await agreedOrder('d105b');
  await loginUi(page, buyer, 'en');
  for (const L of ['ms', 'ta'] as const) {
    await page.goto(`/${L}/orders/${orderId}`);
    await expect(page.locator('main')).toContainText(dl('issueHelp', L));
    for (const r of ['not_delivered', 'not_as_agreed', 'no_show', 'other']) await expect(page.locator(`#issue-reason option[value=${r}]`)).toHaveText(dl(`ir_${r}`, L));
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await shot(page, { role: 'buyer', journey: 'wp5', step: `04-issue-form-${L}`, title: `Issue form in ${L}`, expected: 'Translated reasons, wraps', observed: 'Renders', lang: L, widths: [360, 1280] });
  }
});

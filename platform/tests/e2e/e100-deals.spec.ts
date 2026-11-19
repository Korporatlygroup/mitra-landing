import { expect, test } from '@playwright/test';
import { createBusinessOwner } from './support/biz';
import { dl, openQuoteEditor, requestChanges } from './support/deals-ui';
import { createOrgAs, createUser, signedClient, sql } from './support/db';
import { msg } from './support/i18n';
import { shot } from './support/qa-evidence';
import { freshContext, loginUi } from './support/ui';

// E100 Deals: conversation workspace, quotation cards inside the chat, order (agreement) created from the accepted version,
// order actions, notifications, privacy, long histories, Malay and Tamil. No payment exists: nothing is ever marked paid or secured.
const t = (key: string) => msg('en', key);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test('E100 enquiry to quotation, revision, acceptance, agreement, delivery and confirmation; others see nothing', async ({ page, browser }, info) => {
  test.setTimeout(420_000);
  const mobile = info.project.name === 'mobile';
  const seller = await createBusinessOwner('d100-seller');
  const seller2 = await createBusinessOwner('d100-seller2');
  const buyer = await createUser('d100-buyer');
  const buyerOrg = await createOrgAs(buyer, 'buyer', 'Synthetic deal buyer');
  const stranger = await createUser('d100-stranger');
  await createOrgAs(stranger, 'buyer', 'Synthetic unrelated buyer');
  const enquiryId = String((await sql<{ id: string }>(
    `insert into public.enquiries(buyer_org_id,seller_org_id,origin,topic,opened_by_org_id,created_by)
     values($1,$2,'listing','Wedding photography booking',$1,$3) returning id`, [buyerOrg, seller.orgId, buyer.id],
  ))[0]!.id);
  const url = `/en/enquiries/${enquiryId}`;
  const S = 'seller', B = 'buyer', J = 'deals';

  // seller: reply, then create a quotation in the editor dialog
  await loginUi(page, seller.owner, 'en');
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wedding photography booking');
  await page.waitForLoadState('networkidle');
  await shot(page, { role: S, journey: J, step: '01-seller-chat-empty', title: 'Seller opens a new conversation', expected: 'Three-panel workspace with composer and Create quotation', observed: 'Chat renders', widths: [360, 1280] });
  await page.locator('#reply-body').fill('Yes, we can cover your wedding day.');
  await page.getByRole('button', { name: dl('send') }).click();
  await expect(page.locator('main')).toContainText('Yes, we can cover your wedding day.');
  // a double click on Send must not create two messages (the same idempotency key is used)
  await page.locator('#reply-body').fill('Duplicate guard message');
  await page.getByRole('button', { name: dl('send') }).dblclick();
  await expect(page.locator('main')).toContainText('Duplicate guard message');
  await expect.poll(async () => Number((await sql<{ n: string }>(`select count(*) n from public.enquiry_messages where enquiry_id=$1 and body='Duplicate guard message'`, [enquiryId]))[0]!.n)).toBe(1);

  const fillQuote = async (scope: string, price: string, qty: string) => {
    await page.locator('#scope').fill(scope);
    await page.locator('#description1').fill('Full-day wedding photography');
    await page.locator('#quantity1').fill(qty);
    await page.locator('#unit1').fill('day');
    await page.locator('#unitPrice1').fill(price);
    await page.locator('#validUntil').fill(inDays(7));
    await page.locator('#deliveryTiming').fill('Event date 20 December, edited photos in 14 days');
    await page.locator('#taxTreatment').fill('No tax charged');
    await page.locator('#terms').fill('Deposit and cancellation terms agreed between buyer and seller.');
  };
  await openQuoteEditor(page);
  await fillQuote('Wedding photography, 8 hours, 300 edited photos', '2400.00', '1');
  await shot(page, { role: S, journey: J, step: '02-quotation-editor', title: 'Seller quotation editor (dialog)', expected: 'Focused editor with items, validity, terms; save draft', observed: 'Editor open', widths: [360, 1280] });
  await page.getByRole('button', { name: t('p4.saveDraft') }).click();
  await expect(page.locator('body')).toContainText('MYR 2400.00');
  await page.getByRole('button', { name: t('p4.sendQuote') }).click();
  await expect(page.locator('main .qcard')).toHaveCount(1);
  await expect(page.locator('main .qcard')).toContainText(dl('qs_sent'));

  // buyer: sees the card, asks for changes
  const bctx = await freshContext(browser, page);
  const bp = await bctx.newPage();
  await loginUi(bp, buyer, 'en');
  await bp.goto(url);
  await expect(bp.locator('.qcard')).toContainText('MYR 2400.00');
  await shot(bp, { role: B, journey: J, step: '03-buyer-quotation-card', title: 'Buyer sees the quotation card in the chat', expected: 'Card with total, validity, Accept, Request changes, Decline', observed: 'Card shown', widths: [360, 1280] });
  await requestChanges(bp, 'Please add a second photographer.');
  await expect(bp.locator('main')).toContainText(dl('ev_quote_revision_requested'));
  await expect(bp.locator('main')).toContainText('Please add a second photographer.');

  // seller: revised version 2; the old card becomes outdated and cannot be accepted
  await page.reload();
  await openQuoteEditor(page);
  await fillQuote('Wedding photography, 8 hours, 300 edited photos, two photographers', '3100.00', '1');
  await page.getByRole('button', { name: t('p4.saveDraft') }).click();
  await expect(page.locator('body')).toContainText('MYR 3100.00');
  await page.getByRole('button', { name: t('p4.sendQuote') }).click();
  await expect(page.locator('main .qcard')).toHaveCount(2);
  await bp.reload();
  await expect(bp.locator('.qcard')).toHaveCount(2);
  await expect(bp.locator('.qcard[data-quote-status=outdated]')).toHaveCount(1);
  await expect(bp.locator('.qcard[data-quote-status=sent]')).toContainText('MYR 3100.00');
  await expect(bp.getByRole('button', { name: dl('accept') })).toHaveCount(1); // only the current version can be accepted

  // buyer accepts: the agreement (order) is created from exactly that version
  await bp.getByRole('button', { name: dl('accept') }).click();
  await expect(bp.locator('main')).toContainText(dl('ev_order_created'));
  const order = (await sql<{ id: string; reference: string; total: string; status: string; quote_version_id: string; items: { description: string }[] }>(
    `select id,reference,total::text,status,quote_version_id,items from public.orders where enquiry_id=$1`, [enquiryId]))[0]!;
  expect(order.total).toBe('3100.00');
  expect(order.status).toBe('agreed');
  expect(order.reference).toMatch(/^INOK-\d{4}-[A-F0-9]{6}$/);
  expect(order.items[0]!.description).toBe('Full-day wedding photography');
  const accepted = (await sql<{ accepted_version_id: string }>('select accepted_version_id from public.quotations where enquiry_id=$1', [enquiryId]))[0]!;
  expect(order.quote_version_id).toBe(accepted.accepted_version_id);
  expect(Number((await sql<{ n: string }>(`select count(*) n from public.orders`))[0]!.n)).toBeGreaterThanOrEqual(1);

  // events are persisted records, in order
  const kinds = (await sql<{ kind: string }>('select kind from public.deal_events where enquiry_id=$1 order by created_at, id', [enquiryId])).map((r) => r.kind);
  expect(kinds).toEqual(['quote.sent', 'quote.revision_requested', 'quote.sent', 'quote.accepted', 'order.created']);

  // notifications: one per real event, to the right organisation, no duplicates
  const notes = await sql<{ kind: string; user_id: string }>(`select kind,user_id from public.notifications where entity_id = any($1)`, [[order.id]]);
  expect(notes.filter((n) => n.kind === 'order.created').map((n) => n.user_id).sort()).toEqual([buyer.id, seller.owner.id].sort());

  // both sides open the agreement; the stranger and the other seller get 404
  await bp.goto(`/en/orders/${order.id}`);
  await expect(bp.locator('main')).toContainText(order.reference);
  await expect(bp.locator('main')).toContainText('MYR 3100.00');
  await expect(bp.locator('main')).toContainText(dl('paymentNote'));
  await expect(bp.locator('main')).not.toContainText(/paid|secured|escrow held/i);
  await shot(bp, { role: B, journey: J, step: '04-order-buyer', title: 'Buyer views the agreement', expected: 'Agreed items, total, status, activity, no payment claims', observed: 'Order page', widths: [360, 1280] });
  await page.goto(`/en/orders/${order.id}`);
  await expect(page.locator('main')).toContainText(order.reference);
  for (const who of [stranger, seller2.owner]) {
    const c = await freshContext(browser, page);
    const p = await c.newPage();
    await loginUi(p, who, 'en');
    expect((await p.goto(`/en/orders/${order.id}`))?.status()).toBe(404);
    expect((await p.goto(url))?.status()).toBe(404);
    const direct = await (await signedClient(who)).client.from('orders').select('id').eq('id', order.id);
    expect(direct.data).toEqual([]);
    await c.close();
  }

  // seller adds the booking date, starts, delivers (with a note); buyer confirms. Wrong-side actions are refused by the database.
  await page.locator('#serviceDate').fill(inDays(30));
  await page.getByRole('button', { name: dl('saveDetails') }).click();
  await expect.poll(async () => (await sql<{ d: string | null }>('select service_date::text d from public.orders where id=$1', [order.id]))[0]?.d).toBe(inDays(30));
  await page.getByRole('button', { name: dl('act_start') }).click();
  await expect(page.locator('main')).toContainText(dl('os_in_progress'));
  await expect(bp.goto(`/en/orders/${order.id}`)).resolves.toBeTruthy();
  await expect(bp.getByRole('button', { name: dl('act_confirm') })).toHaveCount(0); // nothing to confirm before delivery
  await page.reload();
  await page.locator('#note-mark_delivered').fill('Photos delivered by link on 21 December.');
  await page.getByRole('button', { name: dl('act_mark_delivered') }).click();
  await expect(page.locator('main')).toContainText(dl('os_buyer_confirmation_pending'));
  await bp.reload();
  await bp.getByRole('button', { name: dl('act_confirm') }).click();
  await expect(bp.locator('main')).toContainText(dl('os_completed'));
  expect((await sql<{ status: string }>('select status from public.orders where id=$1', [order.id]))[0]!.status).toBe('completed');
  const sellerTry = await (await signedClient(seller.owner)).client.rpc('order_action', { p_order: order.id, p_action: 'confirm', p_note: null });
  expect(sellerTry.error).not.toBeNull(); // only the buyer confirms; and a completed order cannot change
  const direct = await (await signedClient(buyer)).client.from('orders').update({ total: 1 }).eq('id', order.id).select();
  expect(direct.data ?? []).toEqual([]); // no direct writes: the agreed amount cannot be altered
  expect((await sql<{ total: string }>('select total::text from public.orders where id=$1', [order.id]))[0]!.total).toBe('3100.00');
  await shot(bp, { role: B, journey: J, step: '05-order-completed', title: 'Completed agreement with activity history', expected: 'Status completed, history of real events', observed: 'Order completed', widths: [360, 1280] });

  // the list of orders and the My deals tabs
  await bp.goto('/en/orders');
  await expect(bp.locator('.deal-orders')).toContainText(order.reference);
  await shot(bp, { role: B, journey: J, step: '06-my-deals-orders', title: 'My deals: orders tab', expected: 'Tabs Messages & quotations / My orders; order listed', observed: 'Orders listed', widths: [360, 1280] });
  await bp.goto('/en/enquiries');
  await expect(bp.locator('main')).toContainText(dl('tabOrders'));

  // Malay and Tamil: translated labels, no sideways scroll
  for (const L of ['ms', 'ta'] as const) {
    for (const path of [`/${L}/enquiries/${enquiryId}`, `/${L}/orders/${order.id}`]) {
      await bp.goto(path);
      await expect(bp.locator('main')).toContainText(dl(path.includes('/orders/') ? 'agreedItems' : 'composerLabel', L));
      expect(await bp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    }
    await shot(bp, { role: B, journey: J, step: `07-order-${L}`, title: `Agreement in ${L}`, expected: 'Translated, wraps correctly', observed: 'Renders', lang: L, widths: [360, 1280] });
  }
  if (mobile) {
    await bp.goto(url);
    expect(await bp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expect(bp.locator('.deal-back')).toBeVisible();
  }
  await bctx.close();
});

test('E100 long conversations load in pages and older messages stay reachable', async ({ page }) => {
  test.setTimeout(240_000);
  const seller = await createBusinessOwner('d100b-seller');
  const buyer = await createUser('d100b-buyer');
  const buyerOrg = await createOrgAs(buyer, 'buyer', 'Synthetic long-chat buyer');
  const enquiryId = String((await sql<{ id: string }>(
    `insert into public.enquiries(buyer_org_id,seller_org_id,origin,topic,opened_by_org_id,created_by)
     values($1,$2,'listing','Long conversation topic',$1,$3) returning id`, [buyerOrg, seller.orgId, buyer.id],
  ))[0]!.id);
  await sql(
    `insert into public.enquiry_messages(enquiry_id,sender_user_id,sender_org_id,body,created_at)
     select $1,$2,$3,'History message '||g, now() - ((130 - g) || ' minutes')::interval from generate_series(1,130) g`, [enquiryId, buyer.id, buyerOrg]);
  await loginUi(page, buyer, 'en');
  await page.goto(`/en/enquiries/${enquiryId}`);
  await expect(page.locator('[data-testid=conversation]')).toContainText('History message 130');
  await expect(page.locator('[data-testid=conversation]')).not.toContainText('History message 80');
  const earlier = page.getByRole('link', { name: dl('earlier') });
  await expect(earlier).toBeVisible(); // older history never silently disappears
  await earlier.click();
  await expect(page.locator('[data-testid=conversation]')).toContainText('History message 80');
  await expect(page.locator('[data-testid=conversation]')).toContainText('History message 79');
  await page.goto(`/en/enquiries/${enquiryId}?before=${encodeURIComponent('2000-01-01T00:00:00Z')}`);
  await expect(page.locator('[data-testid=conversation]')).toContainText(dl('noMessages'));
  await page.goto(`/en/enquiries/${enquiryId}?before=not-a-date`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Long conversation topic');
});

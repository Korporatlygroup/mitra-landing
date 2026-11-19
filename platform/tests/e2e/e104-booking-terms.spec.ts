import { expect, test } from '@playwright/test';
import { createBusinessOwner } from './support/biz';
import { createOrgAs, createUser, signedClient, sql } from './support/db';
import { daysAhead, dl, fillBookingTerms, openQuoteEditor, requestChanges } from './support/deals-ui';
import { msg } from './support/i18n';
import { shot } from './support/qa-evidence';
import { freshContext, loginUi } from './support/ui';

// E104 WP4: booking date, finish-by date, deposit expectation (text only) and cancellation conditions are part of the quotation the buyer accepts.
// The accepted wording is copied to the agreement and locked; a later change is a new quotation version, never an edit of the agreement.
const t = (key: string) => msg('en', key);

async function setup(prefix: string) {
  const seller = await createBusinessOwner(`${prefix}-seller`);
  const buyer = await createUser(`${prefix}-buyer`);
  const buyerOrg = await createOrgAs(buyer, 'buyer', `Synthetic ${prefix} buyer`);
  const enquiryId = String((await sql<{ id: string }>(
    `insert into public.enquiries(buyer_org_id,seller_org_id,origin,topic,opened_by_org_id,created_by)
     values($1,$2,'listing','Catering for a company event',$1,$3) returning id`, [buyerOrg, seller.orgId, buyer.id],
  ))[0]!.id);
  return { seller, buyer, buyerOrg, enquiryId, url: `/en/enquiries/${enquiryId}` };
}

const quoteBase = async (page: import('@playwright/test').Page, scope: string, price: string) => {
  await page.locator('#scope').fill(scope);
  await page.locator('#description1').fill('Lunch buffet for 40 guests');
  await page.locator('#quantity1').fill('1');
  await page.locator('#unit1').fill('event');
  await page.locator('#unitPrice1').fill(price);
  await page.locator('#validUntil').fill(daysAhead(7));
  await page.locator('#deliveryTiming').fill('Set up two hours before the start');
  await page.locator('#taxTreatment').fill('No tax charged');
};

test('E104 terms are written into the quotation, shown to the buyer before accepting, copied to the agreement and locked', async ({ page, browser }) => {
  test.setTimeout(420_000);
  const { seller, buyer, enquiryId, url } = await setup('d104');
  await loginUi(page, seller.owner, 'en');
  await page.goto(url);
  await openQuoteEditor(page);
  await quoteBase(page, 'Lunch buffet, two mains, rice, dessert, drinks', '1800.00');
  await shot(page, { role: 'seller', journey: 'wp4', step: '01-editor-terms', title: 'Quotation editor with booking terms', expected: 'Booking date, finish-by, deposit expectation, cancellation conditions', observed: 'Editor shows the terms fieldset', widths: [360, 1280] });
  await fillBookingTerms(page, { date: daysAhead(30), finishBy: daysAhead(31), deposit: '30% of the total two weeks before the date', option: 'custom', custom: 'Free to cancel until 10 days before; after that 50% is payable.' });
  await page.getByRole('button', { name: t('p4.saveDraft') }).click();
  await expect(page.getByTestId('booking-terms')).toContainText('30% of the total two weeks before the date');
  await shot(page, { role: 'seller', journey: 'wp4', step: '02-preview-terms', title: 'Seller previews the terms before sending', expected: 'Preview lists the terms', observed: 'Terms listed under the draft preview', widths: [360, 1280] });
  await page.getByRole('button', { name: t('p4.sendQuote') }).click();
  await expect(page.locator('main .qcard')).toHaveCount(1);

  // the version stores the terms exactly as typed
  const v1 = (await sql<{ id: string; booking_date: string; completion_by: string; deposit_terms: string; cancellation_option: string; cancellation_text: string }>(
    `select v.id, v.booking_date::text, v.completion_by::text, v.deposit_terms, v.cancellation_option, v.cancellation_text from public.quotation_versions v join public.quotations q on q.id=v.quotation_id where q.enquiry_id=$1`, [enquiryId]))[0]!;
  expect(v1).toMatchObject({ booking_date: daysAhead(30), completion_by: daysAhead(31), deposit_terms: '30% of the total two weeks before the date', cancellation_option: 'custom', cancellation_text: 'Free to cancel until 10 days before; after that 50% is payable.' });

  // buyer sees the terms ON the card before accepting
  const bctx = await freshContext(browser, page);
  const bp = await bctx.newPage();
  await loginUi(bp, buyer, 'en');
  await bp.goto(url);
  const card = bp.locator('.qcard[data-quote-status=sent]');
  await expect(card.getByTestId('booking-terms')).toContainText(dl('bookingDate'));
  await expect(card.getByTestId('booking-terms')).toContainText('30% of the total two weeks before the date');
  await expect(card.getByTestId('booking-terms')).toContainText('Free to cancel until 10 days before');
  await shot(bp, { role: 'buyer', journey: 'wp4', step: '03-card-terms', title: 'Buyer reads the terms on the quotation card', expected: 'Date, deposit expectation and cancellation conditions above Accept', observed: 'Terms shown on the card', widths: [360, 1280] });

  // the buyer asks for a change; the seller sends version 2 with a new date and the standard 7-day option
  await requestChanges(bp, 'Can we move it one week later?');
  await page.reload();
  await openQuoteEditor(page);
  await quoteBase(page, 'Lunch buffet, two mains, rice, dessert, drinks', '1800.00');
  await fillBookingTerms(page, { date: daysAhead(37), finishBy: '', deposit: 'No deposit', option: 'free_7d', custom: '' });
  await page.getByRole('button', { name: t('p4.saveDraft') }).click();
  await page.getByRole('button', { name: t('p4.sendQuote') }).click();
  await expect(page.locator('main .qcard')).toHaveCount(2);
  await bp.reload();
  await expect(bp.locator('.qcard[data-quote-status=outdated]')).toHaveCount(1);
  const cur = bp.locator('.qcard[data-quote-status=sent]');
  await expect(cur.getByTestId('booking-terms')).toContainText(dl('canc_free_7d'));
  await cur.getByRole('button', { name: dl('accept') }).click();
  await expect(bp.locator('main')).toContainText(dl('ev_order_created'));

  // the agreement carries version 2's terms; version 1 is unchanged history
  const o = (await sql<{ id: string; service_date: string; completion_by: string | null; deposit_note: string; cancellation_option: string; terms_locked: boolean }>(
    `select id, service_date::text, completion_by::text, deposit_note, cancellation_option, terms_locked from public.orders where enquiry_id=$1`, [enquiryId]))[0]!;
  expect(o).toMatchObject({ service_date: daysAhead(37), completion_by: null, deposit_note: 'No deposit', cancellation_option: 'free_7d', terms_locked: true });
  const old = (await sql<{ booking_date: string; cancellation_option: string }>(`select booking_date::text, cancellation_option from public.quotation_versions where id=$1`, [v1.id]))[0]!;
  expect(old).toEqual({ booking_date: daysAhead(30), cancellation_option: 'custom' });
  await bp.goto(`/en/orders/${o.id}`);
  await expect(bp.getByTestId('booking-terms')).toContainText(dl('acceptedTerms'));
  await expect(bp.getByTestId('booking-terms')).toContainText(dl('canc_free_7d'));
  await expect(bp.locator('main')).toContainText(dl('termsChange'));
  await shot(bp, { role: 'buyer', journey: 'wp4', step: '04-agreement-terms', title: 'Agreement shows the accepted terms', expected: 'Accepted booking terms, locked, with how to change them', observed: 'Terms shown', widths: [360, 1280] });

  // sellers cannot edit the accepted terms: the form is gone and the database refuses
  await page.goto(`/en/orders/${o.id}`);
  await expect(page.locator('#serviceDate')).toHaveCount(0);
  const edit = await (await signedClient(seller.owner)).client.rpc('set_order_details', { p_order: o.id, p_service_date: daysAhead(60), p_deposit_note: 'changed' });
  expect(edit.error?.message ?? '').toContain('terms_locked');
  expect((await sql<{ d: string }>('select service_date::text d from public.orders where id=$1', [o.id]))[0]!.d).toBe(daysAhead(37));
  await bctx.close();
});

test('E104 a draft without terms cannot be sent; the database rejects bad dates and incomplete cancellation conditions', async ({ page }) => {
  test.setTimeout(300_000);
  const { seller, enquiryId, url } = await setup('d104b');
  const sc = await signedClient(seller.owner);
  const draft = { currency: 'MYR', scope: 'Event catering for 40 guests', exclusions: '', tax_treatment: 'No tax charged', delivery_timing: 'Two hours before', terms: '', valid_until: `${daysAhead(7)}T23:59:59+08:00`,
    delivery_fee: '0.00', tax_amount: '0.00', lines: [{ description: 'Buffet', quantity: '1', unit: 'event', unit_price: '500.00' }] };
  const saved = await sc.client.rpc('save_quote_draft', { p_enquiry: enquiryId, p_draft: draft, p_expected_version: 0 });
  expect(saved.error).toBeNull();
  const qid = String(saved.data);
  const sendRpc = (d: Record<string, unknown>, version: number) => sc.client.rpc('save_quote_draft', { p_enquiry: enquiryId, p_draft: d, p_expected_version: version })
    .then(async (r) => (r.error ? r : sc.client.rpc('send_quote_version', { p_quotation: qid, p_expected_version: version + 1 })));
  const good = { booking_date: daysAhead(14), completion_by: '', deposit_terms: 'No deposit', cancellation_option: 'free_7d', cancellation_text: '' };
  const cases: [string, Record<string, unknown>, string][] = [
    ['past date', { ...good, booking_date: daysAhead(-1) }, 'invalid_date'],
    ['finish-by before the booking date', { ...good, completion_by: daysAhead(10) }, 'invalid_date'],
    ['not a date', { ...good, booking_date: '30/12/2026' }, 'invalid_date'],
    ['no deposit text', { ...good, deposit_terms: '' }, 'invalid_terms'],
    ['unknown cancellation option', { ...good, cancellation_option: 'anything' }, 'invalid_terms'],
    ['custom without text', { ...good, cancellation_option: 'custom', cancellation_text: '' }, 'invalid_terms'],
  ];
  let version = 0;
  for (const [name, terms, err] of cases) {
    const r = await sendRpc({ ...draft, ...terms }, version);
    expect(r.error?.message ?? '', name).toContain(err);
    // a refused send leaves the draft editable and nothing sent
    version = Number((await sql<{ v: number }>('select version v from public.quotations where id=$1', [qid]))[0]!.v);
    expect(Number((await sql<{ n: string }>('select count(*) n from public.quotation_versions where quotation_id=$1', [qid]))[0]!.n), name).toBe(0);
  }

  // put back a draft that predates the terms
  expect((await sc.client.rpc('save_quote_draft', { p_enquiry: enquiryId, p_draft: draft, p_expected_version: version })).error).toBeNull();

  // in the app, a saved draft that predates the terms shows what is missing and Send is refused with a clear message
  await loginUi(page, seller.owner, 'en');
  await page.goto(url);
  await openQuoteEditor(page);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(dl('termsMissing'));
  await dialog.getByRole('button', { name: t('p4.sendQuote') }).click();
  await expect(dialog).toContainText(msg('en', 'errors.terms_required'));
  expect(Number((await sql<{ n: string }>('select count(*) n from public.quotation_versions where quotation_id=$1', [qid]))[0]!.n)).toBe(0);
  await shot(page, { role: 'seller', journey: 'wp4', step: '05-terms-missing', title: 'Older draft without terms', expected: 'Clear message that terms are needed; nothing sent', observed: 'Message shown', widths: [360, 1280] });
});

test('E104 Malay and Tamil show the terms without sideways scroll', async ({ page }) => {
  test.setTimeout(300_000);
  const { seller, enquiryId } = await setup('d104c');
  const sc = await signedClient(seller.owner);
  const draft = { currency: 'MYR', scope: 'Event catering for 40 guests', exclusions: '', tax_treatment: 'No tax charged', delivery_timing: 'Two hours before', terms: '', valid_until: `${daysAhead(7)}T23:59:59+08:00`,
    delivery_fee: '0.00', tax_amount: '0.00', lines: [{ description: 'Buffet', quantity: '1', unit: 'event', unit_price: '500.00' }],
    booking_date: daysAhead(20), completion_by: daysAhead(21), deposit_terms: 'No deposit', cancellation_option: 'deposit_kept', cancellation_text: '' };
  const saved = await sc.client.rpc('save_quote_draft', { p_enquiry: enquiryId, p_draft: draft, p_expected_version: 0 });
  expect(saved.error).toBeNull();
  expect((await sc.client.rpc('send_quote_version', { p_quotation: String(saved.data), p_expected_version: 0 })).error).toBeNull();
  await loginUi(page, seller.owner, 'en');
  for (const L of ['ms', 'ta'] as const) {
    await page.goto(`/${L}/enquiries/${enquiryId}`);
    const terms = page.getByTestId('booking-terms').first();
    await expect(terms).toContainText(dl('bookingDate', L));
    await expect(terms).toContainText(dl('canc_deposit_kept', L));
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await shot(page, { role: 'seller', journey: 'wp4', step: `06-card-terms-${L}`, title: `Terms on the quotation card in ${L}`, expected: 'Translated labels, wraps', observed: 'Renders', lang: L, widths: [360, 1280] });
  }
});

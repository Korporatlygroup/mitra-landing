import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createReviewer, reviewerGoto } from './support/biz';
import { sql, type TestUser } from './support/db';
import { daysAhead, dl, fillBookingTerms, openQuoteEditor, requestChanges } from './support/deals-ui';
import { msg } from './support/i18n';
import { shot } from './support/qa-evidence';
import { confirmEmailUi, createOrgUi, signUpUi, type Locale } from './support/ui';

// SIMULATION (opt-in: SIM=1, LOCAL stack only). Ten synthetic Malaysian businesses (sellers, buyers and both) register, set up, get reviewed, find each other,
// negotiate, agree, deliver, cancel, decline and report problems, through the real UI. Everything is fictional: names, owners, emails (example.test) and numbers.
// Nothing here may ever be pointed at production. The report is written to docs/qa-evidence-simulation/.
test.skip(process.env.SIM !== '1', 'opt-in: SIM=1 against a local stack');

type Kind = 'seller' | 'buyer' | 'both';
interface Persona { key: string; name: string; owner: string; lang: Locale; kind: Kind; state: string; district: string; headline?: string; description?: string; service?: string; category?: number }
const P: Persona[] = [
  { key: 'B1', name: 'Kedai Katering Lestari', owner: 'Aminah Yusof', lang: 'ms', kind: 'seller', state: 'Selangor', district: 'Shah Alam', category: 1, headline: 'Home-style catering for offices and small events', description: 'We cook nasi lemak, rendang and kuih for office lunches, kenduri and birthdays. Minimum 20 portions, delivery in the Klang Valley.', service: 'Event catering' },
  { key: 'B2', name: 'Ahmad Cetak Digital', owner: 'Ahmad Faizal', lang: 'en', kind: 'seller', state: 'W.P. Kuala Lumpur', district: 'Chow Kit', category: 2, headline: 'Banners, flyers and business cards, fast turnaround', description: 'Digital and offset printing for small shops: flyers, banners, stickers, name cards. Design help available, pickup or delivery in KL.', service: 'Flyers and banners' },
  { key: 'B3', name: 'Mohan Tailoring and Textiles', owner: 'Mohan Raj', lang: 'ta', kind: 'seller', state: 'Pulau Pinang', district: 'Georgetown', category: 3, headline: 'Custom uniforms, sarees and alterations in Penang', description: 'School and company uniforms, blouse stitching and festive wear. Group orders welcome, fittings by appointment in Georgetown.', service: 'Custom uniforms' },
  { key: 'B4', name: 'Siti Dekorasi Majlis', owner: 'Siti Hajar', lang: 'ms', kind: 'seller', state: 'Johor', district: 'Johor Bahru', category: 4, headline: 'Wedding and event decoration across Johor', description: 'Pelamin, canopy, flower arrangements and lighting for weddings and community events. Site visit before every booking.', service: 'Event decoration' },
  { key: 'B5', name: 'Sri Murugan Sweets and Snacks', owner: 'Kavitha Murugan', lang: 'ta', kind: 'seller', state: 'Perak', district: 'Ipoh', category: 1, headline: 'Traditional sweets and snack boxes for festivals', description: 'Murukku, laddu, halwa and gift boxes for Deepavali and weddings. Bulk orders with two weeks notice, delivery across Perak.', service: 'Festival snack boxes' },
  { key: 'B6', name: 'Wei Packaging Supplies', owner: 'Tan Wei Ming', lang: 'en', kind: 'both', state: 'Selangor', district: 'Klang', category: 5, headline: 'Corrugated boxes and food packaging for small sellers', description: 'Mailer boxes, corrugated cartons and food-grade containers for online sellers and restaurants. Minimum 100 pieces, Klang Valley delivery.', service: 'Packaging boxes' },
  { key: 'B7', name: 'Priya Boutique', owner: 'Priya Nair', lang: 'en', kind: 'buyer', state: 'Selangor', district: 'Subang Jaya' },
  { key: 'B8', name: 'Kumar Cafe and Bistro', owner: 'Kumar Subramaniam', lang: 'en', kind: 'buyer', state: 'W.P. Kuala Lumpur', district: 'Brickfields' },
  { key: 'B9', name: 'Fatimah Online Store', owner: 'Fatimah Zahra', lang: 'ms', kind: 'buyer', state: 'Selangor', district: 'Kajang' },
  { key: 'B10', name: 'Raju Logistics Services', owner: 'Raju Gopal', lang: 'en', kind: 'both', state: 'Selangor', district: 'Petaling Jaya', category: 6, headline: 'Small-load deliveries and van hire in the Klang Valley', description: 'Same-day and next-day deliveries, van hire with driver and last-mile delivery for online sellers around Petaling Jaya and KL.', service: 'Van delivery' },
];
const by = (k: string) => P.find((p) => p.key === k)!;
const SELLERS = P.filter((p) => p.kind !== 'buyer');

interface Who { p: Persona; user: TestUser; ctx: BrowserContext; page: Page; bizOrg?: string; buyOrg?: string }
const who: Record<string, Who> = {};
const log: { step: string; ok: boolean; note?: string }[] = [];
const tick = async (step: string, fn: () => Promise<void>) => { try { await test.step(step, fn); log.push({ step, ok: true }); } catch (e) { log.push({ step, ok: false, note: String((e as Error).message).split('\n')[0]!.slice(0, 200) }); throw e; } };
const t = (key: string) => msg('en', key);
const orgOf = (w: Who) => (w.bizOrg ?? w.buyOrg)!;

async function waitHydrated(page: Page, label: string) {
  await page.waitForFunction((l) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === l);
    return Boolean(b && Object.keys(b).some((k) => k.startsWith('__reactProps')));
  }, label, { timeout: 30_000 });
}

async function enquire(buyer: Who, seller: Who, topic: string, qty: string, message: string): Promise<string> {
  const bp = buyer.page;
  await bp.goto('/en/directory');
  await bp.locator('#q').fill(seller.p.name);
  await bp.getByRole('button', { name: t('dir.search'), exact: true }).click();
  await bp.locator('a.lcard-link').filter({ hasText: seller.p.name }).first().click();
  await expect(bp.getByRole('heading', { level: 1 })).toHaveText(seller.p.name);
  await waitHydrated(bp, t('dir2.send'));
  await bp.getByRole('button', { name: t('dir2.send'), exact: true }).first().click();
  await bp.locator('#enq-topic').fill(topic);
  await bp.locator('#enq-qty').fill(qty);
  await bp.locator('#enq-details').fill(message);
  await bp.locator('form:has(#enq-topic) button[type=submit]').click();
  await expect(bp.getByText(t('dir2.sentSub'))).toBeVisible();
  return String((await sql<{ id: string }>(`select id from public.enquiries where seller_org_id=$1 and topic=$2 order by created_at desc limit 1`, [seller.bizOrg!, topic]))[0]!.id);
}

async function reply(w: Who, enquiryId: string, text: string) {
  await w.page.goto(`/en/enquiries/${enquiryId}`);
  await w.page.waitForLoadState('networkidle');
  await w.page.locator('#reply-body').fill(text);
  await w.page.getByRole('button', { name: dl('send') }).click();
  await expect(w.page.locator('main')).toContainText(text);
}

async function quote(seller: Who, enquiryId: string, o: { scope: string; item: string; qty: string; unit: string; price: string; date: number; deposit: string; option?: 'free_7d' | 'deposit_kept' | 'no_cancel' | 'custom'; custom?: string }) {
  const p = seller.page;
  await p.goto(`/en/enquiries/${enquiryId}`);
  await p.waitForLoadState('networkidle');
  await openQuoteEditor(p);
  await p.locator('#scope').fill(o.scope);
  await p.locator('#description1').fill(o.item);
  await p.locator('#quantity1').fill(o.qty);
  await p.locator('#unit1').fill(o.unit);
  await p.locator('#unitPrice1').fill(o.price);
  await p.locator('#validUntil').fill(daysAhead(10));
  await p.locator('#deliveryTiming').fill('As agreed in the booking date');
  await p.locator('#taxTreatment').fill('No tax charged');
  await fillBookingTerms(p, { date: daysAhead(o.date), deposit: o.deposit, option: o.option ?? 'free_7d', custom: o.custom });
  await p.getByRole('button', { name: t('p4.saveDraft') }).click();
  await expect(p.locator('body')).toContainText(`MYR ${o.price.includes('.') ? '' : ''}`);
  await p.getByRole('button', { name: t('p4.sendQuote') }).click();
  await expect(p.locator('main .qcard').first()).toBeVisible();
}

async function orderIdOf(enquiryId: string): Promise<string> {
  await expect.poll(async () => (await sql<{ id: string }>(`select id from public.orders where enquiry_id=$1`, [enquiryId]))[0]?.id ?? '').not.toBe('');
  return String((await sql<{ id: string }>(`select id from public.orders where enquiry_id=$1`, [enquiryId]))[0]!.id);
}
const statusOf = async (orderId: string) => (await sql<{ s: string }>(`select status s from public.orders where id=$1`, [orderId]))[0]!.s;

test('SIM ten synthetic businesses use the whole platform', async ({ browser }, info) => {
  test.setTimeout(3_600_000);
  const mobile = info.project.name === 'mobile';
  const tag = Date.now().toString(36);
  const QA = (page: Page, journey: string, step: string, title: string, lang: Locale = 'en') => shot(page, { role: 'user', journey, step, title, expected: title, observed: 'Shown', lang, widths: mobile ? [360] : [1280] }).catch(() => undefined);

  // ---------------------------------------------------------------- A. registration and organisations
  for (const p of P) {
    await tick(`${p.key} ${p.name}: sign up in ${p.lang}, confirm email, create organisation`, async () => {
      const ctx = await browser.newContext(mobile ? { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      const email = `sim-${p.key.toLowerCase()}-${tag}@example.test`;
      const user: TestUser = { id: '', email, password: `Sim${tag}Pass9!`, name: p.owner };
      await signUpUi(page, { locale: p.lang, name: p.owner, email, password: user.password, language: p.lang });
      await confirmEmailUi(page, email);
      user.id = String((await sql<{ id: string }>(`select id from auth.users where email=$1`, [email]))[0]!.id);
      const w: Who = { p, user, ctx, page };
      if (p.kind !== 'buyer') w.bizOrg = await createOrgUi(page, 'business', p.name, 'en');
      if (p.kind !== 'seller') w.buyOrg = p.kind === 'buyer' ? await createOrgUi(page, 'buyer', p.name, 'en') : await createOrgUi(page, 'buyer', `${p.name} (buying)`, 'en');
      who[p.key] = w;
    });
  }
  // the two required consents are recorded for every one of the ten, marketing for none
  const consents = await sql<{ n: string }>(`select count(*) n from public.consents c join auth.users u on u.id=c.user_id where u.email like $1 and c.purpose in ('terms','privacy') and c.withdrawn_at is null`, [`sim-%-${tag}@example.test`]);
  expect(Number(consents[0]!.n)).toBe(20);
  expect(Number((await sql<{ n: string }>(`select count(*) n from public.consents c join auth.users u on u.id=c.user_id where u.email like $1 and c.purpose='marketing'`, [`sim-%-${tag}@example.test`]))[0]!.n)).toBe(0);

  // ---------------------------------------------------------------- B. the seven sellers use the three-step quick start; INOK staff review and approve
  for (const p of SELLERS) {
    await tick(`${p.key}: three-step quick start, sent for review`, async () => {
      const w = who[p.key]!; const pg = w.page;
      await pg.goto(`/en/orgs/${w.bizOrg}/business/quickstart?step=1`);
      await pg.waitForLoadState('networkidle');
      await pg.locator('#business_name').fill(p.name);
      await pg.locator('#category_slug').selectOption({ index: p.category! });
      await pg.locator('#reg-yes').check();
      await pg.getByRole('button', { name: dl('quick.next'), exact: true }).click();
      await expect(pg).toHaveURL(/step=2/);
      await pg.locator('#state').selectOption({ label: p.state });
      await pg.locator('#district').fill(p.district);
      await pg.getByRole('button', { name: dl('quick.next'), exact: true }).click();
      await expect(pg).toHaveURL(/step=3/);
      await pg.locator('#headline').fill(p.headline!);
      await pg.locator('#description').fill(p.description!);
      await pg.locator('#service_name').fill(p.service!);
      await pg.locator('#whatsapp').fill('0123456789');
      await pg.getByRole('button', { name: dl('quick.send'), exact: true }).click();
      await expect(pg).toHaveURL(/step=done/);
      expect((await sql<{ s: string }>(`select review_status::text s from public.business_listings where org_id=$1`, [w.bizOrg!]))[0]!.s).toBe('pending_review');
    });
  }
  const rv = await createReviewer('admin_super', 'simstaff');
  const sctx = await browser.newContext(mobile ? { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } });
  const staff = await sctx.newPage();
  for (const p of SELLERS) {
    await tick(`${p.key}: INOK staff approve the listing`, async () => {
      await reviewerGoto(staff, rv, `/en/admin/listings/${who[p.key]!.bizOrg}`, { login: p.key === SELLERS[0]!.key });
      await staff.waitForLoadState('networkidle');
      await staff.locator('#dec-approve').check();
      await staff.getByRole('button', { name: msg('en', 'adminList.save'), exact: true }).click();
      await expect(staff.getByText(msg('en', 'adminList.nothingPending'))).toBeVisible();
      expect((await sql<{ s: string }>(`select live_status::text s from public.business_listings where org_id=$1`, [who[p.key]!.bizOrg!]))[0]!.s).toBe('published');
    });
  }
  await tick('directory: every approved business is found by a visitor, nothing else is listed', async () => {
    const v = await (await browser.newContext()).newPage();
    for (const p of SELLERS) {
      await v.goto('/en/directory');
      await v.locator('#q').fill(p.name);
      await v.getByRole('button', { name: t('dir.search'), exact: true }).click();
      await expect(v.locator('a.lcard-link').filter({ hasText: p.name })).toHaveCount(1);
    }
    await v.goto('/en/directory');
    await v.locator('#q').fill('Priya Boutique');
    await v.getByRole('button', { name: t('dir.search'), exact: true }).click();
    await expect(v.locator('a.lcard-link').filter({ hasText: 'Priya Boutique' })).toHaveCount(0); // a buyer is not a listed business
  });

  // ---------------------------------------------------------------- C. trade: seven conversations covering every ending
  const ids: Record<string, { enq: string; order?: string }> = {};
  const trade = async (name: string, buyerKey: string, sellerKey: string, o: { topic: string; qty: string; msg: string; reply: string; item: string; unit: string; price: string; scope: string; ending: 'complete' | 'issue' | 'cancel' | 'decline' | 'revise-complete' | 'silent' }) => {
    await tick(name, async () => {
      const b = who[buyerKey]!, s = who[sellerKey]!;
      const enq = await enquire(b, s, o.topic, o.qty, o.msg);
      ids[name] = { enq };
      await loginAs(s);
      await reply(s, enq, o.reply);
      await expect(b.page.locator('body')).toBeDefined();
      if (o.ending === 'silent') { await b.page.goto(`/en/enquiries/${enq}`); await expect(b.page.locator('main')).toContainText(o.reply); return; }
      await quote(s, enq, { scope: o.scope, item: o.item, qty: o.qty, unit: o.unit, price: o.price, date: 14, deposit: 'No deposit', option: 'free_7d' });
      await b.page.goto(`/en/enquiries/${enq}`);
      await b.page.waitForLoadState('networkidle');
      await expect(b.page.locator('.qcard[data-quote-status=sent]').getByTestId('booking-terms')).toContainText(dl('bookingDate'));
      await QA(b.page, 'trade', name.slice(0, 2) + '-1-card', name.slice(0, 2) + ' buyer reads the quotation with booking terms');
      if (o.ending === 'decline') { await b.page.getByRole('button', { name: dl('decline') }).click(); await expect(b.page.locator('main')).toContainText(dl('ev_quote_declined')); return; }
      if (o.ending === 'revise-complete') {
        await requestChanges(b.page, 'Can the date be a week later and a smaller deposit?');
        await expect(b.page.locator('main')).toContainText(dl('ev_quote_revision_requested'));
        await s.page.goto(`/en/enquiries/${enq}`); await s.page.waitForLoadState('networkidle');
        await quote(s, enq, { scope: o.scope, item: o.item, qty: o.qty, unit: o.unit, price: o.price, date: 21, deposit: '20% two weeks before the date', option: 'deposit_kept' });
        await b.page.goto(`/en/enquiries/${enq}`); await b.page.waitForLoadState('networkidle');
        await expect(b.page.locator('.qcard[data-quote-status=outdated]')).toHaveCount(1);
      }
      await b.page.getByRole('button', { name: dl('accept') }).click();
      await expect(b.page.locator('main')).toContainText(dl('ev_order_created'));
      const order = await orderIdOf(enq); ids[name]!.order = order;
      // the terms on the agreement are exactly what was on the accepted card, locked
      expect(await sql(`select terms_locked, service_date::text d from public.orders where id=$1`, [order])).toMatchObject([{ terms_locked: true }]);
      if (o.ending === 'cancel') {
        await b.page.goto(`/en/orders/${order}`);
        await b.page.locator('#note-cancel').fill('Plans changed, sorry.');
        await b.page.getByRole('button', { name: dl('act_cancel') }).click();
        await expect(b.page.locator('main')).toContainText(dl('os_cancelled'));
        expect(await statusOf(order)).toBe('cancelled');
      await QA(b.page, 'trade', name.slice(0, 2) + '-3-cancelled', name.slice(0, 2) + ' agreement cancelled by the buyer');
        return;
      }
      await s.page.goto(`/en/orders/${order}`);
      await s.page.getByRole('button', { name: dl('act_start') }).click();
      await expect(s.page.locator('main')).toContainText(dl('os_in_progress'));
      if (o.ending === 'issue') {
        await b.page.goto(`/en/orders/${order}`);
        await b.page.locator('#issue-reason').selectOption('not_delivered').catch(() => undefined);
        await b.page.locator('#note-dispute').fill('Nothing arrived by the date we agreed.').catch(() => undefined);
        await b.page.getByRole('button', { name: dl('act_dispute') }).click().catch(() => undefined);
        await expect(b.page.locator('main')).toContainText(dl('os_disputed'));
      await QA(b.page, 'trade', name.slice(0, 2) + '-3-issue', name.slice(0, 2) + ' issue reported');
        return;
      }
      await s.page.locator('#note-mark_delivered').fill('Delivered on the agreed date, signed by the buyer.');
      await s.page.getByRole('button', { name: dl('act_mark_delivered') }).click();
      await expect(s.page.locator('main')).toContainText(dl('os_buyer_confirmation_pending'));
      await b.page.goto(`/en/orders/${order}`);
      await b.page.getByRole('button', { name: dl('act_confirm') }).click();
      await expect(b.page.locator('main')).toContainText(dl('os_completed'));
      expect(await statusOf(order)).toBe('completed');
      await QA(b.page, 'trade', name.slice(0, 2) + '-3-completed', name.slice(0, 2) + ' agreement completed');
    });
  };
  async function loginAs(_w: Who) { /* every persona keeps its own signed-in browser context */ }

  await trade('T1 Kumar Cafe orders catering from Kedai Katering Lestari (revision, then complete)', 'B8', 'B1', { topic: 'Catering for 40 guests', qty: '40', msg: 'Hello, we need lunch catering for 40 guests at our cafe event. Do you have a menu and price?', reply: 'Terima kasih. We can do nasi lemak and rendang for 40. What date do you need?', item: 'Lunch set per person', unit: 'person', price: '18.00', scope: 'Lunch for 40 guests: nasi lemak, ayam rendang, kuih, drinks', ending: 'revise-complete' });
  await trade('T2 Priya Boutique orders uniforms from Mohan Tailoring (not delivered, issue reported)', 'B7', 'B3', { topic: 'Staff uniforms for the boutique', qty: '12', msg: 'We need 12 staff uniforms in maroon with our logo embroidered. Is that possible?', reply: 'Yes, we can. Please send the sizes and the logo file.', item: 'Staff uniform set', unit: 'set', price: '85.00', scope: '12 staff uniform sets in maroon with embroidered logo', ending: 'issue' });
  await trade('T3 Fatimah Online Store orders boxes from Wei Packaging (cancelled before work starts)', 'B9', 'B6', { topic: 'Mailer boxes for the online store', qty: '300', msg: 'Saya perlukan 300 kotak mailer untuk kedai dalam talian saya. Boleh beri harga?', reply: 'Boleh. Saiz dan bahan apa yang anda mahu?', item: 'Mailer box', unit: 'piece', price: '1.20', scope: '300 printed mailer boxes, 30 x 20 x 10 cm', ending: 'cancel' });
  await trade('T4 Wei Packaging (as buyer) asks Ahmad Cetak Digital for flyers (declined)', 'B6', 'B2', { topic: 'Flyers for a promotion', qty: '1000', msg: 'We want 1000 A5 flyers for a box promotion. Price and turnaround?', reply: 'We can print in 3 days. Do you have the artwork?', item: 'A5 flyer', unit: 'piece', price: '0.35', scope: '1000 A5 full-colour flyers', ending: 'decline' });
  await trade('T5 Raju Logistics (as buyer) asks Ahmad Cetak Digital for banners (conversation only)', 'B10', 'B2', { topic: 'Vehicle banners', qty: '4', msg: 'We need 4 banners for our vans. Can you advise on material?', reply: 'We recommend vinyl with eyelets. Send the van size please.', item: 'Banner', unit: 'piece', price: '60.00', scope: '4 vinyl banners', ending: 'silent' });
  await trade('T6 Kumar Cafe orders festival snack boxes from Sri Murugan Sweets (complete)', 'B8', 'B5', { topic: 'Deepavali snack boxes for customers', qty: '50', msg: 'We would like 50 snack boxes as Deepavali gifts for regular customers.', reply: 'Happy to help. We have three box sizes.', item: 'Festival snack box', unit: 'box', price: '25.00', scope: '50 festival snack boxes with murukku, laddu and halwa', ending: 'complete' });
  await trade('T7 Priya Boutique orders event decoration from Siti Dekorasi (complete)', 'B7', 'B4', { topic: 'Shop opening decoration', qty: '1', msg: 'We are opening a second boutique and want balloon and flower decoration.', reply: 'Congratulations! May we visit the shop first?', item: 'Opening decoration package', unit: 'package', price: '900.00', scope: 'Balloon arch and flower decoration for the shop opening', ending: 'complete' });

  // ---------------------------------------------------------------- D. what staff and everyone else see
  await tick('staff see exactly the one reported issue (read-only) and nothing about money', async () => {
    await staff.goto('/en/admin/issues');
    await QA(staff, 'sim', '98-issues', 'Staff read-only issue list');
    await expect(staff.getByTestId('issue-card').filter({ hasText: by('B7').name })).toHaveCount(1);
    await expect(staff.locator('main')).not.toContainText(/refund|paid|escrow/i);
  });
  await tick('the seller of the reported issue was told; others had no issue notification', async () => {
    const n = await sql<{ n: string }>(`select count(*) n from public.notifications where kind='order.disputed' and user_id=$1`, [who.B3!.user.id]);
    expect(Number(n[0]!.n)).toBe(1);
    expect(Number((await sql<{ n: string }>(`select count(*) n from public.notifications where kind='order.disputed' and user_id=$1`, [who.B1!.user.id]))[0]!.n)).toBe(0);
  });
  await tick('privacy: nobody can open another pair\'s conversation or agreement; strangers and visitors are turned away', async () => {
    const t1 = ids['T1 Kumar Cafe orders catering from Kedai Katering Lestari (revision, then complete)']!;
    const t2 = ids['T2 Priya Boutique orders uniforms from Mohan Tailoring (not delivered, issue reported)']!;
    for (const key of ['B9', 'B6', 'B10', 'B2']) {
      expect((await who[key]!.page.goto(`/en/enquiries/${t1.enq}`))?.status(), `${key} sees T1 enquiry`).toBe(404);
      expect((await who[key]!.page.goto(`/en/orders/${t1.order}`))?.status(), `${key} sees T1 order`).toBe(404);
    }
    expect((await who.B8!.page.goto(`/en/orders/${t2.order}`))?.status()).toBe(404); // another buyer
    expect((await who.B1!.page.goto(`/en/orders/${t2.order}`))?.status()).toBe(404); // another seller
    const anon = await (await browser.newContext()).newPage();
    await anon.goto(`/en/orders/${t1.order}`);
    await expect(anon).toHaveURL(/\/login/);
  });
  await tick('each business home and deals pages show only its own activity, in its own language, with no raw keys and no sideways scroll', async () => {
    for (const p of P) {
      const w = who[p.key]!;
      for (const route of ['', '/deals', '/orders', '/notifications']) {
        const resp = await w.page.goto(`/${p.lang}${route}`);
        expect(resp?.status(), `${p.key} ${route}`).toBeLessThan(400);
        const bad = await w.page.evaluate(() => /\b(?:deals|p4|p5|p6|p7|errors|adm)\.[a-zA-Z_]+\b/.test(document.body.innerText));
        expect(bad, `${p.key} ${route} shows an untranslated key`).toBe(false);
        expect(await w.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${p.key} ${route} overflow`).toBeLessThanOrEqual(1);
      }
    }
    // counts match the story
    const mine = async (k: string) => Number((await sql<{ n: string }>(`select count(*) n from public.orders where buyer_org_id=$1 or seller_org_id=$1`, [orgOf(who[k]!)]))[0]!.n);
    expect(await mine('B1')).toBe(1); expect(await mine('B3')).toBe(1); expect(await mine('B4')).toBe(1); expect(await mine('B5')).toBe(1); expect(await mine('B6')).toBe(1);
    expect(await mine('B2')).toBe(0); expect(await mine('B10')).toBe(0);
  });
  await tick('agreement totals and locked terms match what each buyer accepted', async () => {
    const rows = await sql<{ total: string; status: string; terms_locked: boolean; n: string }>(`select o.total::text total, o.status, o.terms_locked, 1 n from public.orders o join public.enquiries e on e.id=o.enquiry_id where e.topic in ('Catering for 40 guests','Staff uniforms for the boutique','Mailer boxes for the online store','Deepavali snack boxes for customers','Shop opening decoration') order by o.total`);
    expect(rows.map((r) => `${r.total}/${r.status}/${r.terms_locked}`)).toEqual(['360.00/cancelled/true', '720.00/completed/true', '1020.00/disputed/true', '1250.00/completed/true', '900.00/completed/true'].sort((a, b) => parseFloat(a) - parseFloat(b)));
    expect(await sql(`select count(*)::int n from public.orders where status::text in ('paid','secured','refunded')`)).toEqual([{ n: 0 }]);
  });

  // ---------------------------------------------------------------- report
  const out = path.resolve('docs/qa-evidence-simulation');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, `report-${info.project.name}.json`), JSON.stringify({ tag, project: info.project.name, businesses: P.map((p) => ({ key: p.key, name: p.name, kind: p.kind, lang: p.lang })), steps: log }, null, 1));
  await QA(staff, 'sim', '99-staff-issues', 'Staff issues list');
  for (const w of Object.values(w0())) await w.ctx.close();
  function w0() { return who; }
});

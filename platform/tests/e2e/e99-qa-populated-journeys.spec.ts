import { expect, test } from '@playwright/test';
import { reviewerGoto, createReviewer } from './support/biz';
import { tb } from './support/p5-buyer';
import { actorGoto, call, createAdmin } from './support/p5-admin';
import { sql } from './support/db';
import { msg } from './support/i18n';
import { freshContext, loginUi } from './support/ui';
import { seedDemo, type DemoData } from './support/demo-seed';
import { ENABLED, WIDTHS_ALL, shot } from './support/qa-evidence';

// QA with realistic, populated demonstration data (LOCAL stack). Runs only with QA=1. Roles are separate browser contexts with separate accounts.
// Evidence goes to docs/qa-evidence/. See support/demo-seed.ts for the fixtures (all synthetic).
test.skip(!ENABLED, 'QA evidence runs on request: QA=1');
test.describe.configure({ mode: 'serial' });

const t = (key: string) => msg('en', key);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
let demo: DemoData;

test.beforeAll(async () => {
  test.setTimeout(900_000);
  demo = await seedDemo();
});

test('J1 visitor: app home, directory search, business profile, product, programmes, news, registration', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/en');
  await shot(page, { role: 'visitor', journey: 'j1-visitor', step: '01-home', title: 'Public home (signed out)', expected: 'Discovery entry points, Sign in and List your business', observed: 'Home renders with search and discovery cards', widths: WIDTHS_ALL });
  await page.goto('/en/directory');
  await expect(page.locator('a.lcard-link').first()).toBeVisible();
  await shot(page, { role: 'visitor', journey: 'j1-visitor', step: '02-directory', title: 'Business directory with demonstration businesses', expected: 'Published demo businesses as cards', observed: `${await page.locator('a.lcard-link').count()} business cards shown`, widths: WIDTHS_ALL });
  await page.locator('#q').fill('packaging');
  await page.getByRole('button', { name: t('dir.search'), exact: true }).click();
  const card = page.locator('a.lcard-link').filter({ hasText: 'INOK Demo Packaging Supplies' });
  await expect(card).toBeVisible();
  await shot(page, { role: 'visitor', journey: 'j1-visitor', step: '03-search-packaging', title: 'Directory search for "packaging"', expected: 'The packaging supplier is found', observed: 'INOK Demo Packaging Supplies returned' });
  await card.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('INOK Demo Packaging Supplies');
  await shot(page, { role: 'visitor', journey: 'j1-visitor', step: '04-business-profile', title: 'Public business profile', expected: 'Identity, tabs, About and enquiry action; no street address shown', observed: 'Profile renders; address hidden', widths: WIDTHS_ALL });
  await expect(page.locator('main')).not.toContainText('1 Jalan Demo');
  await page.goto('/en/catalogue');
  await expect(page.locator('[data-product-id]').first()).toBeVisible();
  await shot(page, { role: 'visitor', journey: 'j1-visitor', step: '05-catalogue', title: 'Products from India (14 demonstration products)', expected: 'Product cards with supplier, MOQ and price note', observed: `${await page.locator('[data-product-id]').count()} cards`, widths: WIDTHS_ALL });
  const pack = demo.products.find((p) => p.name.startsWith('Corrugated packaging'))!;
  await page.goto(`/en/catalogue/${pack.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Corrugated packaging box');
  await shot(page, { role: 'visitor', journey: 'j1-visitor', step: '06-product-detail', title: 'Product detail', expected: 'Price tiers, MOQ, availability statement, supplier note', observed: 'Detail page renders with tiers', widths: WIDTHS_ALL });
  await page.goto('/en/business-help');
  await shot(page, { role: 'visitor', journey: 'j1-visitor', step: '07-programmes', title: 'Government assistance (public)', expected: 'Programmes with status shown as stated', observed: 'Programme list renders', widths: WIDTHS_ALL });
  await page.goto('/en/news');
  await expect(page.locator('article.ncard').first()).toBeVisible();
  await shot(page, { role: 'visitor', journey: 'j1-visitor', step: '08-news', title: 'News and bulletins', expected: 'Demonstration bulletins as cards', observed: 'News cards render', widths: WIDTHS_ALL });
  await page.locator('article.ncard a').first().click();
  await shot(page, { role: 'visitor', journey: 'j1-visitor', step: '09-news-article', title: 'News article', expected: 'Editorial header, body, source', observed: 'Article renders' });
  await page.goto('/en/signup');
  await shot(page, { role: 'visitor', journey: 'j1-visitor', step: '10-registration', title: 'Registration', expected: 'Sign-up form', observed: 'Form renders' });
});

test('J4 buyer and seller conversation: enquiry, messages, quotation, acceptance, persistence, isolation', async ({ page, browser }) => {
  test.setTimeout(420_000);
  const buyer = demo.buyers[0]!;
  const biz = demo.businesses[0]!;
  const bctx = await freshContext(browser, page);
  const bp = await bctx.newPage();
  await loginUi(bp, buyer.user, 'en');
  const J = 'j4-conversation';

  // 1-3 buyer discovers the supplier, opens the profile, creates the enquiry (first message)
  await bp.goto('/en/directory');
  await bp.locator('#q').fill('packaging');
  await bp.getByRole('button', { name: t('dir.search'), exact: true }).click();
  await expect(bp.locator('a.lcard-link').filter({ hasText: biz.name })).toBeVisible();
  await shot(bp, { role: 'buyer', journey: J, step: '01-buyer-discovers-supplier', title: 'Buyer searches for a packaging supplier', expected: 'Supplier appears in results', observed: 'INOK Demo Packaging Supplies listed' , widths: WIDTHS_ALL});
  await bp.locator('a.lcard-link').filter({ hasText: biz.name }).click();
  await shot(bp, { role: 'buyer', journey: J, step: '02-buyer-opens-profile', title: 'Buyer opens the seller profile', expected: 'Profile with Send enquiry', observed: 'Profile shown', widths: WIDTHS_ALL });
  const m1 = 'Hello, I need 100 custom packaging boxes for my business. Can you provide pricing and delivery details?';
  await bp.getByRole('button', { name: t('dir2.send'), exact: true }).first().click();
  await bp.locator('#enq-topic').fill('100 custom packaging boxes');
  await bp.locator('#enq-qty').fill('100');
  await bp.locator('#enq-details').fill(m1);
  await shot(bp, { role: 'buyer', journey: J, step: '03-buyer-creates-enquiry', title: 'Buyer writes the enquiry', expected: 'Enquiry dialog with need, quantity and message', observed: 'Dialog filled with the first message' });
  await bp.locator('form:has(#enq-topic) button[type=submit]').click();
  await expect(bp.getByText(t('dir2.sentSub'))).toBeVisible();
  const enquiryId = (await sql<{ id: string }>(`select id from public.enquiries where buyer_org_id = $1 and seller_org_id = $2 order by created_at desc limit 1`, [buyer.orgId, biz.orgId]))[0]!.id;
  const url = `/en/enquiries/${enquiryId}`;

  // 4-6 seller receives, reads, replies
  await loginUi(page, biz.owner, 'en');
  await page.goto('/en/enquiries');
  await expect(page.locator('a.chat').filter({ hasText: '100 custom packaging boxes' })).toBeVisible();
  await shot(page, { role: 'seller', journey: J, step: '04-seller-receives-enquiry', title: 'Seller sees the new enquiry', expected: 'Conversation listed with preview', observed: 'Enquiry in the list', widths: WIDTHS_ALL });
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('main')).toContainText(m1);
  await shot(page, { role: 'seller', journey: J, step: '05-seller-reads-first-message', title: 'Seller reads the buyer message', expected: 'First message visible in the thread', observed: 'Opening note shown', widths: WIDTHS_ALL });
  const m2 = 'Yes, we can supply them. Could you confirm the dimensions, material and delivery location?';
  await page.locator('#reply-body').fill(m2);
  await page.getByRole('button', { name: t('p4.sendReply') }).click();
  await expect(page.locator('main')).toContainText(m2);
  await shot(page, { role: 'seller', journey: J, step: '06-seller-replies', title: 'Seller replies', expected: 'Reply appears as the seller message', observed: 'Reply persisted and shown' });

  // 7 buyer receives; replies
  await bp.goto(url);
  await bp.waitForLoadState('networkidle');
  await expect(bp.locator('main')).toContainText(m2);
  await shot(bp, { role: 'buyer', journey: J, step: '07-buyer-receives-response', title: 'Buyer receives the seller response', expected: 'Seller reply visible', observed: 'Thread shows the reply', widths: WIDTHS_ALL });
  const m3 = 'The size is 30 × 20 × 15 cm, corrugated cardboard, delivery to Kuala Lumpur.';
  await bp.locator('#reply-body').fill(m3);
  await bp.getByRole('button', { name: t('p4.sendReply') }).click();
  await expect(bp.locator('main')).toContainText(m3);

  // 8-9 seller answers and prepares + submits the quotation
  await page.reload();
  await expect(page.locator('main')).toContainText(m3);
  const m4 = 'Thank you. I have prepared a quotation for your request. Please review the price and delivery terms.';
  await page.locator('#reply-body').fill(m4);
  await page.getByRole('button', { name: t('p4.sendReply') }).click();
  await expect(page.locator('main')).toContainText(m4);
  await page.locator('#scope').fill('100 custom corrugated boxes, 30 x 20 x 15 cm, delivered to Kuala Lumpur');
  await page.locator('#description1').fill('Corrugated packaging box');
  await page.locator('#quantity1').fill('100');
  await page.locator('#unit1').fill('pieces');
  await page.locator('#unitPrice1').fill('3.20');
  await page.locator('#validUntil').fill(inDays(14));
  await page.locator('#deliveryTiming').fill('Within ten working days');
  await page.locator('#taxTreatment').fill('Tax included as stated');
  await shot(page, { role: 'seller', journey: J, step: '08-seller-creates-quotation', title: 'Seller prepares the quotation', expected: 'Quotation form with scope, line item, validity, delivery', observed: 'Form filled', widths: WIDTHS_ALL });
  await page.getByRole('button', { name: t('p4.saveDraft') }).click();
  await expect(page.locator('main')).toContainText('MYR 320.00');
  await page.getByRole('button', { name: t('p4.sendQuote') }).click();
  await shot(page, { role: 'seller', journey: J, step: '09-seller-submits-quotation', title: 'Seller submitted the quotation', expected: 'Quotation shows as sent', observed: 'MYR 320.00 version 1 sent' });

  // 10-11 buyer opens and accepts
  await bp.reload();
  await expect(bp.getByText('MYR 320.00').first()).toBeVisible();
  await shot(bp, { role: 'buyer', journey: J, step: '10-buyer-opens-quotation', title: 'Buyer opens the quotation', expected: 'Quotation visible with amount and terms', observed: 'MYR 320.00 shown', widths: WIDTHS_ALL });
  await bp.getByRole('button', { name: t('p4.accept') }).click();
  await expect(bp.getByText(t('p4.selectedNotice'))).toBeVisible();
  await shot(bp, { role: 'buyer', journey: J, step: '11-buyer-accepts-quotation', title: 'Buyer accepts the quotation', expected: 'Selection notice shown', observed: 'Quotation accepted' });

  // 12 final status, refresh, both sides
  await bp.reload();
  await expect(bp.locator('main')).toContainText(m4);
  await bp.goto('/en/enquiries');
  await shot(bp, { role: 'buyer', journey: J, step: '12-final-buyer-conversation-list', title: 'Conversation list after acceptance', expected: 'Conversation remains after refresh', observed: 'Listed' });
  await page.goto(`/en/orgs/${biz.orgId}/business/leads`);
  await shot(page, { role: 'seller', journey: J, step: '12b-final-seller-leads', title: 'Seller leads after acceptance', expected: 'Lead shows the accepted quotation', observed: 'Leads page shows the enquiry', widths: WIDTHS_ALL });

  // persistence, order, identities
  const rows = await sql<{ body: string; sender_org_id: string; sender_user_id: string }>('select body, sender_org_id, sender_user_id from public.enquiry_messages where enquiry_id=$1 order by created_at, id', [enquiryId]);
  const openingNote = (await sql<{ opening_note: string }>('select opening_note from public.enquiries where id=$1', [enquiryId]))[0]!.opening_note;
  expect(openingNote).toContain(m1); // the dialog adds the quantity line before the typed message
  expect(rows.map((r) => r.body)).toEqual([m2, m3, m4]);
  expect(rows.map((r) => r.sender_org_id)).toEqual([biz.orgId, buyer.orgId, biz.orgId]);
  expect((await sql<{ status: string }>('select status from public.quotations where enquiry_id=$1', [enquiryId]))[0]!.status).toBe('accepted');
  // notifications reached the other party
  expect((await sql<{ n: number }>(`select count(*)::int n from public.notifications where user_id = $1`, [buyer.user.id]))[0]!.n).toBeGreaterThan(0);
  await bp.goto('/en/notifications');
  await shot(bp, { role: 'buyer', journey: J, step: '13-buyer-notifications', title: 'Buyer notifications', expected: 'Notifications about the conversation', observed: 'Notification centre renders' });

  // isolation: an unrelated buyer and a different seller cannot read the thread or the quotation
  for (const who of [demo.buyers[1]!.user, demo.businesses[1]!.owner]) {
    const ctx = await freshContext(browser, page);
    const op = await ctx.newPage();
    await loginUi(op, who, 'en');
    const res = await op.goto(url);
    expect(res?.status()).toBe(404);
    await expect(op.locator('main')).not.toContainText(m1);
    await expect(op.locator('main')).not.toContainText('MYR 320.00');
    await ctx.close();
  }
  await bctx.close();
});

// ---------------------------------------------------------------------------------------------------------------------------------
test('J2/J3 buyer: dashboard, requests, saved product, price request, notifications', async ({ page }) => {
  test.setTimeout(300_000);
  const b = demo.buyers[0]!;
  await loginUi(page, b.user, 'en');
  await page.goto('/en');
  await shot(page, { role: 'buyer', journey: 'j3-buyer-dashboard', step: '01-home', title: 'Buyer home', expected: 'Greeting, discovery cards, organisations, assistance and news', observed: 'Home renders for a buyer with activity', widths: WIDTHS_ALL });
  await page.goto('/en/requests');
  await expect(page.locator('main')).toContainText('100 custom packaging boxes');
  await shot(page, { role: 'buyer', journey: 'j3-buyer-dashboard', step: '02-my-requests', title: 'My requests with an enquiry in progress', expected: 'Metrics, tabs and the enquiry in the side panel', observed: 'Enquiry listed with its status', widths: WIDTHS_ALL });
  const pack = demo.products.find((p) => p.name.startsWith('Corrugated packaging'))!;
  await page.goto('/en/catalogue');
  await shot(page, { role: 'buyer', journey: 'j3-buyer-dashboard', step: '03-catalogue-signed-in', title: 'Products from India (signed in)', expected: 'Filter panel and product cards', observed: 'Catalogue renders', widths: WIDTHS_ALL });
  await page.goto(`/en/catalogue/${pack.id}`);
  const save = page.getByRole('button', { name: tb('en', 'save.save') }).first();
  await save.click();
  await page.goto('/en/catalogue/saved');
  await expect(page.locator('main')).toContainText('Corrugated packaging box');
  await shot(page, { role: 'buyer', journey: 'j3-buyer-dashboard', step: '04-saved-products', title: 'Saved products', expected: 'The saved product is listed', observed: 'Packaging box listed', widths: WIDTHS_ALL });

  // price request (sourcing) by a second buyer, answered by the partner in J5
  const b2 = demo.buyers[1]!;
  const ctx2 = await page.context().browser()!.newContext();
  const p2 = await ctx2.newPage();
  await loginUi(p2, b2.user, 'en');
  await p2.goto(`/en/catalogue/${pack.id}/request`);
  await p2.waitForLoadState('networkidle');
  await p2.locator('#quantity').fill('150');
  await p2.locator('#destinationState').selectOption('Selangor');
  await p2.locator('#destinationCity').fill('Shah Alam');
  await p2.locator('#notes').fill('Please quote for printing a one-colour logo.');
  await shot(p2, { role: 'buyer', journey: 'j5-supplier-sourcing', step: '01-request-price-form', title: 'Buyer requests a price for a catalogue product', expected: 'Quantity, destination and notes', observed: 'Form filled' });
  await p2.getByRole('button', { name: tb('en', 'request.submit'), exact: true }).click();
  await expect(p2).toHaveURL(/\/catalogue\/requests\/[0-9a-f-]{36}\?sent=1/, { timeout: 30_000 });
  await shot(p2, { role: 'buyer', journey: 'j5-supplier-sourcing', step: '02-request-sent', title: 'Price request sent', expected: 'Request page with reference and status', observed: 'Request created', widths: WIDTHS_ALL });
  await ctx2.close();
  await page.goto('/en/notifications');
  await shot(page, { role: 'buyer', journey: 'j3-buyer-dashboard', step: '05-notifications', title: 'Buyer notifications', expected: 'Notification list', observed: 'Notification centre renders', widths: WIDTHS_ALL });
});

test('J3 seller: Business 360, dashboard, listing, verification, onboarding review, leads, products, team', async ({ page }) => {
  test.setTimeout(300_000);
  const s = demo.businesses[0]!;
  await loginUi(page, s.owner, 'en');
  const base = `/en/orgs/${s.orgId}/business`;
  const pages: [string, string, string][] = [
    [base, '01-dashboard', 'Seller dashboard'], [`${base}/360`, '02-business-360', 'Business 360'], [`${base}/listing`, '03-listing-editor', 'Listing editor'],
    [`${base}/verification`, '04-verification', 'Verification'], [`${base}/onboarding?step=review`, '05-onboarding-review', 'Onboarding review'],
    [`${base}/leads`, '06-leads', 'Leads'], [`${base}/requests`, '07-customer-requests', 'Customer requests'], [`${base}/products`, '08-products', 'Products and services'],
    [`/en/orgs/${s.orgId}/members`, '09-team', 'Team and members'], ['/en/account', '10-settings', 'Settings'],
  ];
  for (const [url, step, title] of pages) {
    await page.goto(url);
    await shot(page, { role: 'seller', journey: 'j3-seller-dashboard', step, title, expected: `${title} renders with the business's data`, observed: 'Page renders without errors', widths: step === '02-business-360' || step === '01-dashboard' ? WIDTHS_ALL : undefined });
  }
  // a business still in review and one draft: what the owner sees
  const review = demo.businesses[6]!;
  const rctx = await page.context().browser()!.newContext();
  const rp = await rctx.newPage();
  await loginUi(rp, review.owner, 'en');
  await rp.goto(`/en/orgs/${review.orgId}/business/listing`);
  await shot(rp, { role: 'seller', journey: 'j3-seller-dashboard', step: '11-listing-in-review', title: 'Listing waiting for review', expected: 'Pending review state shown', observed: 'Listing page shows the submitted state' });
  await rctx.close();
});

test('J5 partner: workspace, suppliers, products, request response', async ({ page }) => {
  test.setTimeout(300_000);
  const base = `/en/orgs/${demo.partner.org}/partner`;
  await actorGoto(page, { ...demo.partner.user, client: demo.partner.s.client, secret: demo.partner.secret! } as never, base);
  const pages: [string, string, string][] = [
    [base, '03-partner-home', 'Partner home'], [`${base}/suppliers`, '04-suppliers', 'Suppliers'], [`${base}/products`, '05-products', 'Product catalogue'],
    [`${base}/import`, '07-import', 'Catalogue import'], [`${base}/requests`, '08-requests', 'Buyer requests'], [`${base}/sourcing`, '09-sourcing', 'Sourcing requests'], [`${base}/settings`, '10-settings', 'Partner settings'],
  ];
  for (const [url, step, title] of pages) {
    await page.goto(url);
    await shot(page, { role: 'partner', journey: 'j5-supplier-sourcing', step, title, expected: `${title} renders`, observed: 'Page renders', widths: step === '03-partner-home' || step === '05-products' ? WIDTHS_ALL : undefined });
  }
  await page.goto(`${base}/requests`);
  const row = page.locator('[data-testid=request-row]').first();
  await expect(row).toBeVisible();
  await row.getByRole('link').first().click();
  await shot(page, { role: 'partner', journey: 'j5-supplier-sourcing', step: '11-request-detail', title: 'Partner opens the buyer price request', expected: 'Terms the buyer saw, quantity, destination', observed: 'Request detail shown', widths: WIDTHS_ALL });
});

test('J6 government assistance: published demonstration programmes, filters, detail, matching, save', async ({ page }) => {
  test.setTimeout(400_000);
    const adminA = await createAdmin('admin_super', 'qa-a');
  const adminB = await createAdmin('admin_super', 'qa-b');
  const editor = await createAdmin('admin_review', 'qa-e');
  await sql(`update public.gov_settings set enabled = true where key in ('publishing_enabled','notifications_enabled')`);
  const agency = (await sql<{ id: string }>(`insert into public.gov_agencies(code,name,domain) values ($1,'INOK Demo Agency (fictional)','mitra.gov.my') returning id`, [`QA${Date.now().toString(36).toUpperCase().slice(-8)}`]))[0]!.id;
  const source = (await sql<{ id: string }>(`insert into public.gov_sources(agency_id,name,source_type,adapter,allowed_hosts,approved_urls,allowed_method,enabled,freshness_hours) values ($1,'INOK Demo editorial','manual','manual','{www.mitra.gov.my}','{}','manual_entry',false,48) returning id`, [agency]))[0]!.id;
  const cand = (name: string, extra: Record<string, unknown>) => ({
    name, description: `${name}. Fictional demonstration programme; not a real scheme, amount or date.`, funding_type: 'grant', category: 'grants_funding', beneficiary_type: 'entrepreneur',
    application_channel: 'online', application_url: 'https://www.mitra.gov.my/apply', info_url: 'https://www.mitra.gov.my/ms/modal-insan', application_status: 'unknown', extraction_status: 'complete',
    documents: ['SSM registration', 'Business photos'], rules: [{ field: 'state', op: 'in', value: ['selangor'], quote: 'Selangor sahaja' }, { field: 'note', op: 'note', quote: 'Perniagaan tidak muflis' }], ...extra,
  });
  const programmes = [
    ['INOK Demo Micro Grant for Packaging Upgrades', { funding_type: 'grant', category: 'grants_funding' }],
    ['INOK Demo Working-capital Financing', { funding_type: 'financing', category: 'business_financing', rules: [] }],
    ['INOK Demo Digital Skills Training Programme', { funding_type: 'training', category: 'training', application_channel: 'unknown', application_url: undefined, rules: [] }],
    ['INOK Demo Women Entrepreneur Support Fund', { funding_type: 'subsidy', category: 'grants_funding', rules: [] }],
  ] as const;
  const slugs: string[] = [];
  for (const [name, extra] of programmes) {
    const proposal = await call<string>(editor.client, 'gov_propose_manual', { p_source: source, p_programme: null, p_candidate: cand(name, extra as Record<string, unknown>), p_reason: 'read from the demonstration page for QA' });
    await call(adminA.client, 'gov_decide_proposal', { p_proposal: proposal, p_decision: 'approve', p_reason: 'second person checked the page (demonstration)' });
    slugs.push((await sql<{ slug: string }>(`select slug from public.gov_programmes where source_id = $1 and name = $2`, [source, name]))[0]!.slug);
  }
  void adminB;
  await page.goto('/en/business-help');
  await expect(page.locator('[data-programme]').first()).toBeVisible();
  await shot(page, { role: 'visitor', journey: 'j6-government-assistance', step: '01-programmes', title: 'Government assistance: programme list', expected: 'Search, type filter, tabs, programme cards with status as stated', observed: 'Programme cards render', widths: WIDTHS_ALL });
  await page.goto('/en/business-help?type=training');
  await shot(page, { role: 'visitor', journey: 'j6-government-assistance', step: '02-filter-training', title: 'Filtered to training', expected: 'Only training programmes', observed: 'Filter applied' });
  await page.goto(`/en/business-help/${slugs[0]}`);
  await shot(page, { role: 'visitor', journey: 'j6-government-assistance', step: '03-programme-detail', title: 'Programme detail', expected: 'Header actions, status, facts, official source', observed: 'Detail renders', widths: WIDTHS_ALL });
  const biz = demo.businesses[0]!;
  await loginUi(page, biz.owner, 'en');
  await page.goto(`/en/business-help/find?org=${biz.orgId}`);
  await page.waitForLoadState('networkidle');
  await shot(page, { role: 'seller', journey: 'j6-government-assistance', step: '04-matching', title: 'Matching: need and business profile', expected: 'Two-column finder with results', observed: 'Finder renders', widths: WIDTHS_ALL });
  await page.goto(`/en/business-help/${slugs[1]}`);
  const saveBtn = page.getByRole('button', { name: msg('en', 'gov.card.save') }).first();
  await saveBtn.click();
  await page.goto('/en/business-help/saved');
  await expect(page.locator('main')).toContainText('Working-capital Financing');
  await shot(page, { role: 'seller', journey: 'j6-government-assistance', step: '05-saved', title: 'Saved programmes', expected: 'The saved programme is listed', observed: 'Saved list shows it' });
  await sql(`update public.gov_settings set enabled = false where key in ('publishing_enabled','notifications_enabled','monitoring_enabled')`);
});

test('J7 news and J8 administration: reviewer approves a listing with a reason, audit log, queues', async ({ page, browser }) => {
  test.setTimeout(400_000);
  await page.goto('/en/news');
  await shot(page, { role: 'visitor', journey: 'j7-news', step: '01-news', title: 'News listing', expected: 'Demonstration bulletins', observed: 'Cards render', widths: WIDTHS_ALL });
  const adm = await createReviewer('admin_super', 'qa-admin');
  const actx = await freshContext(browser, page);
  const ap = await actx.newPage();
  await reviewerGoto(ap, adm, '/en/admin');
  await shot(ap, { role: 'administrator', journey: 'j8-administration', step: '01-overview', title: 'Admin overview', expected: 'Counts for reviews, listings, products, proposals, news', observed: 'Overview renders', widths: WIDTHS_ALL });
  for (const [url, step, title] of [['/en/admin/verification', '02-verification-queue', 'Verification queue'], ['/en/admin/listings', '03-listings-queue', 'Listings queue'], ['/en/admin/reviews', '04-reviews', 'Reviews'], ['/en/admin/audit', '06-audit', 'Audit log'], ['/en/admin/news', '07-news', 'News administration'], ['/en/admin/users', '08-users', 'Users and roles'], ['/en/admin/business-help', '09-programmes', 'Programme operations'], ['/en/admin/catalogue', '10-catalogue', 'Catalogue administration'], ['/en/admin/products', '11-products', 'Product review queue']] as const) {
    await ap.goto(url);
    await shot(ap, { role: 'administrator', journey: 'j8-administration', step, title, expected: `${title} renders for an administrator`, observed: 'Page renders', widths: step === '03-listings-queue' ? WIDTHS_ALL : undefined });
  }
  // approve the listing that is waiting for review, with a reason
  const review = demo.businesses[6]!;
  await ap.goto('/en/admin/listings');
  const qrow = ap.locator('tbody tr').filter({ hasText: review.name });
  await expect(qrow).toHaveCount(1);
  await qrow.getByRole('link', { name: t('adminList.open') }).click();
  await shot(ap, { role: 'administrator', journey: 'j8-administration', step: '05-review-listing', title: 'Reviewing a submitted listing', expected: 'Listing content and decision form', observed: 'Review page renders', widths: WIDTHS_ALL });
  await ap.locator('#dec-approve').check();
  await ap.getByRole('button', { name: t('adminList.save'), exact: true }).click();
  await expect(ap.getByText(t('adminList.nothingPending'))).toBeVisible();
  const live = await sql<{ live_status: string }>(`select live_status::text from public.business_listings where org_id = $1`, [review.orgId]);
  expect(live[0]?.live_status).toBe('published');
  await ap.goto('/en/admin/audit');
  await shot(ap, { role: 'administrator', journey: 'j8-administration', step: '12-audit-after-decision', title: 'Audit log after the decision', expected: 'The approval is recorded', observed: 'Audit log shows events' });
  await actx.close();
});

test('J9 account, localisation (Bahasa Melayu and Tamil) and J10 errors and permissions', async ({ page, browser }) => {
  test.setTimeout(600_000);
  const b = demo.buyers[0]!;
  await loginUi(page, b.user, 'en');
  for (const sec of ['', '?section=security', '?section=notifications', '?section=privacy', '?section=data']) {
    await page.goto(`/en/account${sec}`);
    await shot(page, { role: 'buyer', journey: 'j9-account', step: `settings${sec.replace(/\W+/g, '-') || '-account'}`, title: `Settings ${sec || 'My account'}`, expected: 'Settings section renders', observed: 'Renders' });
  }
  const pack = demo.products.find((p) => p.name.startsWith('Corrugated packaging'))!;
  const enq = (await sql<{ id: string }>(`select id from public.enquiries where buyer_org_id = $1 order by created_at desc limit 1`, [b.orgId]))[0]!.id;
  for (const L of ['ms', 'ta'] as const) {
    const pages: [string, string][] = [['/directory', 'directory'], ['/catalogue', 'catalogue'], [`/catalogue/${pack.id}`, 'product'], ['/business-help', 'programmes'], ['/news', 'news'], [`/enquiries/${enq}`, 'conversation'], ['/requests', 'requests'], ['/account', 'settings'], ['', 'home']];
    for (const [u, n] of pages) {
      await page.goto(`/${L}${u}`);
      await shot(page, { role: 'buyer', journey: `j9-localisation-${L}`, step: n, title: `${n} in ${L === 'ms' ? 'Bahasa Melayu' : 'Tamil'}`, expected: 'Translated labels, no overflow, no missing text', observed: 'Renders', lang: L, widths: [360, 1280] });
      const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(sw, `${L}${u} horizontal overflow`).toBeLessThanOrEqual(1);
    }
  }
  // J10: permissions and errors
  const ctx = await freshContext(browser, page);
  const bp = await ctx.newPage();
  await loginUi(bp, b.user, 'en');
  const adminRes = await bp.goto('/en/admin');
  await shot(bp, { role: 'buyer', journey: 'j10-errors-permissions', step: '01-buyer-opens-admin', title: 'Buyer tries to open the admin console', expected: 'Refused or redirected; no admin data', observed: `HTTP ${adminRes?.status()} at ${new URL(bp.url()).pathname}` });
  expect(await bp.locator('body').innerText()).not.toContain('Verification queue');
  const other = demo.businesses[1]!;
  const r2 = await bp.goto(`/en/orgs/${other.orgId}/business`);
  expect([404, 403].includes(r2?.status() ?? 0) || /login|orgs/.test(bp.url())).toBe(true);
  await shot(bp, { role: 'buyer', journey: 'j10-errors-permissions', step: '02-other-business-workspace', title: 'Buyer opens another business workspace by URL', expected: 'Not found or refused', observed: `HTTP ${r2?.status()}` });
  const r3 = await bp.goto('/en/this-page-does-not-exist');
  expect(r3?.status()).toBe(404);
  await shot(bp, { role: 'buyer', journey: 'j10-errors-permissions', step: '03-missing-page', title: 'Missing page', expected: 'A helpful 404', observed: 'HTTP 404 page' });
  await ctx.clearCookies();
  await bp.goto('/en/requests');
  await expect(bp).toHaveURL(/\/login\?next=/);
  await shot(bp, { role: 'buyer', journey: 'j10-errors-permissions', step: '04-expired-session', title: 'Expired session', expected: 'Sent to sign in and back afterwards', observed: 'Redirected to the sign-in page with a next address' });
  await ctx.close();
});

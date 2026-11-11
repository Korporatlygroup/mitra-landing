import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createBusinessOwner, createReviewer, onboardUi, orgPath, reviewerGoto } from './support/biz';
import { createUser, signedClient, sql, uniq } from './support/db';
import { msg } from './support/i18n';
import { expectNoHorizontalScroll, freshContext, loginUi, logoutUi } from './support/ui';

// E40: Phase 3 end to end. A seller publishes through MITRA review, a buyer finds the business and posts a request,
// invites the seller, the seller answers, and an enquiry persists. Isolation is checked from other accounts.

const t = (k: string, v?: Record<string, string>) => msg('en', k, v);
const tt = (k: string, v?: Record<string, string>) => msg('ta', k, v);

async function axe(page: Page, label: string) {
  await page.waitForLoadState('networkidle');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const summary = bad.map((v) => `${v.id} [${v.impact}]: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`).join('\n');
  expect(bad, `axe serious/critical on ${label}:\n${summary}`).toEqual([]);
  await expectNoHorizontalScroll(page);
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test('E40 seller publishes, buyer posts a request and invites, seller replies, enquiry persists', async ({ page, browser }) => {
  test.setTimeout(420_000);
  const tag = uniq('p3').replace(/-/g, '');
  const bizName = `Uniform ${tag}`;
  const reqTitle = `100 custom uniforms ${tag}`;
  const phone = '+60 3 9999 0000';

  // ---------------- seller: onboarding, listing editor, send for review ----------------
  const seller = await createBusinessOwner('p3s');
  await loginUi(page, seller.owner, 'en');
  await onboardUi(page, 'en', seller.orgId, {
    name: bizName,
    category: 'tailoring-apparel',
    registered: false,
    state: 'Selangor',
    district: 'Petaling',
    address: '12 Jalan Rahsia Satu',
    postcode: '47301',
  });

  await page.goto(orgPath('en', seller.orgId, '/listing'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('listing.title'));
  await page.locator('#headline').fill('Custom uniforms for restaurants and shops');
  await page.locator('#description').fill('We make custom uniforms and aprons for restaurants, schools and shops across Selangor.');
  await page.locator('#show_phone').check();
  await page.locator('#public_phone').fill(phone);
  await page.locator('#svc_name_0').fill(`Custom uniforms ${tag}`);
  await page.locator('#svc_cat_0').selectOption('tailoring-apparel');
  await expect(page.locator('#svc_areas_0_Selangor')).toBeChecked();
  await page.locator('summary', { hasText: t('listing.svcMore') }).first().click();
  await page.locator('#svc_minqty_0').fill('50');
  await page.locator('#svc_unit_0').fill('pcs');
  await page.locator('#svc_lead_0').fill('14');
  await page.locator('#pf_title_0').fill('Restaurant staff uniforms');
  await page.getByRole('button', { name: t('listing.save'), exact: true }).click();
  await expect(page.getByText(t('listing.saved'))).toBeVisible();

  // Nothing is public yet.
  const anon = await freshContext(browser, page);
  const ap = await anon.newPage();
  await ap.goto('/en/directory');
  await ap.locator('#q').fill(tag);
  await ap.getByRole('button', { name: t('dir.search'), exact: true }).click();
  await expect(ap.getByRole('heading', { name: t('dir.noneTitle') })).toBeVisible();
  await expect(ap.locator('main')).toContainText(t('dir.noneBody'));

  await page.getByRole('button', { name: t('listing.send'), exact: true }).click();
  await expect(page.getByRole('heading', { name: t('listing.pendingTitle') })).toBeVisible();

  // ---------------- admin: review and approve ----------------
  const rv = await createReviewer('admin_review');
  const adminCtx = await freshContext(browser, page);
  const admin = await adminCtx.newPage();
  await reviewerGoto(admin, rv, '/en/admin/listings');
  const qrow = admin.locator('tbody tr').filter({ hasText: bizName });
  await expect(qrow).toHaveCount(1);
  await qrow.getByRole('link', { name: t('adminList.open') }).click();
  await expect(admin.getByRole('heading', { level: 1 })).toHaveText(bizName);
  await expect(admin.locator('main')).not.toContainText('12 Jalan Rahsia Satu');
  await expect(admin.locator('main')).not.toContainText('47301');
  await admin.locator('#dec-approve').check();
  await admin.getByRole('button', { name: t('adminList.save'), exact: true }).click();
  await expect(admin.getByText(t('adminList.nothingPending'))).toBeVisible();

  // ---------------- buyer: anonymous search finds the business ----------------
  await ap.goto('/en/directory');
  await ap.locator('#q').fill(tag);
  await ap.getByRole('button', { name: t('dir.search'), exact: true }).click();
  const card = ap.locator('li.card').filter({ hasText: bizName });
  await expect(card).toBeVisible();
  await expect(card).toContainText(t('dir.notReviewed'));
  await expectNoHorizontalScroll(ap);
  await card.getByRole('link', { name: bizName }).click();
  await expect(ap.getByRole('heading', { level: 1 })).toHaveText(bizName);
  await expect(ap.locator('main')).toContainText(phone);
  await expect(ap.locator('main')).toContainText(t('dir.reviewLimit'));
  await expect(ap.locator('main')).not.toContainText('12 Jalan Rahsia Satu');
  await expect(ap.locator('main')).not.toContainText('47301');
  await axe(ap, 'public profile');

  // ---------------- buyer: posts a request through the wizard ----------------
  const buyer = await createUser('p3b', { name: 'Buyer P3' });
  await loginUi(ap, buyer, 'en');
  await ap.goto('/en/requests/new');
  await axe(ap, 'wizard step 1');
  await ap.locator('#title').fill(reqTitle);
  await ap.locator('#category_slug').selectOption('tailoring-apparel');
  await ap.getByRole('button', { name: t('ob.next'), exact: true }).click();
  await expect(ap).toHaveURL(/step=2&id=/);
  await ap.locator('#target_state').selectOption('Selangor');
  await ap.locator('#target_district').fill('Subang Jaya');
  await ap.getByRole('button', { name: t('ob.next'), exact: true }).click();
  await expect(ap).toHaveURL(/step=3&id=/);
  await ap.locator('#quantity').fill('100');
  await ap.locator('#unit').fill('pcs');
  await ap.locator('#needed_by').fill(inDays(21));
  await ap.getByRole('button', { name: t('ob.next'), exact: true }).click();
  await expect(ap).toHaveURL(/step=4&id=/);
  await ap.locator('#description').fill('Black polo shirts with an embroidered logo, mixed sizes, delivered to Subang Jaya.');
  await ap.locator('#contact_phone').fill('0123456789');
  await ap.locator('#share_contact').check();
  await ap.getByRole('button', { name: t('ob.next'), exact: true }).click();
  await expect(ap).toHaveURL(/step=5&id=/);
  await expect(ap.locator('main')).toContainText(reqTitle);
  await ap.getByRole('button', { name: t('req.s5.send'), exact: true }).click();
  await expect(ap).toHaveURL(/\/requests\/[0-9a-f-]{36}\?sent=1/);
  const requestId = ap.url().match(/requests\/([0-9a-f-]{36})/)![1]!;

  // ---------------- matching explains itself, then the buyer invites ----------------
  const match = ap.locator('[data-testid=match-card]').filter({ hasText: bizName });
  await expect(match).toBeVisible();
  await expect(match).toContainText(t('match.reason.serves_state'));
  await expect(match).toContainText(t('match.reason.min_order_ok'));
  await expect(match).toContainText(t('match.status.candidate'));
  await axe(ap, 'request detail with matches');
  await match.getByRole('button', { name: t('match.invite'), exact: true }).click();
  await expect(ap.locator('[data-testid=match-card]').filter({ hasText: bizName })).toContainText(t('match.status.invited'));

  // ---------------- seller: inbox, view, reply ----------------
  const sctx = await freshContext(browser, page);
  const sp = await sctx.newPage();
  await loginUi(sp, seller.owner, 'en');
  await sp.goto(orgPath('en', seller.orgId, '/requests'));
  const row = sp.locator('[data-testid=inbox-row]').filter({ hasText: reqTitle });
  await expect(row).toBeVisible();
  await expect(row).toContainText(t('inbox.status.invited'));
  await axe(sp, 'seller inbox');
  await row.getByRole('link', { name: reqTitle }).click();
  await expect(sp.locator('main')).toContainText('embroidered logo');
  await expect(sp.locator('main')).not.toContainText('0123456789'); // contact only after the seller replies
  await sp.locator('#note-i').fill('We can do this in three weeks.');
  await sp.getByRole('button', { name: t('inbox.interested'), exact: true }).click();
  await expect(sp.getByRole('link', { name: t('match.openEnquiry') })).toBeVisible();
  await expect(sp.locator('main')).toContainText('0123456789'); // buyer allowed it, and the seller has now replied
  await expect(sp.locator('main')).toContainText(t('inbox.status.interested'));

  // ---------------- buyer: signs out and in again; everything persisted ----------------
  await logoutUi(ap);
  await loginUi(ap, buyer, 'en');
  await ap.goto('/en/requests');
  await expect(ap.locator('li.card').filter({ hasText: reqTitle }).filter({ hasText: t('req.counts', { invited: '1', interested: '1', declined: '0' }) })).toHaveCount(1);
  await expect(ap.locator('li.card').filter({ hasText: reqTitle }).filter({ hasText: t('enq.statuses.open') })).toHaveCount(2); // the request and its enquiry both persist
  await ap.goto(`/en/requests/${requestId}`);
  const mc = ap.locator('[data-testid=match-card]').filter({ hasText: bizName });
  await expect(mc).toContainText(t('match.status.interested'));
  await expect(mc).toContainText('We can do this in three weeks.');
  await mc.getByRole('link', { name: t('match.openEnquiry') }).click();
  await expect(ap).toHaveURL(/\/enquiries\/[0-9a-f-]{36}/);
  await expect(ap.getByRole('heading', { level: 1 })).toHaveText(reqTitle);
  await expect(ap.locator('main')).toContainText('We can do this in three weeks.');
  await expect(ap.getByRole('heading', { name: t('p4.conversation') })).toBeVisible();

  const db = await sql<{ status: string; enquiry_id: string | null }>(
    `select status::text, enquiry_id from public.request_seller_matches where request_id = $1 and seller_org_id = $2`,
    [requestId, seller.orgId],
  );
  expect(db[0]?.status).toBe('interested');
  expect(db[0]?.enquiry_id).toBeTruthy();
  expect(Number((await sql(`select count(*)::int as n from public.enquiries where buyer_request_id = $1`, [requestId]))[0]!.n)).toBe(1);

  // ---------------- isolation from other accounts ----------------
  const other = await createBusinessOwner('p3o');
  const octx = await freshContext(browser, page);
  const op = await octx.newPage();
  await loginUi(op, other.owner, 'en');
  const res = await op.goto(orgPath('en', other.orgId, `/requests/${requestId}`));
  expect(res?.status()).toBe(404);
  const res2 = await op.goto(orgPath('en', seller.orgId, `/requests/${requestId}`)); // another organisation's inbox
  expect(res2?.status()).toBe(404);
  const res3 = await op.goto(`/en/requests/${requestId}`); // not the buyer
  expect(res3?.status()).toBe(404);

  const actx = await freshContext(browser, page);
  const anonPage = await actx.newPage();
  await anonPage.goto(`/en/requests/${requestId}`);
  await expect(anonPage).toHaveURL(/\/en\/login/);
  await anonPage.goto('/en/admin/listings');
  await expect(anonPage).toHaveURL(/\/en\/login/);

  // The same API, called directly with the other seller's token, is refused too.
  const s = await signedClient(other.owner);
  const direct = await s.client.rpc('get_request_for_seller', { p_request: requestId, p_seller_org: other.orgId });
  expect(direct.error?.code).toBe('PT404');
  const rows = await s.client.from('buyer_requests').select('id').eq('id', requestId);
  expect(rows.data ?? []).toEqual([]);

  // ---------------- Tamil, same journey surfaces ----------------
  await ap.goto('/ta/directory');
  await expect(ap.getByRole('heading', { level: 1 })).toHaveText(tt('dir.title'));
  await expectNoHorizontalScroll(ap);
  await ap.goto('/ta/requests/new');
  await expect(ap.getByRole('heading', { level: 1 })).toHaveText(tt('req.s1.title'));
  await axe(ap, 'wizard step 1 (ta)');
  await ap.goto(`/ta/requests/${requestId}`);
  await expect(ap.locator('main')).toContainText(tt('match.status.interested'));
  await axe(ap, 'request detail (ta)');
  await sp.goto(orgPath('ta', seller.orgId, '/requests'));
  await expect(sp.getByRole('heading', { level: 1 })).toHaveText(tt('inbox.title'));
  await axe(sp, 'seller inbox (ta)');
  await sp.goto(orgPath('ta', seller.orgId, '/listing'));
  await expect(sp.getByRole('heading', { level: 1 })).toHaveText(tt('listing.title'));
  await axe(sp, 'listing editor (ta)');
});

test('E41 moderation: changes requested, resubmitted, approved, then suspended and hidden', async ({ page, browser }) => {
  test.setTimeout(420_000);
  const tag = uniq('mod').replace(/-/g, '');
  const bizName = `Moderated ${tag}`;
  const seller = await createBusinessOwner('p3m');
  const sc = await signedClient(seller.owner);
  const prof = await sc.client.rpc('save_business_profile', {
    p_org: seller.orgId,
    p_data: { business_name: bizName, category_slug: 'food-beverage', registration_status: 'unregistered', state: 'Johor', district: 'Skudai' },
  });
  expect(prof.error).toBeNull();
  const draft = {
    headline: 'Catering for small events',
    description: 'Home-style catering for birthdays and small company events in Johor Bahru.',
    show_phone: false,
    show_email: false,
    services: [{ name: 'Event catering', category_slug: 'food-beverage', nationwide: false, areas: ['Johor'], min_order_qty: null, min_order_unit: null, lead_time_days: '3' }],
    portfolio: [],
  };
  expect((await sc.client.rpc('save_listing_draft', { p_org: seller.orgId, p_data: draft, p_expected_version: 0 })).error).toBeNull();
  expect((await sc.client.rpc('submit_listing', { p_org: seller.orgId, p_expected_version: 1 })).error).toBeNull();

  const rv = await createReviewer('admin_review');
  await reviewerGoto(page, rv, `/en/admin/listings/${seller.orgId}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(bizName);
  // A decision without a reason is refused in plain language.
  await page.locator('#dec-request_changes').check();
  await page.getByRole('button', { name: t('adminList.save'), exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: t('errors.reason_required') })).toBeVisible();
  await page.locator('#reason').fill('Please add your opening hours.');
  await page.getByRole('button', { name: t('adminList.save'), exact: true }).click();
  await expect(page.getByText(t('adminList.nothingPending'))).toBeVisible();

  // The seller sees the status and the reason; the page is still not public.
  const sctx = await freshContext(browser, page);
  const sp = await sctx.newPage();
  await loginUi(sp, seller.owner, 'en');
  await sp.goto(orgPath('en', seller.orgId, '/listing'));
  await expect(sp.locator('main')).toContainText(t('listing.review.changes_requested'));
  await expect(sp.locator('main')).toContainText('Please add your opening hours.');
  await expect(sp.locator('main')).toContainText(t('listing.live.unpublished'));

  // Fix, resubmit, approve.
  const v = Number((await sql(`select draft_version from public.business_listings where org_id = $1`, [seller.orgId]))[0]!.draft_version);
  expect((await sc.client.rpc('save_listing_draft', { p_org: seller.orgId, p_data: { description: `${draft.description} Open 9am to 6pm.` }, p_expected_version: v })).error).toBeNull();
  expect((await sc.client.rpc('submit_listing', { p_org: seller.orgId, p_expected_version: v + 1 })).error).toBeNull();
  await page.goto(`/en/admin/listings/${seller.orgId}`);
  await page.locator('#dec-approve').check();
  await page.getByRole('button', { name: t('adminList.save'), exact: true }).click();
  await expect(page.getByText(t('adminList.nothingPending'))).toBeVisible();

  const pub = await freshContext(browser, page);
  const pp = await pub.newPage();
  await pp.goto(`/en/directory?q=${encodeURIComponent(bizName)}`);
  await expect(pp.locator('li.card').filter({ hasText: bizName })).toBeVisible();

  // Editing the live page keeps the approved version public until re-approved.
  const v2 = Number((await sql(`select draft_version from public.business_listings where org_id = $1`, [seller.orgId]))[0]!.draft_version);
  expect((await sc.client.rpc('save_listing_draft', { p_org: seller.orgId, p_data: { headline: 'A brand new headline that is not reviewed' }, p_expected_version: v2 })).error).toBeNull();
  await pp.reload();
  await expect(pp.locator('li.card').filter({ hasText: bizName })).toContainText('Catering for small events');
  await expect(pp.locator('li.card').filter({ hasText: bizName })).not.toContainText('A brand new headline');

  // Suspend from the admin page; the public listing disappears and the seller is told.
  await page.goto(`/en/admin/listings/${seller.orgId}`);
  await page.locator('#sreason').fill('Photos are not the business\'s own.');
  await page.getByRole('button', { name: t('adminList.suspend'), exact: true }).click();
  await expect(page.getByRole('heading', { name: t('adminList.reinstateTitle') })).toBeVisible();
  await pp.reload();
  await expect(pp.getByRole('heading', { name: t('dir.noneTitle') })).toBeVisible();
  await sp.goto(orgPath('en', seller.orgId, '/listing'));
  await expect(sp.locator('main')).toContainText(t('listing.live.suspended'));
  await expect(sp.locator('main')).toContainText('Photos are not the business');
  const events = await sql<{ event: string }>(`select event from public.listing_events where org_id = $1 order by id`, [seller.orgId]);
  expect(events.map((e) => e.event)).toEqual(['submitted', 'changes_requested', 'submitted', 'approved', 'suspended']);
  await axe(page, 'admin listing review');
});

test('E42 no match, decline, reports and request moderation', async ({ page, browser }) => {
  test.setTimeout(420_000);
  const tag = uniq('rep').replace(/-/g, '');
  const bizName = `Reported ${tag}`;
  const seller = await createBusinessOwner('p3r');
  const sc = await signedClient(seller.owner);
  expect(
    (await sc.client.rpc('save_business_profile', { p_org: seller.orgId, p_data: { business_name: bizName, category_slug: 'food-beverage', registration_status: 'unregistered', state: 'Johor', district: 'Skudai' } })).error,
  ).toBeNull();
  const draft = {
    headline: 'Catering for small events',
    description: 'Home-style catering for birthdays and small company events in Johor Bahru.',
    services: [{ name: 'Event catering', category_slug: 'food-beverage', nationwide: false, areas: ['Johor'] }],
  };
  expect((await sc.client.rpc('save_listing_draft', { p_org: seller.orgId, p_data: draft, p_expected_version: 0 })).error).toBeNull();
  expect((await sc.client.rpc('submit_listing', { p_org: seller.orgId, p_expected_version: 1 })).error).toBeNull();

  const rv = await createReviewer('admin_super');
  await reviewerGoto(page, rv, `/en/admin/listings/${seller.orgId}`);
  await page.locator('#dec-approve').check();
  await page.getByRole('button', { name: t('adminList.save'), exact: true }).click();
  await expect(page.getByText(t('adminList.nothingPending'))).toBeVisible();
  const slug = String((await sql(`select slug from public.business_listings where org_id = $1`, [seller.orgId]))[0]!.slug);

  // buyer: a request nobody matches
  const buyer = await createUser('p3rb', { name: 'Buyer Reports' });
  const bs = await signedClient(buyer);
  const mk = async (key: string, title: string, cat: string, state: string) => {
    const org = await bs.client.rpc('create_org', { p_type: 'buyer', p_name: `Buyer org ${key}` });
    expect(org.error).toBeNull();
    const d = await bs.client.rpc('save_request_draft', {
      p_org: org.data as string,
      p_request: null,
      p_key: key,
      p_data: { title, category_slug: cat, description: 'We need this done properly and soon, please reply.', target_state: state, contact_email: 'buyer@example.test' },
      p_expected_version: 0,
    });
    expect(d.error).toBeNull();
    const s = await bs.client.rpc('submit_request', { p_request: d.data.id, p_expected_version: d.data.version });
    expect(s.error).toBeNull();
    return String(d.data.id);
  };
  const noMatchId = await mk(`k-${tag}-1`, `Tractor repair ${tag}`, 'agriculture', 'Kedah');
  const bctx = await freshContext(browser, page);
  const bp = await bctx.newPage();
  await loginUi(bp, buyer, 'en');
  await bp.goto(`/en/requests/${noMatchId}`);
  await expect(bp.locator('main')).toContainText(t('match.noneTitle'));
  await expect(bp.locator('main')).toContainText(t('match.noneBody'));
  await bp.getByRole('button', { name: t('match.widen'), exact: true }).click();
  await expect(bp.getByText(t('req.foundNone'))).toBeVisible();
  await bp.getByRole('button', { name: t('req.withdraw'), exact: true }).click();
  await expect(bp.locator('main')).toContainText(t('req.status.withdrawn'));

  // a request that matches; the seller declines
  const reqId = await mk(`k-${tag}-2`, `Catering for 80 guests ${tag}`, 'food-beverage', 'Johor');
  await bp.goto(`/en/requests/${reqId}`);
  await bp.locator('[data-testid=match-card]').filter({ hasText: bizName }).getByRole('button', { name: t('match.invite'), exact: true }).click();
  await expect(bp.locator('[data-testid=match-card]').filter({ hasText: bizName })).toContainText(t('match.status.invited'));
  const sctx = await freshContext(browser, page);
  const sp = await sctx.newPage();
  await loginUi(sp, seller.owner, 'en');
  await sp.goto(orgPath('en', seller.orgId, `/requests/${reqId}`));
  await expect(sp.locator('main')).not.toContainText('buyer@example.test'); // buyer did not allow sharing
  // report the request as abusive, then decline it
  await sp.locator('summary', { hasText: t('rep.open') }).click();
  await sp.locator('#reason').selectOption('scam');
  await sp.locator('#rnote').fill('Asked for a deposit by phone.');
  await sp.getByRole('button', { name: t('rep.send'), exact: true }).click();
  await expect(sp.getByText(t('rep.sent'))).toBeVisible();
  await sp.locator('#note-d').fill('Fully booked that week.');
  await sp.getByRole('button', { name: t('inbox.decline'), exact: true }).click();
  await expect(sp.locator('main')).toContainText(t('inbox.status.declined'));
  await bp.reload();
  await expect(bp.locator('[data-testid=match-card]').filter({ hasText: bizName })).toContainText(t('match.status.declined'));
  await expect(bp.locator('[data-testid=match-card]').filter({ hasText: bizName })).toContainText('Fully booked that week.');

  // buyer reports the listing; a second report is refused politely
  await bp.goto(`/en/directory/${slug}`);
  await bp.locator('summary', { hasText: t('rep.open') }).click();
  await bp.locator('#reason').selectOption('misleading');
  await bp.getByRole('button', { name: t('rep.send'), exact: true }).click();
  await expect(bp.getByText(t('rep.sent'))).toBeVisible();
  await bp.goto(`/en/directory/${slug}`);
  await bp.locator('summary', { hasText: t('rep.open') }).click();
  await bp.getByRole('button', { name: t('rep.send'), exact: true }).click();
  await expect(bp.getByRole('alert').filter({ hasText: t('errors.already_reported') })).toBeVisible();

  // admin: both reports are in the queue; dismiss one, remove the request on the other
  await page.goto('/en/admin/reports');
  const requestReport = page.locator('[data-testid=report-card]').filter({ hasText: `Catering for 80 guests ${tag}` });
  await expect(requestReport).toHaveCount(1);
  await requestReport.locator('select').selectOption('remove');
  await requestReport.locator('textarea').fill('Asks sellers for deposits.');
  await requestReport.getByRole('button', { name: t('adminList.reportSave'), exact: true }).click();
  await expect(page.locator('[data-testid=report-card]').filter({ hasText: `Catering for 80 guests ${tag}` })).toHaveCount(0);
  await bp.goto(`/en/requests/${reqId}`);
  await expect(bp.locator('main')).toContainText(t('req.removedNote'));
  const rows = await sql<{ status: string }>(`select status::text from public.buyer_requests where id = $1`, [reqId]);
  expect(rows[0]?.status).toBe('removed');
  await axe(page, 'admin reports');
});

import { expect, test } from '@playwright/test';
import { createBusinessOwner } from './support/biz';
import { createUser, sql, uniq, type TestUser } from './support/db';
import { msg } from './support/i18n';
import { dl, openPanelSection, openQuoteEditor } from './support/deals-ui';
import { freshContext, loginUi } from './support/ui';

// E46: Phases 1-4 together. A customer request on the public board -> seller A replies (Phase 3 enquiry) -> seller A suggests
// seller B (Phase 4) -> the customer agrees -> B accepts and starts the conversation (Phase 3 hand-off) -> B writes to the
// customer. Setup that earlier tests already cover (listing review, request wizard) is done in the database; every step
// that is new in the hand-off goes through the real UI.

const t = (k: string) => msg('en', k);

async function asUser(userId: string, body: string, aal = 'aal1') {
  await sql(`do $do$ begin
    perform set_config('request.jwt.claims', json_build_object('sub', '${userId}', 'role', 'authenticated', 'aal', '${aal}')::text, true);
    set local role authenticated;
    ${body}
  end $do$`);
}

async function publishSeller(owner: TestUser, orgId: string, name: string, reviewerId: string) {
  const ssm = String(Math.floor(Math.random() * 9e11) + 1e11);
  const draft = {
    headline: `Reliable ${name} for local customers`,
    description: 'We make quality products for local customers across Malaysia and deliver on time.',
    services: [{ name: `${name} service`, category_slug: 'food-beverage', nationwide: false, areas: ['Selangor'] }],
    portfolio: [], show_phone: false,
  };
  const profile = {
    business_name: name, category_slug: 'food-beverage', registration_status: 'registered', ssm_number: ssm,
    business_type: 'sole_proprietorship', state: 'Selangor', district: 'Petaling', address_line: '1 Jalan Satu', postcode: '47500',
    contact_phone: '+60 3 1234 5678', contact_email: 'biz@example.test', description: 'Synthetic business',
  };
  await asUser(owner.id, `perform public.save_business_profile('${orgId}', $j$${JSON.stringify(profile)}$j$::jsonb);
    perform public.save_listing_draft('${orgId}', $j$${JSON.stringify(draft)}$j$::jsonb, 0);
    perform public.submit_listing('${orgId}', 1);`);
  await asUser(reviewerId, `perform public.review_listing('${orgId}', 'approve', null, 1);`, 'aal2');
}

test('E46 referral hand-off: customer consent, recipient acceptance, conversation, privacy', async ({ page, browser }) => {
  test.setTimeout(300_000);
  const tag = uniq('e').replace(/[-0-9]/g, (c) => 'qrstuvwxyz'[Number(c) || 0] ?? 'k');
  const title = `Event catering ${tag}`;
  const reviewer = await createUser('e46-rev');
  const [mitra] = await sql<{ id: string }>(`select id from public.organisations where type = 'mitra' limit 1`);
  await sql(`insert into public.memberships (org_id, user_id, role) values ($1, $2, 'admin_review')`, [mitra!.id, reviewer.id]);
  const a = await createBusinessOwner('e46a');
  const b = await createBusinessOwner('e46b');
  const outsider = await createBusinessOwner('e46x');
  await publishSeller(a.owner, a.orgId, `Alpha ${tag}`, reviewer.id);
  await publishSeller(b.owner, b.orgId, `Bravo ${tag}`, reviewer.id);
  const buyer = await createUser('e46buyer', { name: 'Buyer E46' });

  // customer request on the board (database), seller A replies "interested" (database): this opens the Phase 3 enquiry
  const [bo] = await sql<{ id: string }>(
    `insert into public.organisations (type, name, created_by) values ('buyer', $1, $2) returning id`, [`Buyer ${tag}`, buyer.id]);
  await sql(`insert into public.memberships (org_id, user_id, role) values ($1, $2, 'owner')`, [bo!.id, buyer.id]);
  const draft = { title, category_slug: 'food-beverage', description: 'Lunch boxes for an office event, mixed menu, delivered by noon.',
    target_state: 'Selangor', quantity: '60', unit: 'boxes', share_contact: true, contact_phone: '+60 12 345 6789', contact_email: `buyer-${tag}@example.test` };
  await asUser(buyer.id, `declare d jsonb; begin
    d := public.save_request_draft('${bo!.id}', null, 'e46-key-${tag}', $j$${JSON.stringify(draft)}$j$::jsonb, 0);
    perform public.set_request_visibility((d ->> 'id')::uuid, 'eligible_sellers');
    perform public.submit_request((d ->> 'id')::uuid, (d ->> 'version')::int);
  end;`);
  const [rq] = await sql<{ id: string }>(`select id from public.buyer_requests where buyer_org_id = $1 and title = $2`, [bo!.id, title]);
  await asUser(a.owner.id, `perform public.respond_to_invitation('${rq!.id}', '${a.orgId}', 'interested', 'We can do this order.');`);
  const [enq] = await sql<{ id: string }>(`select id from public.enquiries where buyer_request_id = $1 and seller_org_id = $2`, [rq!.id, a.orgId]);
  const enquiryUrl = `/en/enquiries/${enq!.id}`;

  // seller A suggests seller B (UI)
  await loginUi(page, a.owner, 'en');
  await page.goto(enquiryUrl);
  await openPanelSection(page, t('p4.lead'));
  await page.locator('#sellerOrgId').fill(b.orgId);
  await page.getByRole('button', { name: t('p4.propose') }).click();
  await expect.poll(async () => Number((await sql<{ n: string }>(`select count(*) n from public.referral_suggestions where enquiry_id = $1`, [enq!.id]))[0]!.n)).toBe(1);

  // B cannot do anything before the customer agrees: no referral shows up for B
  const bCtx = await freshContext(browser, page);
  const bp = await bCtx.newPage();
  await loginUi(bp, b.owner, 'en');
  await bp.goto(`/en/orgs/${b.orgId}/business/leads`);
  await expect(bp.locator('main')).not.toContainText(t('p4.referralInbox'));
  const [early] = await sql<{ id: string }>(`select id from public.referral_suggestions where enquiry_id = $1`, [enq!.id]);
  await expect(asUser(b.owner.id, `perform public.open_referral_enquiry('${early!.id}');`)).rejects.toThrow();

  // the customer agrees (UI)
  const buyerCtx = await freshContext(browser, page);
  const cp = await buyerCtx.newPage();
  await loginUi(cp, buyer, 'en');
  await cp.goto(enquiryUrl);
  await openPanelSection(cp, t('p4.referral'));
  await cp.getByRole('button', { name: t('p4.consent') }).click();
  await expect.poll(async () => (await sql<{ status: string }>(`select status from public.referral_suggestions where id = $1`, [early!.id]))[0]?.status).toBe('buyer_consented');

  // B accepts, then starts the conversation (UI)
  await bp.goto(`/en/orgs/${b.orgId}/business/leads`);
  await expect(bp.locator('main')).toContainText(t('p4.buyerConsentedReferral'));
  await bp.getByRole('button', { name: t('p4.acceptReferral') }).click();
  await expect(bp.getByRole('button', { name: t('p4.startConversation') })).toBeVisible();
  await expect(asUser(outsider.owner.id, `perform public.open_referral_enquiry('${early!.id}');`)).rejects.toThrow();
  await bp.getByRole('button', { name: t('p4.startConversation') }).click();
  await expect.poll(async () => Number((await sql<{ n: string }>(`select count(*) n from public.enquiries where origin = 'referral'`))[0]!.n)).toBeGreaterThanOrEqual(1);
  await bp.goto(`/en/orgs/${b.orgId}/business/leads`);
  await bp.getByRole('link', { name: t('p4.openConversation') }).click();
  await expect(bp.getByRole('heading', { level: 1 })).toHaveText(title);
  const newId = bp.url().match(/enquiries\/([0-9a-f-]{36})/)![1]!;
  expect(newId).not.toBe(enq!.id);
  const [row] = await sql<{ buyer_org_id: string; seller_org_id: string; origin: string; buyer_request_id: string; opening_note: string | null }>(
    `select buyer_org_id, seller_org_id, origin, buyer_request_id, opening_note from public.enquiries where id = $1`, [newId]);
  expect(row).toMatchObject({ buyer_org_id: bo!.id, seller_org_id: b.orgId, origin: 'referral', buyer_request_id: rq!.id, opening_note: null });

  // a second click or reload creates nothing new
  await bp.goto(`/en/orgs/${b.orgId}/business/leads`);
  await expect(bp.getByRole('button', { name: t('p4.startConversation') })).toHaveCount(0);
  await asUser(b.owner.id, `perform public.open_referral_enquiry('${early!.id}');`);
  expect(Number((await sql<{ n: string }>(`select count(*) n from public.enquiries where origin = 'referral' and buyer_org_id = $1`, [bo!.id]))[0]!.n)).toBe(1);

  // B writes; the customer reads it; the customer's phone and email never reach B's page
  await bp.goto(`/en/enquiries/${newId}`);
  await bp.locator('#reply-body').fill('Thank you for the referral, we can help with the lunch boxes.');
  await bp.getByRole('button', { name: dl('send') }).click();
  await expect(bp.locator('main')).toContainText('we can help with the lunch boxes');
  await expect(bp.locator('main')).not.toContainText('buyer-' + tag);
  await expect(bp.locator('main')).not.toContainText('345 6789');
  await cp.goto(`/en/enquiries/${newId}`);
  await expect(cp.locator('main')).toContainText('we can help with the lunch boxes');

  // seller A (the referrer) and an outsider cannot open the new conversation
  const r1 = await page.goto(`/en/enquiries/${newId}`);
  expect(r1?.status()).toBe(404);
  const xCtx = await freshContext(browser, page);
  const xp = await xCtx.newPage();
  await loginUi(xp, outsider.owner, 'en');
  const r2 = await xp.goto(`/en/enquiries/${newId}`);
  expect(r2?.status()).toBe(404);
});

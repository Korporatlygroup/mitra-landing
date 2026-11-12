import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createBusinessOwner, orgPath } from './support/biz';
import { createUser, sql, uniq, type TestUser } from './support/db';
import { msg } from './support/i18n';
import { expectNoHorizontalScroll, freshContext, loginUi, logoutUi } from './support/ui';

// E43: the public ("suitable businesses can find it") request board. Sellers are published straight in the database
// (the review journey itself is covered by E40/E41); everything the buyer and the sellers do goes through the real UI.

const t = (k: string, v?: Record<string, string>) => msg('en', k, v);

async function axe(page: Page, label: string) {
  await page.waitForLoadState('networkidle');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad, `axe serious/critical on ${label}:\n${bad.map((v) => v.id).join(', ')}`).toEqual([]);
  await expectNoHorizontalScroll(page);
}

/** Runs SQL as an authenticated user (same claims PostgREST sets) inside one transaction. */
async function asUser(userId: string, body: string, aal = 'aal1') {
  await sql(`do $do$ begin
    perform set_config('request.jwt.claims', json_build_object('sub', '${userId}', 'role', 'authenticated', 'aal', '${aal}')::text, true);
    set local role authenticated;
    ${body}
  end $do$`);
}

/** Onboards, publishes and approves a seller listing without the UI. */
async function publishSeller(owner: TestUser, orgId: string, name: string, category: string, areas: string[], reviewerId: string) {
  const ssm = String(Math.floor(Math.random() * 9e11) + 1e11);
  const draft = {
    headline: `Reliable ${name} for local customers`,
    description: 'We make quality products for local customers across Malaysia and deliver on time.',
    services: [{ name: `${name} service`, category_slug: category, nationwide: false, areas }],
    portfolio: [],
    show_phone: false,
  };
  const profile = {
    business_name: name,
    category_slug: category,
    registration_status: 'registered',
    ssm_number: ssm,
    business_type: 'sole_proprietorship',
    state: areas[0],
    district: 'Petaling',
    address_line: '1 Jalan Satu',
    postcode: '47500',
    contact_phone: '+60 3 1234 5678',
    contact_email: 'biz@example.test',
    description: 'Synthetic business',
  };
  await asUser(
    owner.id,
    `perform public.save_business_profile('${orgId}', $j$${JSON.stringify(profile)}$j$::jsonb);
     perform public.save_listing_draft('${orgId}', $j$${JSON.stringify(draft)}$j$::jsonb, 0);
     perform public.submit_listing('${orgId}', 1);`,
  );
  await asUser(reviewerId, `perform public.review_listing('${orgId}', 'approve', null, 1);`, 'aal2');
}

test('E43 buyer posts a board request; eligible seller finds, reads and answers; privacy and isolation hold', async ({ page, browser }) => {
  test.setTimeout(420_000);
  const tag = uniq('brd').replace(/[-0-9]/g, (c) => 'qrstuvwxyz'[Number(c) || 0] ?? 'k');
  const title = `Office lunch boxes ${tag}`;
  const reviewer = await createUser('brd-rev');
  const [mitra] = await sql<{ id: string }>(`select id from public.organisations where type = 'mitra' limit 1`);
  await sql(`insert into public.memberships (org_id, user_id, role) values ($1, $2, 'admin_review')`, [mitra!.id, reviewer.id]);

  const eligible = await createBusinessOwner('brde');
  const other = await createBusinessOwner('brdo');
  await publishSeller(eligible.owner, eligible.orgId, `Caterer ${tag}`, 'food-beverage', ['Selangor'], reviewer.id);
  await publishSeller(other.owner, other.orgId, `Tailor ${tag}`, 'tailoring-apparel', ['Selangor'], reviewer.id);

  // ---------------- buyer: wizard, with a mistake first ----------------
  const buyer = await createUser('brdb', { name: 'Buyer Board' });
  await loginUi(page, buyer, 'en');
  await page.goto('/en/requests/new');
  await page.locator('#title').fill(title);
  await page.locator('#category_slug').selectOption('food-beverage');
  await page.getByRole('button', { name: t('ob.next'), exact: true }).click();
  await page.locator('#target_state').selectOption('Selangor');
  await page.locator('#target_district').fill('Subang Jaya');
  await page.getByRole('button', { name: t('ob.next'), exact: true }).click();
  await page.locator('#quantity').fill('60');
  await page.locator('#unit').fill('boxes');
  await page.locator('#budget_max').fill('900');
  await page.getByRole('button', { name: t('ob.next'), exact: true }).click();
  await expect(page.locator('#description-hint')).toContainText(t('req.s4.publicHint'));
  await page.locator('#description').fill('Lunch boxes for an office event, please call 0123456789 to discuss the menu.');
  await page.locator('#contact_phone').fill('0123456789');
  await page.locator('#contact_email').fill('buyer-private@example.test');
  await page.locator('#share_contact').check();
  await page.getByRole('button', { name: t('ob.next'), exact: true }).click();
  await expect(page).toHaveURL(/step=5&id=/);
  await axe(page, 'wizard review with visibility');
  await page.locator('#vis-board').check();
  await page.getByRole('button', { name: t('req.s5.send'), exact: true }).click();
  await expect(page.locator('.form-message-slot')).toContainText(t('errors.contact_in_public_text'));
  // fix the text and send again
  const url = new URL(page.url());
  const id = url.searchParams.get('id')!;
  await page.goto(`/en/requests/new?step=4&id=${id}`);
  await page.locator('#description').fill('Lunch boxes for an office event, mixed menu, delivered by noon on the day.');
  await page.getByRole('button', { name: t('ob.next'), exact: true }).click();
  await expect(page).toHaveURL(/step=5&id=/);
  await expect(page.locator('#vis-board')).toBeChecked(); // the first attempt already saved the choice
  await page.locator('#vis-board').check();
  await page.getByRole('button', { name: t('req.s5.send'), exact: true }).click();
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}\?sent=1/);
  const requestId = page.url().match(/requests\/([0-9a-f-]{36})/)![1]!;
  await expect(page.locator('main')).toContainText(`${t('req.s5.visLabel')}: ${t('req.s5.visShownBoard')}`);

  // ---------------- eligible seller: board, detail, privacy, answer ----------------
  const sellerCtx = await freshContext(browser, page);
  const sp = await sellerCtx.newPage();
  await loginUi(sp, eligible.owner, 'en');
  await sp.goto(orgPath('en', eligible.orgId, '/requests/board'));
  await expect(sp.getByRole('heading', { level: 1 })).toHaveText(t('board.title'));
  await axe(sp, 'board list');
  const row = sp.locator('[data-testid=board-row]').filter({ hasText: title });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(t('board.notAnswered'));
  // filters
  await sp.locator('#board-category').selectOption('tailoring-apparel');
  await sp.getByRole('button', { name: t('board.apply'), exact: true }).click();
  await expect(sp.locator('[data-testid=board-row]').filter({ hasText: title })).toHaveCount(0);
  await sp.locator('#board-category').selectOption('food-beverage');
  await sp.locator('#board-state').selectOption('Selangor');
  await sp.getByRole('button', { name: t('board.apply'), exact: true }).click();
  await sp.locator('[data-testid=board-row]').filter({ hasText: title }).getByRole('link', { name: title }).click();
  await expect(sp.getByRole('heading', { level: 1 })).toHaveText(title);
  await expect(sp.locator('main')).toContainText(t('board.fromBoardNote'));
  await expect(sp.locator('main')).toContainText('Subang Jaya');
  await expect(sp.locator('main')).toContainText('RM ? - 900');
  // privacy: nothing the buyer kept private is on the page or in the HTML
  const html = await sp.content();
  for (const secret of ['0123456789', 'buyer-private@example.test', 'Buyer Board']) {
    expect(html).not.toContain(secret);
  }
  await axe(sp, 'board request detail');
  await sp.locator('#note-i').fill('We can deliver 60 boxes by noon.');
  await sp.getByRole('button', { name: t('inbox.interested'), exact: true }).click();
  await expect(sp.getByRole('link', { name: t('match.openEnquiry') })).toBeVisible();
  // the buyer asked to share contact: after the reply the seller may see it (and it persists across a reload)
  await sp.reload();
  await expect(sp.locator('main')).toContainText('buyer-private@example.test');
  await expect(sp.getByRole('link', { name: t('match.openEnquiry') })).toBeVisible();
  await sp.goto(orgPath('en', eligible.orgId, '/requests/board'));
  await expect(sp.locator('[data-testid=board-row]').filter({ hasText: title })).toContainText(t('inbox.status.interested'));
  // tracked in the seller's own list as well
  await sp.goto(orgPath('en', eligible.orgId, '/requests?filter=replied'));
  await expect(sp.locator('[data-testid=inbox-row]').filter({ hasText: title })).toHaveCount(1);

  // ---------------- ineligible seller: no row, and a direct link is a 404 ----------------
  const otherCtx = await freshContext(browser, page);
  const op = await otherCtx.newPage();
  await loginUi(op, other.owner, 'en');
  await op.goto(orgPath('en', other.orgId, '/requests/board'));
  await expect(op.locator('[data-testid=board-row]').filter({ hasText: title })).toHaveCount(0);
  const resp = await op.goto(orgPath('en', other.orgId, `/requests/${requestId}`));
  expect(resp?.status()).toBe(404);
  // a seller cannot open the board of an organisation it does not belong to
  const cross = await op.goto(orgPath('en', eligible.orgId, '/requests/board'));
  expect(cross?.status()).toBe(404);

  // ---------------- session lost: back to login, then straight back to the board ----------------
  await logoutUi(sp, 'en');
  await sp.goto(orgPath('en', eligible.orgId, '/requests/board'));
  await expect(sp).toHaveURL(/\/login/);
  await loginUi(sp, eligible.owner, 'en', orgPath('en', eligible.orgId, '/requests/board'));
  await expect(sp.getByRole('heading', { level: 1 })).toHaveText(t('board.title'));

  // ---------------- buyer: sees the response, withdraws; the board empties ----------------
  await page.goto(`/en/requests/${requestId}`);
  await expect(page.locator('[data-testid=match-card]').first()).toContainText(t('match.status.interested'));
  await page.getByRole('button', { name: t('req.withdraw'), exact: true }).click();
  await expect(page.locator('main')).toContainText(t('req.status.withdrawn'));
  await sp.goto(orgPath('en', eligible.orgId, '/requests/board'));
  await expect(sp.locator('[data-testid=board-row]').filter({ hasText: title })).toHaveCount(0);

  // ---------------- Tamil ----------------
  await sp.goto(orgPath('ta', eligible.orgId, '/requests/board'));
  await expect(sp.getByRole('heading', { level: 1 })).toHaveText(msg('ta', 'board.title'));
  await axe(sp, 'board list in Tamil');
});

test('E43b an invitation-only request never appears on the board, and an anonymous visitor cannot open it', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const tag = uniq('brdp').replace(/[-0-9]/g, (c) => 'qrstuvwxyz'[Number(c) || 0] ?? 'k');
  const reviewer = await createUser('brdp-rev');
  const [mitra] = await sql<{ id: string }>(`select id from public.organisations where type = 'mitra' limit 1`);
  await sql(`insert into public.memberships (org_id, user_id, role) values ($1, $2, 'admin_review')`, [mitra!.id, reviewer.id]);
  const seller = await createBusinessOwner('brdq');
  await publishSeller(seller.owner, seller.orgId, `Caterer ${tag}`, 'food-beverage', ['Selangor'], reviewer.id);
  const buyer = await createUser('brdpb', { name: 'Buyer Private' });
  await loginUi(page, buyer, 'en');
  await page.goto('/en/requests/new');
  await page.locator('#title').fill(`Private dinner ${tag}`);
  await page.locator('#category_slug').selectOption('food-beverage');
  await page.getByRole('button', { name: t('ob.next'), exact: true }).click();
  await page.locator('#target_state').selectOption('Selangor');
  await page.getByRole('button', { name: t('ob.next'), exact: true }).click();
  await page.getByRole('button', { name: t('ob.next'), exact: true }).click();
  await page.locator('#description').fill('A private dinner for twelve guests, vegetarian menu please.');
  await page.locator('#contact_phone').fill('0123456789');
  await page.getByRole('button', { name: t('ob.next'), exact: true }).click();
  await expect(page.locator('#vis-private')).toBeChecked(); // the safe default
  await page.getByRole('button', { name: t('req.s5.send'), exact: true }).click();
  await expect(page).toHaveURL(/\?sent=1/);
  const requestId = page.url().match(/requests\/([0-9a-f-]{36})/)![1]!;

  const ctx = await freshContext(browser, page);
  const sp = await ctx.newPage();
  await loginUi(sp, seller.owner, 'en');
  await sp.goto(orgPath('en', seller.orgId, '/requests/board'));
  await expect(sp.locator('[data-testid=board-row]').filter({ hasText: tag })).toHaveCount(0);
  expect((await sp.goto(orgPath('en', seller.orgId, `/requests/${requestId}`)))?.status()).toBe(404);

  const anon = await freshContext(browser, page);
  const ap = await anon.newPage();
  await ap.goto(orgPath('en', seller.orgId, '/requests/board'));
  await expect(ap).toHaveURL(/\/login/);
});

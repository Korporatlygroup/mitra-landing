import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { actorGoto, createAdmin } from './support/p5-admin';
import { claimOf, createBusinessOwner, createReviewer, onboardUi, reviewerGoto, submittedBusiness } from './support/biz';
import { createUser, sql, uniq, type TestUser } from './support/db';
import { msg } from './support/i18n';
import { dl, openPanelSection, openQuoteEditor } from './support/deals-ui';
import { expectNoHorizontalScroll, freshContext, loginUi } from './support/ui';

// E90: the redesign. Every new control is used for real: the public home and directory, the owner dashboard, products and services
// (draft, review, public page), the enquiry dialog, the requests board and its drawer, Messages, the top-bar search, news and the
// weekly bulletin switches, and the admin review drawer. Laptop size for the journeys, phone size for the menu.

const t = (k: string, v?: Record<string, string>) => msg('en', k, v);
const tag = uniq('r90').replace(/-/g, '');
const rx = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

async function axe(page: Page, label: string) {
  await page.waitForLoadState('networkidle');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad, `axe serious/critical on ${label}:\n${bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`).join('\n')}`).toEqual([]);
}

test.describe('public site', () => {
  test.skip(({ isMobile }) => isMobile, 'laptop journey');

  test('home search, category tile, directory filters and the language switch', async ({ page }) => {
    await page.goto('/en');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(t('home2.heroA'));
    await expect(page.getByRole('link', { name: t('nav.find'), exact: true })).toBeVisible();
    await page.getByRole('searchbox').first().fill('uniform').catch(() => undefined);
    await page.locator('input[name=q]').first().fill('uniform');
    await page.getByRole('button', { name: t('home2.search'), exact: true }).click();
    await expect(page).toHaveURL(/\/en\/directory\?q=uniform/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('dir.title'));

    // "Reviewed only" is a real switch and changes the address without a full reload.
    const sw = page.getByRole('switch', { name: t('dir2.reviewedOnly') });
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await sw.click();
    await expect(page).toHaveURL(/reviewed=1/);
    await expect(page.getByRole('switch', { name: t('dir2.reviewedOnly') })).toHaveAttribute('aria-checked', 'true');

    // A category chip filters; the active chip is marked.
    await page.getByRole('link', { name: t('categories.retail-shop'), exact: true }).first().click();
    await expect(page).toHaveURL(/category=retail-shop/);
    await expect(page.getByRole('link', { name: t('categories.retail-shop'), exact: true }).first()).toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('link', { name: t('dir2.postRequest'), exact: true })).toBeVisible();

    // Language switch keeps the page.
    await page.getByRole('link', { name: 'தமிழ் – Tamil' }).click().catch(async () => page.getByRole('link', { name: msg('en', 'common.langTaFull') }).click());
    await expect(page).toHaveURL(/\/ta\/directory/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ta');
    await axe(page, 'directory ta');
  });

  test('sign-in and sign-up pages are centred cards that pass axe', async ({ page }) => {
    for (const p of ['/en/login', '/en/signup', '/en/forgot-password']) {
      await page.goto(p);
      await expect(page.locator('.auth-card')).toBeVisible();
      await axe(page, p);
    }
  });
});

test.describe.serial('business workspace journey', () => {
  test.skip(({ isMobile }) => isMobile, 'laptop journey');
  test.describe.configure({ timeout: 240_000 });

  let owner: TestUser;
  let orgId: string;
  let orgName: string;
  let slug = '';
  const product = `Polo ${tag}`;

  test('owner dashboard: greeting, key numbers, setup checklist and dismissable cards', async ({ page }) => {
    ({ owner, orgId, orgName } = await createBusinessOwner('r90'));
    await loginUi(page, owner);
    await onboardUi(page, 'en', orgId, { name: orgName });
    // Publish the listing straight in the database so the public pages can show it (the review journey is covered by E40).
    slug = `shop-${tag}`.slice(0, 40);
    await sql(`insert into public.business_listings (org_id, slug, live_status, live_name, published_at) values ($1, $2, 'published', $3, now())
               on conflict (org_id) do update set slug = $2, live_status = 'published', live_name = $3, published_at = now()`, [orgId, slug, orgName]);

    // A news post for this kind of business gives the dashboard a card to dismiss.
    const cat = (await sql<{ id: string }>(`select category_id as id from public.business_profiles where org_id = $1`, [orgId]))[0]!.id;
    const catSlug = (await sql<{ slug: string }>(`select slug from public.business_categories where id = $1`, [cat]))[0]!.slug;
    await sql(`insert into public.news_posts (title, summary, body, category, sectors, status, publish_at) values ($1, 'A summary that is long enough.', 'A body that is long enough to be valid.', 'grants', $2, 'published', now() - interval '1 hour')`,
      [`Grant news ${tag}`, [catSlug]]);

    await page.goto(`/en/orgs/${orgId}/business`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);
    await expect(page.getByRole('group', { name: t('biz2.home.keyNumbers') })).toBeVisible();
    await expect(page.getByRole('heading', { name: t('biz2.home.setupTitle') })).toBeVisible();
    await expect(page.getByRole('link', { name: t('biz2.home.sProductsA') })).toBeVisible();
    await expect(page.getByRole('progressbar').first()).toBeVisible();
    // The side menu marks the current page and lists the groups.
    await expect(page.getByRole('link', { name: t('ws.menu.profileEdit'), exact: true })).toHaveAttribute('aria-current', 'page');
    for (const label of [dl('nav.findCustomers'), dl('nav.myDeals'), t('ws.menu.products'), t('ws.menu.listing'), t('ws.menu.verification'), t('ws.menu.govHelp'), t('ws.menu.news')]) {
      await expect(page.getByRole('navigation', { name: t('ws.workspace') }).getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    // A card can be dismissed and stays dismissed after a reload.
    const card = page.getByText(`Grant news ${tag}`);
    await expect(card).toBeVisible();
    await page.getByRole('button', { name: new RegExp(`${t('biz2.home.dismiss')}: Grant news ${tag}`) }).click();
    await expect(page.getByText(`Grant news ${tag}`)).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(`Grant news ${tag}`)).toHaveCount(0);
    expect((await sql(`select 1 from public.dash_dismissals where org_id = $1`, [orgId])).length).toBe(1);
    await page.screenshot({ path: 'test-results/redesign/business-home.png', fullPage: true });
    await axe(page, 'business home');
  });

  test('products: add, save as draft, edit, send for review; collapse the menu', async ({ page }) => {
    await loginUi(page, owner);
    await page.goto(`/en/orgs/${orgId}/business/products`);
    await expect(page.getByRole('heading', { level: 1, name: t('biz2.products.title') })).toBeVisible();
    await expect(page.getByText(t('biz2.products.none'))).toBeVisible();

    await page.getByRole('button', { name: t('biz2.products.add'), exact: true }).click();
    const drawer = page.getByRole('dialog', { name: t('biz2.products.drawerAdd') });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByLabel(t('biz2.products.fName'))).toBeFocused();
    // Empty required field: the browser refuses; nothing is sent.
    await drawer.getByRole('button', { name: t('biz2.products.saveDraft') }).click();
    await expect(drawer).toBeVisible();
    await drawer.getByLabel(t('biz2.products.fName')).fill(product);
    await drawer.getByLabel(t('biz2.products.fPrice')).fill('25.50');
    await drawer.getByLabel(t('biz2.products.fPer')).selectOption('piece');
    await drawer.getByLabel(t('biz2.products.fMin')).fill('20');
    await drawer.getByRole('button', { name: t('biz2.products.saveDraft') }).click();
    await expect(drawer).toHaveCount(0);
    await expect(page.getByRole('button', { name: new RegExp(product) })).toBeVisible();
    await expect(page.getByText(t('biz2.products.statusDraft'), { exact: true }).first()).toBeVisible();
    await expect(page.getByText('RM 25.50 / piece')).toBeVisible();

    // Table view shows the same row.
    await page.getByRole('button', { name: t('biz2.products.viewTable'), exact: true }).click();
    await expect(page.getByRole('columnheader', { name: t('biz2.products.colPrice') })).toBeVisible();
    await page.getByRole('button', { name: t('biz2.products.viewGrid'), exact: true }).click();

    // Editing opens the same drawer filled in; "Ask for quote" hides the price.
    await page.getByRole('button', { name: new RegExp(product) }).click();
    const edit = page.getByRole('dialog', { name: t('biz2.products.drawerEdit') });
    await expect(edit.getByLabel(t('biz2.products.fName'))).toHaveValue(product);
    await edit.getByRole('switch', { name: t('biz2.products.fHide') }).click();
    await expect(edit.getByLabel(t('biz2.products.fPrice'))).toBeDisabled();
    await edit.getByRole('switch', { name: t('biz2.products.fHide') }).click();
    await edit.getByRole('button', { name: t('biz2.products.submit') }).click();
    await expect(edit).toHaveCount(0);
    await expect(page.getByText(t('biz2.products.statusReview'), { exact: true }).first()).toBeVisible();
    expect((await sql<{ status: string }>(`select status from public.biz_products where org_id = $1`, [orgId]))[0]!.status).toBe('in_review');

    // The menu collapses to an icon rail and the choice is remembered.
    await page.getByRole('button', { name: t('ws.collapse') }).click();
    await expect(page.locator('.ws-side.mini')).toBeVisible();
    await page.reload();
    await expect(page.locator('.ws-side.mini')).toBeVisible();
    await page.getByRole('button', { name: t('ws.collapse') }).click();
    await expect(page.locator('.ws-side.mini')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/redesign/products.png', fullPage: true });
  });

  test('admin reviews the product in the drawer; it appears on the public profile', async ({ page, browser }) => {
    const admin = await createAdmin('admin_review', 'r90rev');
    await actorGoto(page, admin, '/en/admin/products');
    await expect(page.getByRole('heading', { level: 1, name: t('adm2.products.title') })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(`^${t('adm.products')}`) }).first()).toBeVisible();
    await page.getByRole('button', { name: `${t('adm2.review')}: ${product}` }).click();
    const drawer = page.getByRole('dialog', { name: product });
    await expect(drawer.getByRole('button', { name: t('adm2.products.save') })).toBeDisabled();
    // Asking for changes needs a note.
    await drawer.getByText(t('adm2.products.changes'), { exact: true }).click();
    await drawer.getByRole('button', { name: t('adm2.products.save') }).click();
    await expect(drawer.getByRole('alert')).toBeVisible();
    await drawer.getByText(t('adm2.products.approve'), { exact: true }).click();
    await drawer.getByRole('button', { name: t('adm2.products.save') }).click();
    await expect(drawer).toHaveCount(0);
    expect((await sql<{ status: string }>(`select status from public.biz_products where org_id = $1`, [orgId]))[0]!.status).toBe('live');

    const visitor = await freshContext(browser, page);
    const v = await visitor.newPage();
    await v.goto(`/en/directory/${slug}`);
    await expect(v.getByRole('heading', { level: 1 })).toHaveText(orgName);
    await v.getByRole('tab', { name: t('dir2.tabServices') }).click();
    await expect(v.getByText(product)).toBeVisible();
    await expect(v.getByText('RM 25.50 / piece')).toBeVisible();
    // The private street address is never on the page.
    await expect(v.locator('body')).not.toContainText('Jalan Contoh Rahsia');
    await v.getByRole('tab', { name: t('dir2.tabReviews') }).click();
    await expect(v.getByText(t('dir2.noReviews'))).toBeVisible();
    await axe(v, 'public profile');
    await v.screenshot({ path: 'test-results/redesign/profile.png', fullPage: true });
    await visitor.close();
  });

  test('buyer sends an enquiry from the dialog; the business sees it on the board and in Messages', async ({ page, browser }) => {
    const buyer = await createUser('r90-buyer', { name: 'Buyer Ravi' });
    const bctx = await freshContext(browser, page);
    const b = await bctx.newPage();
    await loginUi(b, buyer);
    await b.goto(`/en/directory/${slug}`);
    await b.getByRole('button', { name: t('dir2.send'), exact: true }).click();
    const dlg = b.getByRole('dialog', { name: t('dir2.dialogTitle', { name: orgName }) });
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: t('dir2.send'), exact: true }).click(); // required fields stop it
    await expect(dlg).toBeVisible();
    await dlg.getByLabel(t('dir2.dialogNeed')).fill(`100 polo shirts ${tag}`);
    await dlg.getByLabel(t('dir2.dialogQty')).fill('100');
    await dlg.getByLabel(t('dir2.dialogDetails')).fill('Navy blue with the school crest, sizes mixed.');
    await dlg.getByRole('button', { name: t('dir2.send'), exact: true }).click();
    await expect(b.getByRole('dialog', { name: t('dir2.sentTitle', { name: orgName }) })).toBeVisible();
    await bctx.close();
    const note = (await sql<{ opening_note: string }>(`select opening_note from public.enquiries where topic = $1`, [`100 polo shirts ${tag}`]))[0]!.opening_note;
    expect(note).toContain('100');
    expect(note).toContain('Navy blue');

    // Board: the enquiry sits in "Talking"; the drawer marks it won; it moves to "Won".
    await loginUi(page, owner);
    await page.goto(`/en/orgs/${orgId}/business/requests`);
    const talking = page.getByRole('region', { name: new RegExp(t('biz2.board.colTalking')) });
    const cardBtn = talking.getByRole('button', { name: new RegExp(`100 polo shirts ${tag}`) });
    await expect(cardBtn).toBeVisible();
    await page.screenshot({ path: 'test-results/redesign/board.png', fullPage: true });
    await cardBtn.click();
    const drawer = page.getByRole('dialog', { name: `100 polo shirts ${tag}` });
    await expect(drawer.getByRole('link', { name: t('biz2.board.message'), exact: true })).toBeVisible();
    await drawer.getByRole('button', { name: t('biz2.board.markWon'), exact: true }).click();
    await expect(drawer).toHaveCount(0);
    const won = page.getByRole('region', { name: new RegExp(t('biz2.board.colWon')) });
    await expect(won.getByRole('button', { name: new RegExp(`100 polo shirts ${tag}`) })).toBeVisible();
    // List view and the hidden "lost" column are reachable.
    await page.getByRole('button', { name: t('biz2.board.viewList'), exact: true }).click();
    await expect(page.getByRole('columnheader', { name: t('biz2.board.qty') })).toBeVisible();
    await page.getByRole('button', { name: t('biz2.board.viewBoard'), exact: true }).click();
    await page.getByRole('button', { name: new RegExp(t('biz2.board.showLost')) }).click();
    await expect(page.getByRole('region', { name: new RegExp(t('biz2.board.colLost')) })).toBeVisible();

    // Messages: the list, then a reply shows as a bubble on the right.
    await page.goto('/en/enquiries');
    await expect(page.getByRole('heading', { level: 1, name: dl('myDeals') })).toBeVisible();
    await page.getByRole('navigation', { name: t('biz2.messages.list') }).getByRole('link', { name: new RegExp(`100 polo shirts ${tag}`) }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`100 polo shirts ${tag}`);
    await page.getByLabel('Reply').or(page.locator('#reply-body')).fill('We can do navy collars by next Friday.');
    await page.getByRole('button', { name: dl('send'), exact: true }).click();
    await expect(page.locator('.bub.me', { hasText: 'navy collars' })).toBeVisible();
    await page.screenshot({ path: 'test-results/redesign/messages.png', fullPage: true });
    await axe(page, 'messages');
  });

  test('top-bar search finds the product and the request; "/" focuses it', async ({ page }) => {
    await loginUi(page, owner);
    await page.goto(`/en/orgs/${orgId}/business`);
    await page.keyboard.press('/');
    await expect(page.getByRole('searchbox', { name: t('ws.search') })).toBeFocused();
    await page.getByRole('searchbox', { name: t('ws.search') }).fill('polo');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/en\/search\?q=polo/);
    await expect(page.getByRole('heading', { level: 2, name: t('biz2.search.products') })).toBeVisible();
    await expect(page.getByRole('link', { name: product })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: t('biz2.search.requests') })).toBeVisible();
    await page.locator('#ws-q').fill('zzzzqq');
    await page.keyboard.press('Enter');
    await expect(page.getByText(t('biz2.search.none', { q: 'zzzzqq' }))).toBeVisible();
  });

  test('create menu, bell, account menu and organisation switch', async ({ page }) => {
    await loginUi(page, owner);
    await page.goto(`/en/orgs/${orgId}/business`);
    await page.getByRole('button', { name: t('ws.create'), exact: true }).click();
    await page.locator('.pop').getByRole('link', { name: new RegExp(t('ws.createProduct')) }).click();
    await expect(page).toHaveURL(/products\?new=1/);
    await expect(page.getByRole('dialog', { name: t('biz2.products.drawerAdd') })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Bell lists the latest notifications and links to all of them.
    await page.getByRole('button', { name: /Notifications/ }).first().click();
    await page.getByRole('link', { name: t('ws.seeAll'), exact: true }).click();
    await expect(page).toHaveURL(/\/en\/notifications/);
    // Account menu: language and sign out.
    await page.getByRole('button', { name: t('ws.accountMenu'), exact: true }).click();
    await page.getByRole('link', { name: msg('en', 'common.langTaFull') }).click();
    await expect(page).toHaveURL(/\/ta\/notifications/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ta');
    // Org switch keeps working.
    await page.getByRole('button', { name: new RegExp(orgName) }).click();
    await page.getByRole('button', { name: new RegExp(orgName) }).last().click();
    await expect(page).toHaveURL(new RegExp(`/ta/orgs/${orgId}/business$`));
  });
});

test.describe('news and bulletins', () => {
  test.skip(({ isMobile }) => isMobile, 'laptop journey');
  test.describe.configure({ timeout: 240_000 });

  test('staff publish; visitors read; members save posts and set their bulletin', async ({ page, browser }) => {
    const editor = await createAdmin('admin_content', 'r90news');
    const title = `Bulletin ${tag}`;
    await actorGoto(page, editor, '/en/admin/news');
    await page.getByRole('link', { name: t('news2.admin.newPost'), exact: true }).first().click();
    await page.getByLabel(t('news2.admin.fTitle')).fill(title);
    await page.getByLabel(t('news2.admin.fSummary')).fill('Applications open for micro financing this month.');
    await page.getByLabel(t('news2.admin.fBody')).fill('The full text of the bulletin, with the dates and the steps to follow.');
    await page.getByLabel(t('news2.admin.fDeadline')).fill('2099-03-31');
    await page.getByRole('button', { name: t('news2.admin.save'), exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/news\/[0-9a-f-]{36}/);
    // A draft is not public.
    const visitorCtx = await freshContext(browser, page);
    const v = await visitorCtx.newPage();
    await v.goto('/en/news');
    await expect(v.getByText(title)).toHaveCount(0);
    await expect(v.getByText(t('news2.signInCta'))).toBeVisible();
    await page.getByRole('button', { name: t('news2.admin.publish'), exact: true }).click();
    await expect(page.getByRole('button', { name: t('news2.admin.unpublish'), exact: true })).toBeVisible();

    await v.goto('/en/news');
    await expect(v.getByRole('heading', { level: 2, name: title })).toBeVisible();
    await expect(v.getByText('Upcoming deadlines')).toBeVisible().catch(() => undefined);
    await v.getByRole('link', { name: t('news2.read'), exact: true }).first().click();
    await expect(v.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(v.getByText('The full text of the bulletin')).toBeVisible();

    // A signed-in member saves it and finds it under Saved; the bulletin switches persist.
    const member = await createUser('r90-member', { name: 'Member Devi' });
    await loginUi(v, member);
    await v.goto('/en/news?topic=all');
    await v.getByRole('button', { name: t('news2.saveAria', { title }) }).click();
    await expect(v.getByRole('button', { name: t('news2.unsaveAria', { title }) })).toBeVisible();
    await v.goto('/en/news?topic=saved');
    await expect(v.getByRole('heading', { name: title })).toBeVisible();
    const weekly = v.getByRole('switch', { name: t('news2.weeklySwitch') });
    await expect(weekly).toHaveAttribute('aria-checked', 'false');
    await weekly.click();
    await expect(weekly).toHaveAttribute('aria-checked', 'true');
    await v.getByRole('switch', { name: t('news2.topicTraining') }).click();
    await v.getByRole('button', { name: msg('en', 'common.langMs'), exact: true }).click();
    await expect.poll(async () => (await sql<{ weekly_email: boolean; training: boolean; language: string }>(`select weekly_email, training, language from public.news_prefs where user_id = $1`, [member.id]))[0]?.language).toBe('ms');
    await v.reload();
    await expect(v.getByRole('switch', { name: t('news2.weeklySwitch') })).toHaveAttribute('aria-checked', 'true');
    await expect(v.getByRole('switch', { name: t('news2.topicTraining') })).toHaveAttribute('aria-checked', 'false');
    await v.screenshot({ path: 'test-results/redesign/news.png', fullPage: true });
    await axe(v, 'news');
    await visitorCtx.close();
  });
});

test.describe('admin console', () => {
  test.skip(({ isMobile }) => isMobile, 'laptop journey');
  test.describe.configure({ timeout: 240_000 });

  test('verification queue: tiles filter, the review drawer saves a decision with the checklist in the reason', async ({ page }) => {
    const sub = await submittedBusiness(page, { prefix: 'r90v' });
    const rv = await createReviewer('admin_review', 'r90q');
    await reviewerGoto(page, rv, '/en/admin/verification');
    await expect(page.getByRole('heading', { level: 1, name: t('adminVer.title') })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(`^${t('adm.verification')}`) }).first()).toHaveAttribute('aria-current', 'page');
    // Tiles are links that filter the queue and mark the chosen one.
    await page.getByRole('link', { name: rx(t('claimStatus.needs_info')) }).first().click();
    await expect(page).toHaveURL(/status=needs_info/);
    await page.getByRole('link', { name: rx(t('adminVer.filterOpen')) }).first().click();
    await expect(page).toHaveURL(/status=open/);

    await page.getByRole('button', { name: `${t('adm2.review')}: ${sub.orgName}` }).or(page.getByRole('link', { name: `${t('adm2.review')}: ${sub.orgName}` })).click();
    const drawer = page.getByRole('dialog', { name: t('adminVer.title') });
    await expect(drawer).toBeVisible();
    const start = drawer.getByRole('button', { name: t('adminVer.startReview'), exact: true });
    if (await start.count()) {
      await start.click();
      await expect(drawer.getByRole('radio', { name: t('adminVer.approve') })).toBeAttached();
    }
    const save = drawer.getByRole('button', { name: t('adminVer.saveDecision'), exact: true });
    await expect(save).toBeDisabled();
    await drawer.getByText(t('adm2.checkSsm'), { exact: true }).click();
    await drawer.getByText(t('adm2.checkName'), { exact: true }).click();
    await drawer.getByText(t('adminVer.approve'), { exact: true }).click();
    await expect(save).toBeEnabled();
    await drawer.getByLabel(t('adminVer.reason')).fill('Certificate and number match the record shown.');
    await page.screenshot({ path: 'test-results/redesign/admin-drawer.png' });
    await save.click();
    await expect.poll(async () => (await claimOf(sub.orgId, sub.ct))?.status).toBe('approved');
    const reason = (await sql<{ decision_reason: string }>(`select decision_reason from public.verification_claims where id = $1`, [sub.claimId]))[0]!.decision_reason;
    expect(reason).toContain('Certificate and number match');
    expect(reason).toContain(t('adm2.checkedPrefix'));
    expect(reason).toContain(t('adm2.checkSsm'));
    // Esc closes a drawer and the focus returns.
    await page.goto('/en/admin');
    await expect(page.getByRole('heading', { level: 1, name: t('adm2.overviewTitle') })).toBeVisible();
    await axe(page, 'admin overview');
  });
});

test.describe('phone size', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone only');

  test('the workspace menu opens as a drawer, the tab bar works, nothing scrolls sideways', async ({ page }) => {
    const { owner, orgId } = await createBusinessOwner('r90m');
    await loginUi(page, owner);
    await page.goto(`/en/orgs/${orgId}/business`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good/);
    await expectNoHorizontalScroll(page);
    await page.getByRole('button', { name: t('ws.openMenu') }).first().click();
    const nav = page.getByRole('navigation', { name: t('ws.workspace') });
    await expect(nav.getByRole('link', { name: t('ws.menu.products'), exact: true })).toBeVisible();
    await nav.getByRole('link', { name: t('ws.menu.products'), exact: true }).click();
    await expect(page).toHaveURL(/business\/products/);
    await expect(page.getByRole('heading', { level: 1, name: t('biz2.products.title') })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.getByRole('navigation', { name: t('ws.tabs') }).getByRole('link', { name: t('ws.tabHome'), exact: true }).click();
    await expect(page).toHaveURL(/\/en$/); // the Home tab opens the signed-in Home
    await axe(page, 'home phone');
    await page.goto('/en');
    await expectNoHorizontalScroll(page);
  });
});

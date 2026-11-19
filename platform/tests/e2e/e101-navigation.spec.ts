import { expect, test, type Page } from '@playwright/test';
import { createBusinessOwner } from './support/biz';
import { dl } from './support/deals-ui';
import { createOrgAs, createUser } from './support/db';
import { msg } from './support/i18n';
import { shot } from './support/qa-evidence';
import { loginUi } from './support/ui';
import { actorGoto } from './support/p5-admin';
import { makePartner } from './support/p5-buyer';

// E101 WP1: the side menu is grouped by what people do (Find customers, My deals, Manage my business, ...), the seller Home is short,
// My deals is one workspace (shared tabs, accurate counts, no unread counts), and every earlier page is still reachable.
const L = 'en';
const links = async (page: Page) => page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
const has = (hrefs: string[], suffix: string) => hrefs.some((h) => h === suffix || h.endsWith(suffix));
const sidebar = (page: Page) => page.locator('nav[aria-label]').filter({ has: page.locator('a[href]') });

test('E101 seller: grouped menu, short Home, My deals and Find customers tabs, nothing lost', async ({ page }, info) => {
  test.setTimeout(240_000);
  const mobile = info.project.name === 'mobile';
  const seller = await createBusinessOwner('wp1-seller');
  await loginUi(page, seller.owner, L);
  await page.goto('/en');
  await page.waitForLoadState('networkidle');

  // Home: next step, three accurate numbers, shortcuts; no unread-message or waiting-reply wording
  await expect(page.locator('main')).toContainText(dl('homeNext'));
  await expect(page.locator('main')).toContainText(dl('homeNewRequests'));
  await expect(page.locator('main')).toContainText(dl('homeQuotesSent'));
  await expect(page.locator('main')).not.toContainText(/unread message|awaiting reply|waiting for your reply/i);
  const home = await links(page);
  expect(has(home, `/orgs/${seller.orgId}/business/360`)).toBe(true); // Business 360 stays one tap away
  expect(has(home, '/deals')).toBe(true);
  expect(has(home, `/orgs/${seller.orgId}/business/requests`)).toBe(true);
  await shot(page, { role: 'seller', journey: 'wp1', step: '01-seller-home', title: 'Simplified seller Home', expected: 'Next step, three numbers, shortcuts, latest activity', observed: 'Home renders', widths: [360, 1280] });

  if (mobile) {
    const tabs = page.getByRole('navigation', { name: msg(L, 'ws.tabs') });
    for (const k of ['findCustomersShort', 'dealsShort', 'manage']) await expect(tabs).toContainText(dl(`nav.${k}`));
  } else {
    const all = await links(page);
    for (const suffix of ['/deals', `/orgs/${seller.orgId}/business/requests`, `/orgs/${seller.orgId}/business/360`, `/orgs/${seller.orgId}/business`, `/orgs/${seller.orgId}/business/listing`, `/orgs/${seller.orgId}/business/products`, '/business-help', '/business-help/saved', '/news', '/account', '/complaints']) {
      expect(has(all, suffix), suffix).toBe(true);
    }
    // the menu is shorter: the old separate Messages, Supplier sourcing and Saved programmes entries are no longer menu items
    const menu = page.locator('aside nav a, .ws-side a, nav.sidebar a').filter({ hasText: /^(Messages|Supplier sourcing)$/ });
    expect(await menu.count()).toBe(0);
  }

  // My deals: one workspace, explained, with the shared tabs on every part
  await page.goto('/en/deals');
  await expect(page.locator('main')).toContainText(dl('dealsIntro'));
  await expect(page.locator('main')).not.toContainText(/unread/i);
  const deals = await links(page);
  for (const suffix of ['/enquiries', '/requests', '/sourcing', '/orders', '/catalogue/saved']) expect(has(deals, suffix), suffix).toBe(true);
  await shot(page, { role: 'seller', journey: 'wp1', step: '02-my-deals', title: 'My deals overview', expected: 'Four explained areas with counts and latest activity', observed: 'Hub renders', widths: [360, 1280] });
  for (const [path, tab] of [['/en/enquiries', 'tabMessages'], ['/en/requests', 'tabRequests'], ['/en/sourcing', 'tabWholesale'], ['/en/orders', 'tabOrders']] as const) {
    await page.goto(path);
    const current = page.locator('nav.tabs-x a[aria-current=page]').first();
    await expect(current).toHaveText(new RegExp(dl(tab)));
    expect(has(await links(page), '/deals')).toBe(true);
  }

  // Find customers: three tabs over the three existing pages
  const base = `/en/orgs/${seller.orgId}/business`;
  for (const [path, label] of [[`${base}/requests`, 'tabCustomerRequests'], [`${base}/requests/board`, 'tabBoard'], [`${base}/leads`, 'tabResults']] as const) {
    await page.goto(path);
    await expect(page.locator('nav.tabs-x a[aria-current=page]').first()).toHaveText(new RegExp(dl(label)));
  }
  await shot(page, { role: 'seller', journey: 'wp1', step: '03-find-customers', title: 'Find customers tabs', expected: 'Customer requests / Open requests / Results', observed: 'Tabs shown', widths: [360, 1280] });

  // Government assistance still offers Saved; Business 360 still opens
  await page.goto('/en/business-help');
  expect(has(await links(page), '/business-help/saved')).toBe(true);
  expect((await page.goto(`${base}/360`))?.status()).toBe(200);
});

test('E101 buyer and partner menus, and Malay and Tamil show the new labels without sideways scroll', async ({ page, browser }, info) => {
  test.setTimeout(240_000);
  const mobile = info.project.name === 'mobile';
  const buyer = await createUser('wp1-buyer');
  await createOrgAs(buyer, 'buyer', 'Synthetic WP1 buyer');
  await loginUi(page, buyer, L);
  await page.goto('/en');
  await page.waitForLoadState('networkidle');
  if (mobile) {
    const tabs = page.getByRole('navigation', { name: msg(L, 'ws.tabs') });
    for (const k of ['findShort', 'dealsShort', 'wholesaleShort']) await expect(tabs).toContainText(dl(`nav.${k}`));
  } else {
    const all = await links(page);
    for (const suffix of ['/directory', '/catalogue', '/deals', '/business-help', '/news', '/account']) expect(has(all, suffix), suffix).toBe(true);
  }
  for (const loc of ['ms', 'ta'] as const) {
    await page.goto(`/${loc}/deals`);
    await expect(page.locator('main')).toContainText(dl('dealsIntro', loc));
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await shot(page, { role: 'buyer', journey: 'wp1', step: `04-my-deals-${loc}`, title: `My deals in ${loc}`, expected: 'Translated labels, no overflow', observed: 'Renders', lang: loc, widths: [360, 1280] });
  }

  const partner = await makePartner('wp1-partner');
  const ctx = await browser.newContext();
  const pp = await ctx.newPage();
  await actorGoto(pp, { ...partner.user, client: partner.s.client, secret: partner.secret! } as never, `/en/orgs/${partner.org}/partner`);
  await pp.waitForLoadState('networkidle');
  if (!mobile) {
    const all = await links(pp);
    for (const suffix of [`/orgs/${partner.org}/partner/requests`, `/orgs/${partner.org}/partner/suppliers`, `/orgs/${partner.org}/partner/products`, `/orgs/${partner.org}/partner/import`, '/business-help', '/news']) expect(has(all, suffix), suffix).toBe(true);
  }
  await ctx.close();
});

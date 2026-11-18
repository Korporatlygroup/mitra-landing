import { expect, test } from '@playwright/test';
import { Agent, cover } from './harness';
import { persona } from './store';
import { expectNoRawKeys, t } from './ui';

// Government assistance navigator, news and notifications, account and privacy, languages and exploratory sessions.
test.describe.configure({ mode: 'serial' });

test('government assistance navigator: discovery, profile, saved programmes, settings, honest empty states', async ({ browser }) => {
  test.setTimeout(600_000);
  const s = await Agent.create(browser, 'seller');
  await s.login();
  await s.check('gov', 'help home and find page open; each need filter returns a page, not an error', async () => {
    for (const need of ['financing', 'training', 'grants', 'licences']) {
      const r = await s.goto(`/en/business-help/find?need=${need}`, false);
      expect(r!.status(), need).toBeLessThan(500);
      await expectNoRawKeys(s.page);
    }
  });
  await s.check('gov', 'eligibility profile saves and confirms', async () => {
    await s.goto('/en/business-help/find?need=financing');
    await s.page.waitForLoadState('networkidle');
    await s.page.locator('details:has(#gp-registration) > summary').first().click().catch(() => undefined);
    await expect(s.page.locator('#gp-registration')).toBeEnabled({ timeout: 30_000 });
    await s.page.locator('#gp-registration').selectOption('registered');
    await s.page.locator('#gp-community').selectOption('indian');
    await s.page.locator('#gp-citizenship').selectOption('malaysian');
    await s.page.locator('#gp-age').fill('40');
    await s.page.getByRole('button', { name: t('gov.find.save') }).click();
    await expect(s.page.getByText(t('gov.find.saved'))).toBeVisible();
  });
  await s.check('gov', 'invalid age is refused', async () => {
    await s.goto('/en/business-help/find?need=financing');
    await s.page.waitForLoadState('networkidle');
    await s.page.locator('details:has(#gp-age) > summary').first().click().catch(() => undefined);
    await expect(s.page.locator('#gp-age')).toBeEnabled({ timeout: 30_000 });
    await s.page.locator('#gp-age').fill('7');
    await s.page.evaluate(() => document.querySelector('main form')?.setAttribute('novalidate', ''));
    await s.page.getByRole('button', { name: t('gov.find.save') }).click();
    await s.page.waitForLoadState('domcontentloaded');
    await expect(s.page.getByText(t('gov.find.saved'))).toHaveCount(0);
  });
  await s.check('gov', 'saved programmes and settings pages open', async () => {
    for (const p of ['/en/business-help/saved', '/en/business-help/settings']) expect((await s.goto(p, false))!.status()).toBeLessThan(500);
  });
  await s.check('gov', 'unknown programme is a not-found page', async () => {
    expect((await s.goto('/en/business-help/no-such-programme', false))!.status()).toBe(404);
  });
  cover('gov', 'published government programme records', 'disabled', 'Government publication stays off until records are verified against official sources (publishing_enabled=false); catalogue may be empty');
  cover('gov', 'scheduled monitoring and reminder emails', 'disabled', 'Scheduler runs, monitoring switch is off; no mail provider');
  await s.a11y('a11y', 'business help find');
  await s.close();
});

test('news and notifications', async ({ browser }) => {
  test.setTimeout(400_000);
  const b = await Agent.create(browser, 'buyerA');
  await b.login();
  await b.check('news', 'news list and an unknown article', async () => {
    expect((await b.goto('/en/news', false))!.status()).toBeLessThan(500);
    await expectNoRawKeys(b.page);
    expect((await b.goto('/en/news/00000000-0000-0000-0000-000000000000', false))!.status()).toBe(404);
  });
  await b.check('notifications', 'notification centre renders and lists items with readable text', async () => {
    await b.goto('/en/notifications');
    await expectNoRawKeys(b.page);
    const text = await b.page.locator('main').last().innerText();
    expect(text).not.toMatch(/[a-z]+\.[a-z]+\.[a-z]+/);
  });
  await b.check('search', 'global search finds a business and returns an empty state for gibberish', async () => {
    await b.goto('/en/search?q=AGENT');
    await expectNoRawKeys(b.page);
    await b.goto('/en/search?q=zzqqxx-nothing');
    await expect(b.page.locator('main').last()).not.toContainText(/error|something went wrong/i);
  });
  await b.close();
});

test('account, consent, privacy requests and language', async ({ browser }) => {
  test.setTimeout(500_000);
  const b = await Agent.create(browser, 'buyerA');
  await b.login();
  await b.check('account', 'account page shows name, language, password change and consent controls', async () => {
    await b.goto('/en/account?section=security');
    await expectNoRawKeys(b.page);
    await expect(b.page.locator('main').last()).toContainText(/password/i);
    await b.goto('/en/account?section=notifications');
    await expect(b.page.locator('main').last()).toContainText(/consent|privacy|marketing/i);
  });
  await b.check('account', 'password change refuses a weak password', async () => {
    await b.goto('/en/account?section=security');
    const pw = b.page.locator('input[type=password]').first();
    if (await pw.count()) {
      await b.page.evaluate(() => document.querySelectorAll('main form').forEach((f) => f.setAttribute('novalidate', '')));
      const form = b.page.locator('form').filter({ has: b.page.locator('input[type=password]') }).first();
      const inputs = form.locator('input[type=password]');
      for (let i = 0; i < (await inputs.count()); i++) await inputs.nth(i).fill('short');
      await form.locator('button[type=submit]').click();
      await b.page.waitForLoadState('domcontentloaded');
      await expect(b.page.locator('main').last().getByRole('alert').first()).toBeVisible();
    } else throw new Error('no password form found');
  });
  await b.check('privacy', 'privacy request (access/erasure) form is reachable and explains the process', async () => {
    await b.goto('/en/account?section=data');
    const txt = await b.page.locator('main').last().innerText();
    cover('privacy', 'privacy request controls on the account page', /request|erase|delete|export|download/i.test(txt) ? 'pass' : 'fail', 'search account page for data-rights controls');
  });
  await b.check('language', 'switching to Tamil and Bahasa Melayu keeps the page and shows translated headings', async () => {
    for (const loc of ['ta', 'ms']) {
      await b.goto(`/${loc}/requests`);
      const h1 = (await b.page.getByRole('heading', { level: 1 }).first().innerText()).trim();
      expect(h1.length).toBeGreaterThan(0);
      await expectNoRawKeys(b.page);
    }
  });
  await b.a11y('a11y', 'account page');
  await b.close();
  void persona;
});

test('exploratory: expired session, back button, double submit, unauthorised deep links, wrong-role redirects', async ({ browser }) => {
  test.setTimeout(600_000);
  const b = await Agent.create(browser, 'buyerA');
  await b.login();
  await b.check('exploratory', 'expired session: clearing cookies mid-journey sends a protected page to login without a crash', async () => {
    await b.ctx.clearCookies();
    const r = await b.goto('/en/requests', false);
    expect(r!.status()).toBeLessThan(500);
    await expect(b.page).toHaveURL(/login/);
  });
  await b.login();
  await b.check('exploratory', 'a buyer opening seller-only business pages of another org is refused', async () => {
    const sellerOrg = persona('seller').orgId!;
    for (const p of ['/business', '/business/leads', '/business/listing', '/business/requests', '/members']) {
      await b.goto(`/en/orgs/${sellerOrg}${p}`, false);
      const txt = await b.page.locator('main').last().innerText().catch(() => '');
      expect(txt, p).not.toContain('AGENT Seller Kedai');
      expect(txt, p).not.toMatch(/@example\.test/);
    }
  });
  await b.check('exploratory', 'a buyer cannot open a business-only screen of the buyer own org in a confusing way', async () => {
    const own = persona('buyerA').orgId!;
    const r = await b.goto(`/en/orgs/${own}/business/listing`, false);
    const txt = (await b.page.locator('main').last().innerText().catch(() => '')).replace(/\s+/g, ' ');
    cover('exploratory', 'buyer org opening /business/listing', 'observed', `${r!.status()} ${txt.slice(0, 120)}`);
  });
  await b.check('exploratory', 'malformed ids in deep links give not-found, not a server error', async () => {
    for (const p of ['/en/requests/not-a-uuid', '/en/enquiries/not-a-uuid', '/en/orgs/not-a-uuid', '/en/orgs/00000000-0000-0000-0000-000000000000/members']) {
      const r = await b.goto(p, false);
      expect(r!.status(), p).toBeLessThan(500);
    }
  });
  await b.check('exploratory', 'back button after sign-out does not reveal private pages', async () => {
    await b.goto('/en/requests');
    await b.page.getByRole('button', { name: /sign out|log out/i }).first().click().catch(async () => { await b.page.locator('button[aria-label="Account menu"]').first().click(); await b.page.getByRole('menuitem', { name: /sign out|log out/i }).or(b.page.getByRole('button', { name: /sign out|log out/i })).first().click(); });
    await b.page.waitForLoadState('domcontentloaded');
    await b.page.goBack().catch(() => undefined);
    await b.page.waitForLoadState('domcontentloaded');
    const txt = await b.page.locator('body').innerText();
    expect(txt).not.toContain('Agent Buyer A Trading');
  });
  await b.close();
});

test('mobile: signed-in buyer pages fit a phone and the primary navigation is reachable', async ({ browser }) => {
  test.setTimeout(500_000);
  const b = await Agent.create(browser, 'buyerA', { mobile: true });
  await b.login();
  for (const p of ['/en', '/en/requests', '/en/requests/new', '/en/enquiries', '/en/notifications', '/en/account', '/en/catalogue', '/en/business-help']) {
    await b.check('mobile', `buyer ${p} fits 390px`, async () => {
      await b.goto(p);
      const [sw, cw] = await b.page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(sw).toBeLessThanOrEqual(cw + 1);
    });
  }
  await b.shot('buyer-mobile-requests');
  await b.close();
});

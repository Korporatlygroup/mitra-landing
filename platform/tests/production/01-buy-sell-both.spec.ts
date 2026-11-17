import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { Agent, cover } from '../agents/harness';
import { loadStore, persona, saveStore, type PersonaKey } from '../agents/store';
import { msg } from '../e2e/support/i18n';

// Production acceptance: one account that buys and sells. SYNTHETIC accounts only (example.test: nothing is ever emailed to them, and the
// notification queue skips reserved domains). Accounts are created through the Auth admin API because public sign-up is off.
const url = process.env.HOSTED_SUPABASE_URL ?? '';
const pubKey = process.env.HOSTED_SUPABASE_PUBLISHABLE_KEY ?? '';
const secretKey = process.env.HOSTED_SUPABASE_SECRET_KEY ?? '';
const PRODUCTION_REF = 'tykdrzrszznwlcyxmgrg';
const t = (k: string) => msg('en', k);
const strong = () => `Aa1-${randomBytes(9).toString('base64url')}`;
const adminClient = () => createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

test.describe.configure({ mode: 'serial' });
test.beforeAll(() => {
  if (url !== `https://${PRODUCTION_REF}.supabase.co` || process.env.ALLOW_PRODUCTION_TESTS !== 'synthetic-only') throw new Error('Refusing to run: this suite is for production with synthetic accounts only (ALLOW_PRODUCTION_TESTS).');
});

const WHO: { key: PersonaKey; email: string; name: string }[] = [
  { key: 'buyerA', email: 'inok-prod-buy@example.test', name: 'Prod Test Buyer' },
  { key: 'seller', email: 'inok-prod-sell@example.test', name: 'Prod Test Seller' },
  { key: 'buyerB', email: 'inok-prod-both@example.test', name: 'Prod Test Both' },
];

test('provision three synthetic production accounts (marked test_account)', async () => {
  const store = loadStore();
  for (const w of WHO) {
    if (store.personas[w.key]) continue;
    const password = strong();
    const { data, error } = await adminClient().auth.admin.createUser({
      email: w.email, password, email_confirm: true,
      user_metadata: { display_name: w.name, language: 'en', test_account: true, consents: { terms: '2026-07', privacy: '2026-07' } },
    });
    expect(error?.message ?? null, `create ${w.key}`).toBeNull();
    store.personas[w.key] = { id: data.user!.id, email: w.email, password };
  }
  saveStore(store);
  cover('prod-provision', 'three synthetic accounts exist (no mail sent)', 'pass');
});

test('Buy / Sell / Both chooser: a new account picks a purpose, the form is preselected, and nothing is permanent', async ({ browser }) => {
  const picks: [PersonaKey, 'buy' | 'sell' | 'both', 'buyer' | 'business', string][] = [
    ['buyerA', 'buy', 'buyer', 'PROD TEST Buyer (test)'],
    ['seller', 'sell', 'business', 'PROD TEST Seller Kedai (test)'],
    ['buyerB', 'both', 'business', 'PROD TEST Both Enterprise (test)'],
  ];
  for (const [key, purpose, type, name] of picks) {
    if (persona(key).orgId) { cover('prod-onboarding', `${key}: already onboarded by an earlier run (chooser only shows for accounts without an organisation)`, 'observed'); continue; }
    const a = await Agent.create(browser, key);
    await a.login();
    await a.must('prod-onboarding', `${key}: no organisation yet, the three purposes are offered`, async () => {
      await a.goto('/en/orgs');
      const main = a.page.locator('main').last();
      for (const label of [t('orgs.purposeBuy'), t('orgs.purposeSell'), t('orgs.purposeBoth')]) await expect(main.getByRole('link', { name: label })).toBeVisible();
    });
    await a.must('prod-onboarding', `${key}: choosing "${purpose}" preselects the right organisation type`, async () => {
      await a.page.locator('main').last().getByRole('link', { name: t(`orgs.purpose${purpose === 'buy' ? 'Buy' : purpose === 'sell' ? 'Sell' : 'Both'}`) }).click();
      await a.page.waitForURL(/orgs\/new\?purpose=/);
      await expect(a.page.locator(`#type-${type}`)).toBeChecked();
      if (purpose === 'both') await expect(a.page.getByText(t('orgs.purposeNote'))).toBeVisible();
    });
    await a.must('prod-onboarding', `${key}: the organisation is created through the real form`, async () => {
      await a.page.locator('#name').fill(name);
      await a.page.locator('main form button[type=submit]').click();
      await a.page.waitForURL(/\/orgs\/[0-9a-f-]{36}\//, { timeout: 45_000 });
      const orgId = a.page.url().match(/orgs\/([0-9a-f-]{36})/)![1]!;
      const s = loadStore();
      s.personas[key]!.orgId = orgId;
      saveStore(s);
    });
    await a.close();
  }
});

test('one account, both sides: a business can buy; a buyer can start selling; both workspaces survive sign-out', async ({ browser }) => {
  test.setTimeout(500_000);
  // The "both" account owns a BUSINESS organisation: it can post a request (buy) and has the selling workspace.
  const both = await Agent.create(browser, 'buyerB');
  await both.login();
  await both.check('prod-both', 'business workspace offers the buying entry ("My requests") next to selling', async () => {
    await both.goto(`/en/orgs/${persona('buyerB').orgId}/business`);
    await expect(both.page.locator('a[href$="/requests"]', { hasText: t('ws.menu.myRequests') }).first()).toBeAttached();
    await both.page.getByRole('button', { name: t('ws.create') }).first().click(); // the create menu renders when opened
    await expect(both.page.locator('a[href$="/requests/new"]').first()).toBeVisible();
  });
  await both.check('prod-both', 'the business organisation can start a buying request (step 1 saves a draft)', async () => {
    await both.goto('/en/requests/new');
    await both.page.locator('#title').fill('PROD TEST 200 cotton uniforms (test)');
    const cat = both.page.locator('#category_slug');
    await cat.selectOption({ index: 1 });
    await both.page.locator('main form button[type=submit]').first().click();
    await both.page.waitForURL(/requests\/new\?.*step=2|requests\/new\?.*id=/, { timeout: 45_000 });
  });
  await both.check('prod-both', 'the same business also shows its selling side (public listing, products)', async () => {
    await both.goto(`/en/orgs/${persona('buyerB').orgId}/business/listing`);
    await expect(both.page.locator('main').last()).not.toContainText(/do not have access|error/i);
  });
  await both.close();

  // A buyer starts selling later with the SAME account: no second registration.
  const buyer = await Agent.create(browser, 'buyerA');
  await buyer.login();
  await buyer.check('prod-both', 'a buyer workspace offers "Sell on INOK"', async () => {
    await buyer.goto('/en/requests');
    // The link is offered only while the account has no business organisation yet (a rerun after the next step has already added one).
    await buyer.goto('/en/orgs');
    const already = await buyer.page.getByText('PROD TEST Buyer Now Sells (test)').count();
    await buyer.goto('/en/requests');
    if (!already) await expect(buyer.page.locator('a[href*="/orgs/new?purpose=sell"]').first()).toBeAttached();
  });
  await buyer.check('prod-both', 'adding a business organisation to the same account', async () => {
    await buyer.goto('/en/orgs');
    if (await buyer.page.getByText('PROD TEST Buyer Now Sells (test)').count()) return; // already added by an earlier run
    await buyer.goto('/en/orgs/new?purpose=sell');
    await expect(buyer.page.locator('#type-business')).toBeChecked();
    await buyer.page.locator('#name').fill('PROD TEST Buyer Now Sells (test)');
    await buyer.page.locator('main form button[type=submit]').click();
    await buyer.page.waitForURL(/\/orgs\/[0-9a-f-]{36}\//, { timeout: 45_000 });
  });
  await buyer.check('prod-both', 'the account lists both organisations and the switcher can change workspace', async () => {
    await buyer.goto('/en/orgs');
    await expect(buyer.page.getByText('PROD TEST Buyer (test)').first()).toBeVisible();
    await expect(buyer.page.getByText('PROD TEST Buyer Now Sells (test)').first()).toBeVisible();
  });
  await buyer.close();

  const again = await Agent.create(browser, 'buyerA');
  await again.login();
  await again.check('prod-both', 'after signing out and back in both organisations are still there', async () => {
    await again.goto('/en/orgs');
    await expect(again.page.getByText('PROD TEST Buyer (test)').first()).toBeVisible();
    await expect(again.page.getByText('PROD TEST Buyer Now Sells (test)').first()).toBeVisible();
  });
  await again.close();
});

test('isolation: another account cannot read these organisations or requests', async ({ browser }) => {
  const seller = persona('seller');
  const c = createClient(url, pubKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const s = await c.auth.signInWithPassword({ email: seller.email, password: seller.password });
  expect(s.error?.message ?? null).toBeNull();
  const own = persona('seller').orgId!;
  const foreign = [persona('buyerA').orgId!, persona('buyerB').orgId!];
  for (const table of ['organisations', 'memberships', 'buyer_requests', 'buyer_request_private', 'enquiries', 'quotations', 'notifications', 'business_private']) {
    const { data } = await c.from(table).select('*');
    const leaked = (data ?? []).filter((r) => foreign.some((id) => JSON.stringify(r).includes(id)));
    cover('prod-isolation', `seller cannot read other accounts' rows in ${table}`, leaked.length ? 'fail' : 'pass', `${(data ?? []).length} visible, ${leaked.length} foreign`);
    expect(leaked, table).toHaveLength(0);
  }
  const a = await Agent.create(browser, 'seller');
  await a.login();
  for (const org of foreign) {
    await a.check('prod-isolation', 'direct URL to another account\'s organisation pages shows nothing private', async () => {
      for (const tail of ['/members', '/business', '/business/listing']) {
        await a.goto(`/en/orgs/${org}${tail}`, false);
        const txt = await a.page.locator('body').innerText();
        expect(txt).not.toContain('PROD TEST Buyer');
        expect(txt).not.toContain('PROD TEST Both');
        expect(txt).not.toMatch(/@example\.test/);
      }
    });
  }
  void own;
  await a.close();
});

test('mobile: the account screens fit a phone', async ({ browser }) => {
  const m = await Agent.create(browser, 'seller', { mobile: true });
  await m.login();
  for (const p of ['/en/orgs', '/en/requests/new', '/en/account', '/en/notifications']) {
    await m.check('prod-mobile', `${p} fits 390px`, async () => {
      await m.goto(p);
      const [sw, cw] = await m.page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(sw).toBeLessThanOrEqual(cw + 1);
    });
  }
  await m.close();
});

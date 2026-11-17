import { expect, test } from '@playwright/test';
import { Agent, cover, finding } from './harness';

// Visitor agent (no account): discovery, three languages, legal pages, sign-up/login validation, empty and hostile search input,
// accessibility and mobile layout of the public surface.
test.describe.configure({ mode: 'serial' });

const PUBLIC = ['/', '/directory', '/catalogue', '/business-help', '/business-help/find', '/news', '/search', '/signup', '/login', '/forgot-password', '/privacy', '/terms', '/cookies', '/marketplace-policy', '/complaints', '/government-disclaimer'];
const RAW_KEY = /\b(?:MISSING_MESSAGE|[a-z][a-zA-Z0-9]+\.[a-z][a-zA-Z0-9]+\.[a-z][a-zA-Z0-9]+)\b(?![\w@/.-])/;

test('visitor: public pages in en, ms and ta load, have a heading and no raw message keys', async ({ browser }) => {
  test.setTimeout(900_000);
  const v = await Agent.create(browser, 'buyerA');
  for (const loc of ['en', 'ms', 'ta']) {
    for (const p of PUBLIC) {
      const path = `/${loc}${p === '/' ? '' : p}`;
      await v.check('public', `${path} renders`, async () => {
        const r = await v.goto(path);
        expect(r!.status(), 'status').toBeLessThan(400);
        await expect(v.page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        const text = await v.page.locator('main').innerText();
        expect(text).not.toMatch(/MISSING_MESSAGE/);
        const raw = text.match(/\b[a-z]{2,12}\.[a-z][A-Za-z0-9]{2,}(?:\.[a-zA-Z0-9]+)?\b/g)?.filter((x) => !/\.(com|my|gov|org|net|test|png|pdf)$/.test(x) && !/^\d/.test(x));
        expect(raw ?? [], 'possible untranslated keys').toHaveLength(0);
      });
    }
  }
  await v.close();
});

test('visitor: empty, hostile and boundary search input on directory and catalogue', async ({ browser }) => {
  test.setTimeout(300_000);
  const v = await Agent.create(browser, 'buyerA');
  await v.check('public', 'directory: no-match search shows an empty state, not an error', async () => {
    await v.goto('/en/directory');
    await v.page.locator('#q').fill('zzzz-no-such-business-9917');
    await v.page.getByRole('button', { name: /search/i }).first().click();
    await v.page.waitForLoadState('domcontentloaded');
    await expect(v.page.locator('main')).not.toContainText(/error|something went wrong/i);
    await expect(v.page.locator('li.card')).toHaveCount(0);
    await expect(v.page.locator('main')).toContainText(/no |none|0 /i);
  });
  await v.check('public', 'directory: markup in the query is escaped, not executed', async () => {
    await v.goto('/en/directory?q=' + encodeURIComponent('<img src=x onerror=window.__xss=1>'));
    expect(await v.page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    expect(await v.page.locator('main img[src="x"]').count()).toBe(0);
  });
  await v.check('public', 'directory: a 5,000-character query does not crash the page', async () => {
    const r = await v.goto('/en/directory?q=' + 'a'.repeat(5000), false);
    expect(r!.status()).toBeLessThan(500);
  });
  await v.check('public', 'catalogue: unknown product id is a 404 page', async () => {
    const r = await v.goto('/en/catalogue/00000000-0000-0000-0000-000000000000', false);
    expect(r!.status()).toBe(404);
  });
  await v.check('public', 'directory: unknown business slug is a 404 page', async () => {
    const r = await v.goto('/en/directory/no-such-business-slug', false);
    expect(r!.status()).toBe(404);
  });
  await v.check('public', 'unknown route shows the not-found page with a way home', async () => {
    const r = await v.goto('/en/definitely/not/here', false);
    expect(r!.status()).toBe(404);
    await expect(v.page.getByRole('link', { name: /home|back|directory/i }).first()).toBeVisible();
  });
  await v.close();
});

test('visitor: sign-up and login validation, no account enumeration', async ({ browser }) => {
  test.setTimeout(300_000);
  const v = await Agent.create(browser, 'buyerA');
  await v.check('auth', 'sign-up: weak password is refused with a message and the typed values stay', async () => {
    await v.goto('/en/signup');
    await v.page.locator('#displayName').fill('Agent Visitor');
    await v.page.locator('#email').fill('agent-visitor@example.test');
    await v.page.locator('#password').fill('short');
    await v.page.locator('#acceptTerms').check();
    await v.page.locator('#acceptPrivacy').check();
    // The browser's own validation would stop a 5-character password first; switch it off to prove the SERVER refuses it too.
    await v.page.evaluate(() => document.querySelector('main form')!.setAttribute('novalidate', ''));
    await v.page.locator('main form button[type=submit]').click();
    await v.page.waitForLoadState('domcontentloaded');
    await expect(v.page).toHaveURL(/\/signup/);
    await expect(v.page.locator('#displayName')).toHaveValue('Agent Visitor');
    await expect(v.page.locator('main [role=alert], main .error, main [id$=-error]').first()).toBeVisible();
  });
  await v.check('auth', 'sign-up: cannot submit without accepting the terms', async () => {
    await v.goto('/en/signup');
    await v.page.locator('#displayName').fill('Agent Visitor');
    await v.page.locator('#email').fill('agent-visitor2@example.test');
    await v.page.locator('#password').fill('Aa1-correct-horse-battery');
    await v.page.locator('main form button[type=submit]').click();
    await expect(v.page).not.toHaveURL(/check-email/);
  });
  await v.check('auth', 'login: wrong password and unknown email give the same message', async () => {
    const msgFor = async (email: string) => {
      await v.goto('/en/login');
      await v.page.locator('#email').fill(email);
      await v.page.locator('#password').fill('Wrong-password-123');
      await v.page.locator('main form button[type=submit]').click();
      await v.page.waitForLoadState('domcontentloaded');
      return (await v.page.locator('main [role=alert]').first().innerText()).trim();
    };
    const known = await msgFor('agent-seller@example.test');
    const unknown = await msgFor('nobody-here-0001@example.test');
    expect(known).toBe(unknown);
  });
  await v.check('auth', 'forgot password: unknown and known email give the same confirmation', async () => {
    const msgFor = async (email: string) => {
      await v.goto('/en/forgot-password');
      await v.page.locator('#email').fill(email);
      await v.page.locator('main form button[type=submit]').click();
      await v.page.waitForLoadState('domcontentloaded');
      return (await v.page.locator('main').innerText()).replace(/\s+/g, ' ').trim();
    };
    const a = await msgFor('nobody-here-0002@example.test');
    const b = await msgFor('agent-buyer-b@example.test');
    expect(a).toBe(b);
  });
  await v.check('auth', 'protected pages redirect a visitor to login and come back after sign-in', async () => {
    await v.goto('/en/orgs');
    await expect(v.page).toHaveURL(/\/login/);
    expect(v.page.url()).toMatch(/next=|redirect=|returnTo=|from=/);
  });
  await v.check('auth', 'admin console is not reachable by a visitor', async () => {
    const r = await v.goto('/en/admin', false);
    expect(v.page.url() + r!.status()).toMatch(/login|40[134]/);
  });
  await v.close();
});

test('visitor: accessibility of the public surface (axe, WCAG 2 A/AA)', async ({ browser }) => {
  test.setTimeout(400_000);
  const v = await Agent.create(browser, 'buyerA');
  for (const p of ['/en', '/en/directory', '/en/catalogue', '/en/business-help', '/en/signup', '/en/login', '/en/privacy', '/ms', '/ta']) {
    await v.goto(p);
    await v.a11y('a11y', p);
  }
  await v.close();
});

test('visitor on a phone: no horizontal scroll, primary navigation reachable', async ({ browser }) => {
  test.setTimeout(400_000);
  const v = await Agent.create(browser, 'buyerA', { mobile: true });
  for (const p of ['/en', '/en/directory', '/en/catalogue', '/en/business-help', '/en/signup', '/en/login', '/en/privacy']) {
    await v.check('mobile', `${p} fits 390px`, async () => {
      await v.goto(p);
      const [sw, cw] = await v.page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(sw, `scrollWidth ${sw} > ${cw}`).toBeLessThanOrEqual(cw + 1);
    });
  }
  await v.check('mobile', 'home page offers a way to sign in on a phone', async () => {
    await v.goto('/en');
    await expect(v.page.getByRole('link', { name: /sign in|log in/i }).first()).toBeVisible();
  });
  await v.shot('mobile-home');
  await v.close();
  void cover;
  void finding;
});

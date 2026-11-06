import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createOrgAs, createUser, uniq } from './support/db';
import { expectNoHorizontalScroll, loginUi } from './support/ui';

// E9: automated accessibility (axe, serious/critical fail), no horizontal scroll, keyboard-only login, visible focus.

async function audit(page: Page, label: string) {
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const minor = results.violations.filter((v) => !(v.impact === 'serious' || v.impact === 'critical'));
  if (minor.length) {
    test.info().annotations.push({ type: 'axe-minor', description: `${label}: ${minor.map((v) => `${v.id}(${v.impact})`).join(', ')}` });
  }
  const summary = bad.map((v) => `${v.id} [${v.impact}] ${v.help}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`).join('\n');
  expect(bad, `axe serious/critical violations on ${label}:\n${summary}`).toEqual([]);
  await expectNoHorizontalScroll(page);
}

const PUBLIC = ['/en', '/ta', '/en/login', '/en/signup', '/ta/login', '/ta/signup', '/en/forgot-password', '/ta/forgot-password', '/en/reset-password', '/en/terms', '/en/privacy'];
for (const path of PUBLIC) {
  test(`E9 axe: ${path}`, async ({ page }) => {
    await page.goto(path);
    await audit(page, path);
  });
}

test('E9 axe: signed-in pages (account, orgs, new org, members, home) in en and ta', async ({ page }) => {
  test.setTimeout(180_000);
  const u = await createUser('e9-axe');
  const orgId = await createOrgAs(u, 'business', `A11y ${uniq('a')}`);
  await loginUi(page, u);
  for (const locale of ['en', 'ta']) {
    for (const path of [``, `/account`, `/orgs`, `/orgs/new`, `/orgs/${orgId}/members`]) {
      await page.goto(`/${locale}${path}`);
      await audit(page, `/${locale}${path}`);
    }
  }
});

test('E9 axe: pages showing error messages (login failure, invalid invitation)', async ({ page }) => {
  await page.goto('/en/login');
  await page.locator('#email').fill('nobody@example.test');
  await page.locator('#password').fill('Wrong-Password-1');
  await page.locator('main form button[type=submit]').click();
  await expect(page.locator('main [role=alert]').filter({ hasText: /./ })).toBeVisible();
  await audit(page, '/en/login (error state)');
  await page.goto(`/en/invite/${'a'.repeat(64)}`);
  await audit(page, '/en/invite/<token> (signed out)');
});

async function focusIndicator(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      id: el.id,
      type: (el as HTMLInputElement).type ?? '',
      outlineStyle: cs.outlineStyle,
      outlineWidth: parseFloat(cs.outlineWidth),
      boxShadow: cs.boxShadow,
      visible: r.width > 0 && r.height > 0,
    };
  });
}

test('E9 keyboard-only login with a visible focus indicator at every stop', async ({ page }) => {
  const u = await createUser('e9-kbd');
  await page.goto('/en/login');

  const stops: string[] = [];
  const seen = async () => {
    const f = await focusIndicator(page);
    expect(f, 'something is focused').not.toBeNull();
    expect(f!.visible).toBe(true);
    const hasIndicator = (f!.outlineStyle !== 'none' && f!.outlineWidth >= 2) || f!.boxShadow !== 'none';
    expect(hasIndicator, `focus indicator on ${f!.tag}#${f!.id} (outline ${f!.outlineStyle} ${f!.outlineWidth}px)`).toBe(true);
    stops.push(`${f!.tag}#${f!.id}`);
    return f!;
  };

  await page.keyboard.press('Tab');
  const first = await seen();
  expect(first.tag, 'first tab stop is the skip link').toBe('A');
  expect(await page.evaluate(() => document.activeElement?.getAttribute('href'))).toBe('#main');

  let f = first;
  for (let i = 0; i < 40 && f.id !== 'email'; i++) {
    await page.keyboard.press('Tab');
    f = await seen();
  }
  expect(f.id).toBe('email');
  await page.keyboard.type(u.email);
  await page.keyboard.press('Tab');
  f = await seen();
  expect(f.id).toBe('password');
  await page.keyboard.type(u.password);
  await page.keyboard.press('Tab');
  f = await seen();
  expect(f.tag).toBe('BUTTON');
  expect(f.type).toBe('submit');
  await page.keyboard.press('Enter');

  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(u.name);
  expect(stops.length).toBeGreaterThan(3);
});

test('E9 pressing Enter in the password field submits the login form', async ({ page }) => {
  const u = await createUser('e9-enter');
  await page.goto('/en/login');
  await page.locator('#email').fill(u.email);
  await page.locator('#password').fill(u.password);
  await page.locator('#password').press('Enter');
  await expect(page).not.toHaveURL(/\/login/);
});

// Regression for the language switcher (WCAG 2.5.3 Label in Name): visible text must be part of the accessible name.
test('E9 language switcher accessible names contain their visible text', async ({ page }) => {
  await page.goto('/en/login');
  const results = await new AxeBuilder({ page }).withRules(['label-content-name-mismatch']).analyze();
  expect(results.violations.map((v) => v.nodes.map((n) => n.target.join(' ')))).toEqual([]);
});

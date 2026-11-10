import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { claimOf, createBusinessOwner, createReviewer, decideAs, freshReviewerContext, onboardUi, orgPath, reviewerGoto, submitClaimUi, type Reviewer } from './support/biz';
import { msg } from './support/i18n';
import { waitForMail } from './support/mail';
import { expectNoHorizontalScroll, loginUi, type Locale } from './support/ui';

/** axe (serious and critical) plus the horizontal-scroll check; soft, so every page of a journey is reported. */
async function audit(page: Page, label: string, opts: { overflow?: boolean } = {}) {
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const summary = bad.map((v) => `${v.id} [${v.impact}] ${v.help}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`).join('\n');
  expect.soft(bad, `axe serious/critical violations on ${label}:\n${summary}`).toEqual([]);
  if (opts.overflow === false) return;
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect.soft(m.sw, `${label}: horizontal scroll (scrollWidth ${m.sw} > clientWidth ${m.cw})`).toBeLessThanOrEqual(m.cw);
}

/** A business with all three claims sent and one approved, so every owner page has real content. */
async function seed(page: Page, browser: Browser, locale: Locale) {
  const biz = await createBusinessOwner(`e28-${locale}`);
  await loginUi(page, biz.owner, locale);
  await onboardUi(page, locale, biz.orgId, { name: biz.orgName, registered: true });
  for (const ct of ['business_registration', 'business_location', 'representative_authority'] as const) await submitClaimUi(page, locale, biz.orgId, ct);
  const rv = await createReviewer('admin_review');
  const rctx = await freshReviewerContext(browser, page);
  const rp = await rctx.newPage();
  const claim = (await claimOf(biz.orgId, 'business_registration'))!;
  await decideAs(rp, rv, claim.id, 'approve', 'Documents match the details');
  return { ...biz, rv, rp, rctx, claimId: claim.id };
}

for (const locale of ['en', 'ta', 'ms'] as const satisfies readonly Locale[]) {
  test(`E28 axe and no horizontal scroll on the onboarding, verification, preview, messages and reviewer pages in ${locale}`, async ({ page, browser }) => {
    test.setTimeout(300_000);
    const s = await seed(page, browser, locale);
    const base = (tail: string) => `${orgPath(locale, s.orgId, tail)}`;
    const ownerPages = [
      orgPath(locale, s.orgId),
      `${base('/onboarding')}?step=1`,
      `${base('/onboarding')}?step=3`,
      `${base('/onboarding')}?step=4`,
      `${base('/onboarding')}?step=5`,
      base('/verification'),
      base('/preview'),
      `/${locale}/notifications`,
    ];
    for (const path of ownerPages) {
      await page.goto(path);
      await audit(page, path);
    }
    await page.goto(`${base('/onboarding')}?step=2`);
    await audit(page, `${base('/onboarding')}?step=2`);

    // Reviewer pages in the same locale (queue and detail).
    await s.rp.goto(`/${locale}/admin/verification`);
    // Queue overflow at 360px (EN and TA) is checked by its own test (its own test below).
    await audit(s.rp, `/${locale}/admin/verification`, { overflow: false });
    await s.rp.goto(`/${locale}/admin/verification?status=all`);
    await audit(s.rp, `/${locale}/admin/verification?status=all`, { overflow: false });
    await s.rp.goto(`/${locale}/admin/verification/${s.claimId}`);
    await audit(s.rp, `/${locale}/admin/verification/<approved claim>`);
    const open = await claimOf(s.orgId, 'business_location');
    await s.rp.goto(`/${locale}/admin/verification/${open!.id}`);
    await audit(s.rp, `/${locale}/admin/verification/<submitted claim>`);
    await s.rctx.close();
  });
}

// Regression (was D4): at 360px the verification queue overflows the page in both languages
// (EN scrollWidth ~429-451, TA ~617). The "Show" filter <select> is as wide as its longest option text and the
// table plus its visually-hidden header add more; the table wrapper does not contain them.
for (const locale of ['en', 'ta', 'ms'] as const satisfies readonly Locale[]) {
  test(`E28 the ${locale} verification queue has no horizontal scroll at the project viewport`, async ({ page }) => {
    const rv = await createReviewer('admin_review');
    await reviewerGoto(page, rv, `/${locale}/admin/verification`);
    await expectNoHorizontalScroll(page);
    await page.goto(`/${locale}/admin/verification?status=all`);
    await expectNoHorizontalScroll(page);
  });
}

async function focusInfo(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    return { tag: el.tagName, id: el.id, type: (el as HTMLInputElement).type ?? '', outline: cs.outlineStyle, width: parseFloat(cs.outlineWidth), shadow: cs.boxShadow, value: (el as HTMLInputElement).value };
  });
}

test('E28 keyboard-only walk through onboarding step 1 with a visible focus indicator', async ({ page }) => {
  const t = (k: string) => msg('en', k);
  const { owner, orgId } = await createBusinessOwner('e28k');
  await loginUi(page, owner);
  await page.goto(`${orgPath('en', orgId, '/onboarding')}?step=1`);

  const stops: string[] = [];
  const check = async () => {
    const f = await focusInfo(page);
    expect(f, 'something has focus').not.toBeNull();
    expect((f!.outline !== 'none' && f!.width >= 2) || f!.shadow !== 'none', `focus indicator on ${f!.tag}#${f!.id}`).toBe(true);
    stops.push(`${f!.tag}#${f!.id}`);
    return f!;
  };

  let f = null as Awaited<ReturnType<typeof check>> | null;
  for (let i = 0; i < 40 && f?.id !== 'business_name'; i++) {
    await page.keyboard.press('Tab');
    f = await check();
  }
  expect(f!.id).toBe('business_name');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Kedai Papan Kekunci');

  await page.keyboard.press('Tab');
  f = await check();
  expect(f.id).toBe('category_slug');
  await page.keyboard.type('Retail');
  await expect(page.locator('#category_slug')).toHaveValue('retail-shop');

  await page.keyboard.press('Tab');
  f = await check();
  expect(f.type).toBe('radio');
  await page.keyboard.press('ArrowDown'); // "No, not registered"
  await expect(page.locator('#reg-no')).toBeChecked();

  await page.keyboard.press('Tab');
  f = await check();
  expect(f.tag).toBe('BUTTON');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/step=3$/); // unregistered skips step 2
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('ob.s3.title'));
  expect(stops.length).toBeGreaterThan(4);
});

// E29: wording. Only "documents reviewed by MITRA ... for: <scope>"; never an implied official SSM or government check.
const BANNED = [/verified by SSM/i, /SSM[- ]verified/i, /officially verified/i, /government[- ]verified/i, /guaranteed?/i];

for (const locale of ['en', 'ta', 'ms'] as const satisfies readonly Locale[]) {
  test(`E29 wording on the owner and reviewer pages in ${locale}: no banned phrases, no unqualified "verified"`, async ({ page, browser }) => {
    test.setTimeout(300_000);
    const s = await seed(page, browser, locale);
    const texts: { path: string; text: string; owner: boolean }[] = [];
    const grab = async (p: Page, path: string, owner: boolean) => {
      await p.goto(path);
      await p.waitForLoadState('networkidle');
      texts.push({ path, owner, text: `${await p.title()}\n${await p.locator('body').innerText()}` });
    };
    const base = (tail: string) => orgPath(locale, s.orgId, tail);
    for (const path of [orgPath(locale, s.orgId), ...[1, 2, 3, 4, 5].map((n) => `${base('/onboarding')}?step=${n}`), base('/verification'), base('/preview'), `/${locale}/notifications`, `/${locale}`]) {
      await grab(page, path, true);
    }
    for (const path of [`/${locale}/admin/verification`, `/${locale}/admin/verification/${s.claimId}`]) await grab(s.rp, path, false);
    await s.rctx.close();

    // The decision email too.
    const mail = await waitForMail(s.owner.email, { match: /verification/ });
    texts.push({ path: 'decision email', owner: false, text: `${mail.subject}\n${mail.text}` });

    // The approved scope line is the only reviewed claim wording on the preview.
    const preview = texts.find((x) => x.path === base('/preview'))!.text;
    if (locale === 'en') expect(preview).toMatch(/Documents reviewed by MITRA on .+ for: business registration details/);

    for (const x of texts) {
      for (const re of BANNED) expect.soft(x.text, `${x.path}: banned phrase ${re}`).not.toMatch(re);
      if (x.owner) expect.soft(x.text, `${x.path}: unqualified word "verified"`).not.toMatch(/\bverified\b/i);
    }
    expect(texts.length).toBeGreaterThan(10);
  });
}

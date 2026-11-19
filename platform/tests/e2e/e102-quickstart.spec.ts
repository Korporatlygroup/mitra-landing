import { expect, test } from '@playwright/test';
import { createReviewer, reviewerGoto } from './support/biz';
import { createOrgAs, createUser, sql } from './support/db';
import { dl } from './support/deals-ui';
import { shot } from './support/qa-evidence';
import { msg } from './support/i18n';
import { freshContext, loginUi } from './support/ui';

// E102 WP2: three-step quick start. It reuses the real profile and listing services: the page is only SENT FOR REVIEW (never published),
// verification details are not collected (they stay as next steps), and the sign-up form still records the consents separately.
test('E102 quick start: three steps send the page for review; nothing is published; verification stays open', async ({ page }) => {
  test.setTimeout(240_000);
  const owner = await createUser('wp2-owner');
  const orgId = await createOrgAs(owner, 'business', 'Quick Start Test Kedai');
  await loginUi(page, owner, 'en');
  await page.goto('/en');
  await page.waitForLoadState('networkidle');
  const cta = page.getByRole('link', { name: dl('quick.homeAction') }).first();
  await expect(cta).toBeVisible();
  await cta.click();
  await expect(page).toHaveURL(new RegExp(`/orgs/${orgId}/business/quickstart`));
  await page.waitForLoadState('networkidle');

  // step 1
  await expect(page.locator('main')).toContainText(dl('quick.stepOf').replace('{n}', '1'));
  await page.locator('#business_name').fill('Quick Start Test Kedai');
  await page.locator('#category_slug').selectOption({ index: 1 });
  await page.locator('#reg-no').check();
  await shot(page, { role: 'seller', journey: 'wp2', step: '01-quick-step1', title: 'Quick start step 1', expected: 'Name, category, registered or not', observed: 'Form shown', widths: [360, 1280] });
  await page.getByRole('button', { name: dl('quick.next'), exact: true }).click();

  // step 2
  await expect(page).toHaveURL(/step=2/);
  await page.locator('#state').selectOption({ label: 'Selangor' });
  await page.locator('#district').fill('Klang');
  await shot(page, { role: 'seller', journey: 'wp2', step: '02-quick-step2', title: 'Quick start step 2', expected: 'State and town; address stays private', observed: 'Form shown', widths: [360, 1280] });
  await page.getByRole('button', { name: dl('quick.next'), exact: true }).click();

  // step 3
  await expect(page).toHaveURL(/step=3/);
  await page.locator('#headline').fill('Custom uniforms and tailoring in Klang');
  await page.locator('#description').fill('We make school and company uniforms, minimum order 20 pieces, delivery across the Klang Valley.');
  await page.locator('#service_name').fill('Custom uniforms');
  await page.locator('#whatsapp').fill('0123456789');
  await shot(page, { role: 'seller', journey: 'wp2', step: '03-quick-step3', title: 'Quick start step 3', expected: 'What you offer, coverage, optional WhatsApp, Send for review', observed: 'Form shown', widths: [360, 1280] });
  await page.getByRole('button', { name: dl('quick.send'), exact: true }).click();
  await expect(page).toHaveURL(/step=done/);
  await expect(page.locator('main')).toContainText(dl('quick.doneTitle'));
  const links = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  for (const s of [2, 3, 4, 5]) expect(links.some((h) => h.endsWith(`/business/onboarding?step=${s}`)), `next step ${s}`).toBe(true);
  await shot(page, { role: 'seller', journey: 'wp2', step: '04-quick-done', title: 'Sent for review, next steps for verification', expected: 'Waiting for review and the verification next steps', observed: 'Done page', widths: [360, 1280] });

  // the page is waiting for administrator approval, not published; verification has not been started or faked
  const l = (await sql<{ review_status: string; live_status: string; svc: number; areas: string; wa: string | null }>(
    `select review_status::text, live_status::text, jsonb_array_length(draft->'services') svc, (draft->'services'->0->'areas')::text areas, draft->'links'->>'whatsapp' wa from public.business_listings where org_id=$1`, [orgId]))[0]!;
  expect(l.review_status).toBe('pending_review');
  expect(l.live_status).not.toBe('published');
  expect(l.svc).toBe(1);
  expect(l.areas).toContain('Selangor');
  expect(l.wa).toBe('+60123456789'); // the database normalises Malaysian numbers
  const claims = Number((await sql<{ n: string }>(`select count(*) n from public.verification_claims where org_id=$1`, [orgId]))[0]!.n);
  expect(claims).toBe(0);
  const prof = (await sql<{ ssm_number: string | null; registration_status: string }>(`select ssm_number, registration_status::text from public.business_profiles where org_id=$1`, [orgId]))[0]!;
  expect(prof.ssm_number).toBeNull();
  expect(prof.registration_status).toBe('unregistered');
  expect(Number((await sql<{ n: string }>(`select count(*) n from public.business_listings where org_id=$1 and live_status='published'`, [orgId]))[0]!.n)).toBe(0);

  // Home no longer offers the quick start once the page is written; the full onboarding still works
  await page.goto('/en');
  await expect(page.getByRole('link', { name: dl('quick.homeAction') })).toHaveCount(0);
  expect((await page.goto(`/en/orgs/${orgId}/business/onboarding?step=2`))?.status()).toBe(200);
});

test('E102 sign-up keeps the required consents and the optional marketing consent separate; Malay and Tamil quick start', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/en/signup');
  await page.waitForLoadState('networkidle');
  const terms = page.locator('#acceptTerms'), privacy = page.locator('#acceptPrivacy'), marketing = page.locator('#acceptMarketing');
  await expect(terms).toBeVisible();
  await expect(privacy).toBeVisible();
  await expect(marketing).toBeVisible();
  expect(await terms.getAttribute('required')).not.toBeNull();
  expect(await privacy.getAttribute('required')).not.toBeNull();
  expect(await marketing.getAttribute('required')).toBeNull();
  expect(await terms.getAttribute('name')).not.toBe(await privacy.getAttribute('name'));
  await expect(page.locator('#language')).toBeAttached(); // the language choice is still part of the form, just tucked away
  await shot(page, { role: 'visitor', journey: 'wp2', step: '05-signup', title: 'Sign-up with grouped required consents', expected: 'Three fields, language collapsed, two required consents grouped, marketing separate', observed: 'Form shown', widths: [360, 1280] });

  const owner = await createUser('wp2-owner2');
  const orgId = await createOrgAs(owner, 'business', 'Kedai Ujian Dua');
  await loginUi(page, owner, 'en');
  for (const L of ['ms', 'ta'] as const) {
    await page.goto(`/${L}/orgs/${orgId}/business/quickstart?step=1`);
    await expect(page.locator('main')).toContainText(dl('quick.s1Title', L));
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await shot(page, { role: 'seller', journey: 'wp2', step: `06-quick-step1-${L}`, title: `Quick start in ${L}`, expected: 'Translated, no overflow', observed: 'Renders', lang: L, widths: [360, 1280] });
  }
});

// A page sent for review through the quick start reaches the same review queue as the full editor: INOK approves it, then it is public.
test('E102 a quick-start page is reviewed by INOK and only then appears in the directory', async ({ page, browser }) => {
  test.setTimeout(300_000);
  const owner = await createUser('wp2-review-owner');
  const name = `Kedai Semakan ${Date.now().toString(36)}`;
  const orgId = await createOrgAs(owner, 'business', name);
  await loginUi(page, owner, 'en');
  await page.goto(`/en/orgs/${orgId}/business/quickstart?step=1`);
  await page.waitForLoadState('networkidle');
  await page.locator('#business_name').fill(name);
  await page.locator('#category_slug').selectOption({ index: 1 });
  await page.locator('#reg-no').check();
  await page.getByRole('button', { name: dl('quick.next'), exact: true }).click();
  await expect(page).toHaveURL(/step=2/);
  await page.locator('#state').selectOption({ label: 'Selangor' });
  await page.locator('#district').fill('Klang');
  await page.getByRole('button', { name: dl('quick.next'), exact: true }).click();
  await expect(page).toHaveURL(/step=3/);
  await page.locator('#headline').fill('Home-cooked catering for small events');
  await page.locator('#description').fill('We cook for birthdays and office lunches, minimum ten portions, delivery in Klang.');
  await page.locator('#service_name').fill('Event catering');
  await page.getByRole('button', { name: dl('quick.send'), exact: true }).click();
  await expect(page).toHaveURL(/step=done/);

  const anon = await freshContext(browser, page);
  const ap = await anon.newPage();
  await ap.goto(`/en/directory?q=${encodeURIComponent(name)}`);
  await expect(ap.locator('a.lcard-link').filter({ hasText: name })).toHaveCount(0); // not public before approval

  const rv = await createReviewer('admin_review');
  const rctx = await freshContext(browser, page);
  const rp = await rctx.newPage();
  await reviewerGoto(rp, rv, `/en/admin/listings/${orgId}`);
  await rp.waitForLoadState('networkidle');
  await expect(rp.getByRole('heading', { level: 1 })).toHaveText(name);
  await rp.locator('#dec-approve').check();
  await rp.getByRole('button', { name: msg('en', 'adminList.save'), exact: true }).click();
  await expect(rp.getByText(msg('en', 'adminList.nothingPending'))).toBeVisible();

  await ap.reload();
  await expect(ap.locator('a.lcard-link').filter({ hasText: name })).toBeVisible();
  expect((await sql<{ s: string }>(`select live_status::text s from public.business_listings where org_id=$1`, [orgId]))[0]!.s).toBe('published');
  // approval does not mark anything verified: no claim was ever created
  expect(Number((await sql<{ n: string }>(`select count(*) n from public.verification_claims where org_id=$1`, [orgId]))[0]!.n)).toBe(0);
  await anon.close(); await rctx.close();
});

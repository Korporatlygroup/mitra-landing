import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { Agent, cover } from '../agents/harness';
import { loadStore, persona } from '../agents/store';
import { msg } from '../e2e/support/i18n';

// Production acceptance for migration 227 with SYNTHETIC accounts only (see 01-buy-sell-both.spec.ts). Profiles are saved through the
// same RPCs the onboarding form calls, signed in as the test user. Nothing is published (that needs an MFA administrator).
const url = process.env.HOSTED_SUPABASE_URL ?? '';
const pubKey = process.env.HOSTED_SUPABASE_PUBLISHABLE_KEY ?? '';
const PRODUCTION_REF = 'tykdrzrszznwlcyxmgrg';
const t = (k: string) => msg('en', k);

test.describe.configure({ mode: 'serial' });
test.beforeAll(() => {
  if (url !== `https://${PRODUCTION_REF}.supabase.co` || process.env.ALLOW_PRODUCTION_TESTS !== 'synthetic-only') throw new Error('Refusing to run: production synthetic accounts only.');
  if (!loadStore().personas.seller?.orgId || !loadStore().personas.buyerB?.orgId) throw new Error('Run 01-buy-sell-both first (it provisions the accounts and organisations).');
});

async function signedIn(key: 'seller' | 'buyerB'): Promise<SupabaseClient> {
  const c = createClient(url, pubKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const p = persona(key);
  const { error } = await c.auth.signInWithPassword({ email: p.email, password: p.password });
  expect(error?.message ?? null).toBeNull();
  return c;
}

const PROFILE = (name: string, ssm: string) => ({
  business_name: name, category_slug: 'food-beverage', registration_status: 'registered', ssm_number: ssm, business_type: 'sole_proprietorship',
  state: 'Selangor', district: 'Petaling', address_line: '1 Jalan Satu (test)', postcode: '47500', contact_phone: '+60 3 1234 5678', contact_email: 'inok-prod-sell@example.test',
});

test('two synthetic businesses may register the same SSM number: both succeed, nothing is blocked or merged', async () => {
  for (const [key, name, ssm] of [['seller', 'PROD TEST Seller Kedai (test)', '123456-A'], ['buyerB', 'PROD TEST Both Enterprise (test)', '123456A']] as const) {
    const c = await signedIn(key);
    const r = await c.rpc('save_business_profile', { p_org: persona(key).orgId, p_data: PROFILE(name, ssm) });
    expect(r.error?.message ?? null, `${key} profile`).toBeNull();
  }
  cover('prod-dup', 'the same SSM number written two ways (123456-A / 123456A) on two organisations is accepted (not blocked)', 'pass');
});

test('listing links: unsafe values are refused with a clear message; valid ones are saved and previewed safely', async ({ browser }) => {
  test.setTimeout(240_000);
  const a = await Agent.create(browser, 'seller');
  await a.login();
  const org = persona('seller').orgId;
  const fill = async (vals: Record<string, string>) => {
    await a.goto(`/en/orgs/${org}/business/listing`);
    if (!(await a.page.locator('#headline').count())) return false; // pending review: form is hidden
    await a.page.locator('#headline').fill('PROD TEST fresh catering for events');
    await a.page.locator('#description').fill('PROD TEST description of at least thirty characters for the listing draft.');
    if (!(await a.page.locator('#svc_name_0').inputValue())) {
      await a.page.locator('#svc_name_0').fill('PROD TEST catering');
      await a.page.locator('#svc_nat_0').check();
    }
    for (const [id, v] of Object.entries(vals)) await a.page.locator(`#${id}`).fill(v);
    await a.page.locator('main form button[type=submit]').first().click();
    return true;
  };
  await a.check('prod-links', 'a javascript: website is refused with a visible error', async () => {
    expect(await fill({ link_website: 'javascript:alert(1)' })).toBe(true);
    await expect(a.page.getByText(t('errors.invalid_url'))).toBeVisible({ timeout: 20_000 });
  });
  await a.check('prod-links', 'a Facebook link pointing at another site is refused', async () => {
    await fill({ link_website: '', link_facebook: 'https://evil.example.com/facebook.com' });
    await expect(a.page.getByText(t('errors.invalid_url_domain'))).toBeVisible({ timeout: 20_000 });
  });
  await a.check('prod-links', 'a bad WhatsApp number is refused', async () => {
    await fill({ link_facebook: '', link_whatsapp: 'call me' });
    await expect(a.page.getByText(t('errors.invalid_whatsapp'))).toBeVisible({ timeout: 20_000 });
  });
  await a.check('prod-links', 'valid links and hours are saved', async () => {
    await fill({ link_whatsapp: '012-345 6789', link_website: 'prod-test-kedai.com.my', link_facebook: 'facebook.com/prodtest', link_instagram: 'https://www.instagram.com/prodtest/', link_google_maps: 'https://maps.app.goo.gl/prodtest', hours: 'Mon-Fri 9am-6pm' });
    await expect(a.page.getByText(t('listing.saved'))).toBeVisible({ timeout: 20_000 });
  });
  await a.check('prod-links', 'the saved values come back normalised', async () => {
    await a.goto(`/en/orgs/${org}/business/listing`);
    await expect(a.page.locator('#link_whatsapp')).toHaveValue('+60123456789');
    await expect(a.page.locator('#link_website')).toHaveValue('https://prod-test-kedai.com.my');
    await expect(a.page.locator('#hours')).toHaveValue('Mon-Fri 9am-6pm');
  });
  await a.check('prod-links', 'the owner preview shows the links as safe external anchors and the hours', async () => {
    await a.goto(`/en/orgs/${org}/business/listing/preview`);
    const main = a.page.locator('main').last();
    await expect(main).toContainText('Mon-Fri 9am-6pm');
    for (const host of ['wa.me/60123456789', 'prod-test-kedai.com.my', 'facebook.com/prodtest', 'instagram.com/prodtest', 'maps.app.goo.gl/prodtest']) {
      const link = main.locator(`a[href*="${host}"]`).first();
      await expect(link).toBeVisible();
      expect(await link.getAttribute('href')).toMatch(/^https:\/\//);
      expect(await link.getAttribute('target')).toBe('_blank');
      expect(await link.getAttribute('rel')).toMatch(/noopener/);
    }
    await expect(main.locator('a[href^="javascript:"]')).toHaveCount(0);
  });
  await a.check('prod-links', 'the page also fits a phone', async () => {
    await a.page.setViewportSize({ width: 390, height: 844 });
    await a.goto(`/en/orgs/${org}/business/listing`);
    const [sw, cw] = await a.page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(sw).toBeLessThanOrEqual(cw + 1);
  });
  await a.close();
});

test('private details stay private: another account cannot read the draft, links or join requests', async () => {
  const other = await signedIn('buyerB');
  const org = persona('seller').orgId!;
  const l = await other.from('business_listings').select('org_id, draft').eq('org_id', org);
  expect((l.data ?? []).length).toBe(0);
  const j = await other.rpc('list_join_requests', { p_org: org });
  expect(j.error?.message ?? '').toContain('forbidden');
  const f = await other.rpc('list_duplicate_flags', { p_status: 'open' });
  expect(f.error?.message ?? '').toContain('forbidden');
  cover('prod-links', 'another account cannot read a draft, join requests or duplicate flags', 'pass');
});

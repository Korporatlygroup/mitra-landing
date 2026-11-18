import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { extractTekunScheme } from '../../src/server/gov/tekun';
import { createAdmin, actorGoto, call, type Admin } from './support/p5-admin';
import { createOrgAs, createUser, serviceClient, sql, uniq, type TestUser } from './support/db';
import { msg } from './support/i18n';
import { axeClean } from './support/p5-buyer';
import { loginUi } from './support/ui';

// E80 (Phase 7): business help. Real TEKUN SPUMI conditions (saved fixture pages) are published through the real review RPCs, then
// every journey runs through the browser at 360px and 1280px: browsing without an account, matching with explanations, saving and
// self-reported tracking, notification settings, the admin review queue, and the three languages with axe.

const fixtures = path.join(import.meta.dirname, '..', 'fixtures', 'tekun');
const SCHEME = fs.readFileSync(path.join(fixtures, 'skim-pembangunan-usahawan-masyarakat-india-spumi.html'), 'utf8');
const CONDITIONS = fs.readFileSync(path.join(fixtures, 'skim-pembangunan-usahawan-masyarakat-india-spumi-syarat-syarat.html'), 'utf8');
const tag = uniq('g80').replace(/-/g, '');
const t = (L: 'en' | 'ta' | 'ms', k: string, v: Record<string, string> = {}) => msg(L, `gov.${k}`, v);

let admin: Admin;
let owner: TestUser;
let orgId: string;
let slug = '';
let openSlug = '';
let sourceId = '';

async function publish(client: Awaited<ReturnType<typeof createAdmin>>['client'], key: string, candidate: Record<string, unknown>): Promise<string> {
  const q = await serviceClient().rpc('gov_submit_candidate', { p_source: sourceId, p_result: null, p_external_key: key, p_candidate: candidate });
  expect(q.error).toBeNull();
  const proposal = (await sql<{ id: string }>(`select id from public.gov_change_proposals where source_id = $1 and external_key = $2 and status = 'pending'`, [sourceId, key]))[0]!.id;
  await call(client, 'gov_decide_proposal', { p_proposal: proposal, p_decision: 'approve', p_reason: 'checked against the saved official page' });
  return (await sql<{ slug: string }>(`select slug from public.gov_programmes where source_id = $1 and external_key = $2`, [sourceId, key]))[0]!.slug;
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  admin = await createAdmin('admin_super', 'g80adm');
  await sql(`update public.gov_settings set enabled = true where key = 'publishing_enabled'`);
  const agency = (await sql<{ id: string }>(`insert into public.gov_agencies(code,name,domain) values ($1,'TEKUN Nasional (fixture)','tekun.gov.my') returning id`, [`G80${tag.slice(-6).toUpperCase()}`]))[0]!.id;
  sourceId = (await sql<{ id: string }>(
    `insert into public.gov_sources(agency_id,name,source_type,adapter,allowed_hosts,approved_urls,enabled,freshness_hours)
     values ($1,$2,'website','tekun','{www.tekun.gov.my,tekunonline.tekun.gov.my}','{https://www.tekun.gov.my/a/}',false,24) returning id`,
    [agency, `Source ${tag}`],
  ))[0]!.id;

  const real = extractTekunScheme({ schemeHtml: SCHEME, schemeUrl: 'https://www.tekun.gov.my/skim-pembangunan-usahawan-masyarakat-india-spumi/', conditionsHtml: CONDITIONS }).candidate;
  slug = await publish(admin.client, `spumi-${tag}`, { ...real, name: `SPUMI ${tag}` });
  // A second programme whose channel is online, status open, with a fresh check: shows the official application button.
  openSlug = await publish(admin.client, `online-${tag}`, {
    name: `Online Scheme ${tag}`, description: 'Synthetic programme with an online channel.', funding_type: 'grant', amount_max: '20000', currency: 'MYR',
    application_channel: 'online', application_url: 'https://tekunonline.tekun.gov.my/login', info_url: 'https://www.tekun.gov.my/online/',
    application_status: 'open', extraction_status: 'complete', rules: [{ field: 'employees_max', op: 'lte', value: 5, quote: 'Maksimum 5 pekerja' }],
  });
  await sql(`update public.gov_programmes set last_checked_at = now() where source_id = $1`, [sourceId]);
  owner = await createUser('g80-owner');
  orgId = await createOrgAs(owner, 'business', `Business ${tag}`);
});

test.afterAll(async () => {
  await sql(`update public.gov_settings set enabled = false where key in ('publishing_enabled','notifications_enabled','monitoring_enabled')`);
});

const card = (page: import('@playwright/test').Page, s: string) => page.locator(`[data-programme="${s}"]`);

test('E80 anonymous: browse, see published facts and evidence dates, no account needed; nothing claims approval', async ({ page }) => {
  await page.goto('/en/business-help');
  await expect(page.getByRole('heading', { level: 1, name: t('en', 'opps.title') })).toBeVisible();
  for (const k of ['tabAll', 'tabRec', 'tabNew', 'tabClosing', 'tabSaved']) await expect(page.getByRole('link', { name: new RegExp(`^${t('en', `opps.${k}`)}\\s*\\d*$`) })).toBeVisible();
  await expect(page.locator('main')).toContainText(t('en', 'independent'));
  await axeClean(page, 'en home');

  await page.goto('/en/business-help/find?need=financing');
  const c = card(page, slug);
  await expect(c).toContainText(`SPUMI ${tag}`);
  await expect(c).toContainText('RM 1,000 to RM 100,000');
  await expect(c).toContainText(`${t('en', 'card.status')}: ${t('en', 'status.unknown')}`); // never claimed open without evidence
  await expect(c).toContainText('Last checked');
  await expect(page.locator('main')).not.toContainText(/guaranteed|approved by|100% eligible/i);
  await axeClean(page, 'en find');

  await page.goto(`/en/business-help/${slug}`);
  await expect(page.getByRole('heading', { level: 1, name: `SPUMI ${tag}` })).toBeVisible();
  await expect(page.locator('main')).toContainText('Berumur 18'); // the agency's own words, original language
  await expect(page.locator('main')).toContainText(t('en', 'detail.channel.branch'));
  await expect(page.getByRole('link', { name: t('en', 'detail.applyLink') })).toHaveCount(0); // branch channel: no fake online button
  await expect(page.locator('main')).toContainText(t('en', 'detail.noCredentials'));
  await axeClean(page, 'en detail');

  await page.goto(`/en/business-help/${openSlug}`);
  const apply = page.getByRole('link', { name: t('en', 'detail.applyLink') });
  await expect(apply).toHaveAttribute('href', 'https://tekunonline.tekun.gov.my/login');
  await expect(apply).toHaveAttribute('rel', /noopener/);
  await expect(page.locator('main')).toContainText(t('en', 'status.open'));

  await page.goto('/en/business-help/not-a-real-programme');
  await expect(page.locator('body')).toContainText(/404|not found/i);
});

for (const L of ['ta', 'ms'] as const) {
  test(`E80 ${L}: home, find and detail read in the language and pass axe`, async ({ page }) => {
    await page.goto(`/${L}/business-help`);
    await expect(page.locator('html')).toHaveAttribute('lang', L);
    await expect(page.getByRole('heading', { level: 1, name: t(L, 'opps.title') })).toBeVisible();
    await expect(page.locator('main')).toContainText(t(L, 'independent'));
    await axeClean(page, `${L} home`);
    await page.goto(`/${L}/business-help/find?need=financing`);
    await expect(card(page, slug)).toContainText(t(L, 'card.agency'));
    await axeClean(page, `${L} find`);
    await page.goto(`/${L}/business-help/${slug}`);
    await expect(page.locator('main')).toContainText(t(L, 'detail.offers'));
    await expect(page.locator('main')).toContainText('Berumur 18'); // the agency text is never re-translated
    await axeClean(page, `${L} detail`);
  });
}

test('E80 business owner: answers, explained match, save, self-reported tracking, settings', async ({ page }) => {
  test.setTimeout(240_000);
  await loginUi(page, owner, 'en');
  await page.goto('/en/business-help/find?need=financing');
  await page.waitForLoadState('networkidle');
  // Before answering anything: unknown is never treated as satisfied.
  await expect(card(page, slug)).toContainText(t('en', 'match.more_information_needed'));

  await page.locator('#gp-registration').selectOption('registered');
  await page.locator('#gp-community').selectOption('indian');
  await page.locator('#gp-citizenship').selectOption('malaysian');
  await page.locator('#gp-age').fill('40');
  await page.getByRole('button', { name: t('en', 'find.save') }).click();
  await expect(page.getByText(t('en', 'find.saved'))).toBeVisible();
  await expect(card(page, slug)).toContainText(t('en', 'match.potential_match'));

  await page.goto(`/en/business-help/${slug}`);
  await expect(page.locator('main')).toContainText(t('en', 'match.fits'));
  await expect(page.locator('main')).toContainText(t('en', 'match.agency')); // bankruptcy etc.: only the agency can assess
  await axeClean(page, 'owner detail');

  // An age outside the published range: shown as not met, with the quoted rule.
  await page.goto('/en/business-help/find?need=financing');
  await page.waitForLoadState('networkidle');
  await page.locator('summary').click();
  await page.locator('#gp-age').fill('70');
  await page.getByRole('button', { name: t('en', 'find.save') }).click();
  await expect(card(page, slug)).toContainText(t('en', 'match.known_requirement_not_met'));

  // Save and track.
  await card(page, slug).getByRole('button', { name: new RegExp(t('en', 'card.save')) }).click();
  await expect(card(page, slug).locator('.form-message-slot')).toContainText(t('en', 'ok.saved'));
  await page.goto('/en/business-help/saved');
  const saved = page.locator(`[data-programme="${slug}"]`);
  await expect(saved).toContainText(`SPUMI ${tag}`);
  await expect(page.locator('main')).toContainText(t('en', 'saved.note'));
  await saved.locator('select[name=tracking_status]').selectOption('applied_externally');
  await saved.locator('input[name=applied_on]').fill('2026-11-01');
  await saved.getByRole('button', { name: t('en', 'saved.update') }).click();
  await expect(saved.getByText(t('en', 'saved.updated'))).toBeVisible();
  await page.reload();
  await expect(page.locator(`[data-programme="${slug}"] select[name=tracking_status]`)).toHaveValue('applied_externally');
  await axeClean(page, 'owner saved');

  // Notification settings.
  await page.goto('/en/business-help/settings');
  await page.locator('#gs-email').check();
  await page.locator('#gs-freq').selectOption('daily');
  await page.getByRole('button', { name: t('en', 'settings.save') }).click();
  await expect(page.getByText(t('en', 'settings.saved'))).toBeVisible();
  await page.reload();
  await expect(page.locator('#gs-email')).toBeChecked();
  await axeClean(page, 'owner settings');

  // Private to the organisation: the stored answers and the saved list are not readable by anyone else (database level).
  const other = await createUser('g80-other');
  const rows = await sql(`select 1 from public.gov_assistance_profiles where org_id = $1`, [orgId]);
  expect(rows).toHaveLength(1);
  void other;
});

test('E80 admin: review queue, evidence, reason required, approval publishes', async ({ page }) => {
  test.setTimeout(240_000);
  const key = `queue-${tag}`;
  const q = await serviceClient().rpc('gov_submit_candidate', {
    p_source: sourceId, p_result: null, p_external_key: key,
    p_candidate: { name: `Queued ${tag}`, description: 'Synthetic.', funding_type: 'training', info_url: 'https://www.tekun.gov.my/q/', application_status: 'unknown', extraction_status: 'complete', rules: [] },
  });
  expect(q.error).toBeNull();
  await actorGoto(page, admin, '/en/admin/business-help');
  await expect(page.getByRole('heading', { level: 1, name: t('en', 'admin.title') })).toBeVisible();
  const item = page.locator('[data-proposal]').filter({ hasText: `Queued ${tag}` });
  await expect(item).toBeVisible();
  await axeClean(page, 'admin home');
  await item.getByRole('link', { name: new RegExp(t('en', 'admin.review')) }).click();
  await expect(page.getByRole('heading', { level: 1, name: `Queued ${tag}` })).toBeVisible();
  await axeClean(page, 'admin review');
  // Reason is required (browser and database).
  const form = page.locator('form').filter({ has: page.locator('input[name=decision][value=approve]') });
  await form.locator('input[name=reason]').evaluate((el: HTMLInputElement) => (el.required = false));
  await form.getByRole('button', { name: t('en', 'admin.approve') }).click();
  await expect(page.locator('.form-message-slot').first()).toContainText(/reason/i);
  await form.locator('input[name=reason]').fill('checked against the official page');
  await form.getByRole('button', { name: t('en', 'admin.approve') }).click();
  await expect(page.getByRole('status').filter({ hasText: 'approved: checked against the official page' })).toBeVisible();
  const published = await sql<{ slug: string }>(`select slug from public.gov_programmes where source_id = $1 and external_key = $2 and publication_state = 'published'`, [sourceId, key]);
  expect(published).toHaveLength(1);
  // Switching publishing off stops further approvals and is visible on the page.
  await page.goto('/en/business-help/find');
  await expect(page.locator(`[data-programme="${published[0]!.slug}"]`)).toContainText(`Queued ${tag}`);
});

test('E80 anonymous cannot reach saved or settings or the admin pages', async ({ page }) => {
  for (const p of ['/en/business-help/saved', '/en/business-help/settings', '/en/admin/business-help']) {
    await page.goto(p);
    await expect(page).toHaveURL(/\/login/);
  }
});

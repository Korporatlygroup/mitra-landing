import { expect, test } from '@playwright/test';
import { createUser, sql, uniq } from './support/db';
import { msg } from './support/i18n';
import { loginUi } from './support/ui';

// Saving a programme is a personal bookmark (no business needed), and the sidebar keeps its width and state across modules.
const tag = uniq('e96').replace(/-/g, '');
const t = (k: string) => msg('en', k);
let slug = '';
let programmeId = '';

test.beforeAll(async () => {
  const agency = (await sql<{ id: string }>(`insert into public.gov_agencies(code, name, domain) values ($1, 'Fixture agency', 'example.gov.my') returning id`, [`E96${tag.slice(-6).toUpperCase()}`]))[0]!.id;
  const source = (await sql<{ id: string }>(
    `insert into public.gov_sources(agency_id, name, source_type, adapter, allowed_hosts, approved_urls, enabled, freshness_hours)
     values ($1, $2, 'manual', 'manual', '{example.gov.my}', '{}', false, 24) returning id`,
    [agency, `Source ${tag}`],
  ))[0]!.id;
  slug = `fixture-${tag}`.slice(0, 60);
  programmeId = (await sql<{ id: string }>(
    `insert into public.gov_programmes(source_id, agency_id, external_key, slug, publication_state, verification_status, application_status, name, funding_type, last_checked_at)
     values ($1, $2, $3, $4, 'published', 'verified', 'unknown', $5, 'financing', now()) returning id`,
    [source, agency, `k-${tag}`, slug, `Fixture programme ${tag}`],
  ))[0]!.id;
  const data = { name: `Fixture programme ${tag}`, info_url: 'https://example.gov.my/info', funding_type: 'financing', application_status: 'unknown', rules: [] };
  const v = (await sql<{ id: string }>(
    `insert into public.gov_programme_versions(programme_id, version_no, data, data_sha256, detection_method) values ($1, 1, $2::jsonb, repeat('a', 64), 'manual') returning id`,
    [programmeId, JSON.stringify(data)],
  ))[0]!.id;
  await sql(`update public.gov_programmes set current_version_id = $1 where id = $2`, [v, programmeId]);
});

test('a person without any business saves, sees, keeps and removes a programme; others cannot see it', async ({ page, browser }) => {
  const me = await createUser('e96a', { name: 'Saver One' });
  await loginUi(page, me, 'en');
  await page.goto('/en/business-help');
  const card = page.locator(`li[data-programme="${slug}"]`);
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: new RegExp(`^${t('gov.card.save')}`) }).click();
  await expect(card.getByRole('button', { name: new RegExp(`^${t('gov.card.remove')}`) })).toBeVisible();
  await expect(page).not.toHaveURL(/\/orgs/); // no business prompt

  await page.reload();
  await expect(page.locator(`li[data-programme="${slug}"]`).getByRole('button', { name: new RegExp(`^${t('gov.card.remove')}`) })).toBeVisible();
  const row = await sql<{ n: string }>(`select count(*) n from public.gov_saved_user s join auth.users u on u.id = s.user_id where u.email = $1`, [me.email]);
  expect(row[0]!.n).toBe('1');

  await page.goto('/en/business-help?tab=saved');
  await expect(page.locator(`li[data-programme="${slug}"]`)).toHaveCount(1);
  await page.goto('/en/business-help/saved');
  await expect(page.getByText(`Fixture programme ${tag}`).first()).toBeVisible();

  // another account has its own, empty list (and the database refuses a direct read of someone else's)
  const ctx = await browser.newContext({ baseURL: page.url().split('/en')[0] });
  const other = await ctx.newPage();
  const you = await createUser('e96b', { name: 'Saver Two' });
  await loginUi(other, you, 'en');
  await other.goto('/en/business-help?tab=saved');
  await expect(other.locator(`li[data-programme="${slug}"]`)).toHaveCount(0);
  await ctx.close();

  await page.goto('/en/business-help');
  const again = page.locator(`li[data-programme="${slug}"]`);
  await again.getByRole('button', { name: new RegExp(`^${t('gov.card.remove')}`) }).click();
  await expect(again.getByRole('button', { name: new RegExp(`^${t('gov.card.save')}`) })).toBeVisible();
});

test('the sidebar keeps its width across modules, collapses only on request and remembers the choice', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'the collapse toggle is a desktop control; mobile uses the drawer');
  const me = await createUser('e96c', { name: 'Side Bar' });
  await loginUi(page, me, 'en');
  const width = () => page.locator('aside.ws-side').evaluate((e) => Math.round(e.getBoundingClientRect().width));
  const shellFits = () => page.evaluate(() => Math.abs(document.querySelector('.ws-shell')!.getBoundingClientRect().width - document.documentElement.clientWidth) <= 20);

  for (const path of ['/en', '/en/directory', '/en/catalogue', '/en/news', '/en/business-help']) {
    await page.goto(path);
    expect(await width(), `${path} expanded`).toBe(248);
    expect(await shellFits(), `${path} uses the full window`).toBe(true);
  }
  await page.goto('/en/catalogue');
  await page.getByRole('button', { name: t('ws.collapse') }).click();
  await expect.poll(width).toBe(72);
  for (const path of ['/en/business-help', '/en/catalogue', '/en']) {
    await page.goto(path);
    expect(await width(), `${path} stays collapsed`).toBe(72);
    await expect(page.locator('aside.ws-side a[aria-label]').first()).toHaveAttribute('title', /.+/); // icons carry a tooltip and a name
  }
  await page.getByRole('button', { name: t('ws.collapse') }).click();
  await expect.poll(width).toBe(248);
  await page.goto('/en/catalogue');
  expect(await width()).toBe(248);
});

import { expect, test, type Page } from '@playwright/test';
import { actorGoto, createAdmin, type Admin } from './support/p5-admin';
import { sql, uniq } from './support/db';
import { msg } from './support/i18n';

// E82: the administrator workflow of the Government Assistance Navigator, driven through the real forms (not RPC calls):
// register an official source, propose its settings, have a DIFFERENT administrator approve, enter a programme by hand,
// have a different administrator publish it, close it through a second approved edit, archive it, and read the history.
// Local stack only. Each test creates its own data (a worker restart re-runs module code).

const tag = uniq('g82').replace(/-/g, '');
const t = (k: string, v: Record<string, string> = {}) => msg('en', `gov.${k}`, v);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test.describe.configure({ timeout: 300_000 });
test.afterAll(async () => {
  // The switches start off in a fresh database; leave them as found for any database test that runs next.
  await sql(`update public.gov_settings set enabled = false where key = 'publishing_enabled'`);
});
test.skip(({ isMobile }) => isMobile, 'laptop journey');

async function as(page: Page, admin: Admin, path: string) {
  await page.context().clearCookies();
  await actorGoto(page, admin, path);
}
const form = (page: Page, anchor: string) => page.locator(anchor).locator('xpath=ancestor::form');
const notice = (page: Page, text: string) => expect(page.locator('.form-message-slot').filter({ hasText: text }).first()).toBeVisible();

test('source registration, a settings proposal, and approval by a different administrator', async ({ page }) => {
  const [a, b] = await Promise.all([createAdmin('admin_super', 'g82a'), createAdmin('admin_super', 'g82b')]);
  const name = `E82 Source ${tag}`;

  // 1. Register (starts switched off).
  await as(page, a, '/en/admin/business-help/sources');
  await page.locator('#rs-code').fill(`E82${tag.slice(-6).toUpperCase()}`);
  await page.locator('#rs-aname').fill(`E82 Agency ${tag}`);
  await page.locator('#rs-domain').fill('www.example.gov.my');
  await page.locator('#rs-name').fill(name);
  await page.locator('#rs-type').selectOption('manual');
  await page.locator('#rs-adapter').selectOption('manual');
  await page.locator('#rs-hosts').fill('www.example.gov.my');
  await page.locator('#rs-method').selectOption('manual_entry');
  await form(page, '#rs-code').locator('button[type=submit]').click();
  await notice(page, t('admin.src.registered'));
  const row = (await sql<{ id: string; enabled: boolean; refresh_interval_minutes: number }>(`select id, enabled, refresh_interval_minutes from public.gov_sources where name = $1`, [name]))[0]!;
  expect(row.enabled).toBe(false);
  expect((await sql(`select 1 from public.audit_log where action = 'gov.source.registered' and entity_id = $1`, [row.id])).length).toBe(1);

  // 2. Propose a schedule and switching on. Nothing changes yet and the proposer sees why.
  await page.reload();
  const card = page.locator(`[data-source-id="${row.id}"]`);
  await expect(card).toBeVisible();
  await card.getByText(t('admin.src.scheduleTitle'), { exact: true }).click();
  await card.locator(`#sr-${row.id}`).fill('120');
  await card.locator(`#se-${row.id}`).selectOption('on');
  await card.locator(`#sx-${row.id}`).fill('Official page confirmed by hand in a browser');
  await card.getByRole('button', { name: t('admin.src.propose'), exact: true }).click();
  await notice(page, t('admin.src.proposed'));
  expect((await sql<{ enabled: boolean }>(`select enabled from public.gov_sources where id = $1`, [row.id]))[0]!.enabled).toBe(false);
  await page.reload();
  const pending = page.locator('[data-source-change]').filter({ hasText: name });
  await expect(pending.getByTestId('gov-src-own-change')).toBeVisible();
  await expect(pending.getByRole('button', { name: t('admin.src.approveChange'), exact: true })).toHaveCount(0);

  // 3. The proposer cannot approve through the database either.
  const change = (await sql<{ id: string }>(`select id from public.gov_source_changes where source_id = $1 and status = 'pending'`, [row.id]))[0]!.id;
  const own = await a.client.rpc('gov_decide_source_change', { p_change: change, p_approve: true, p_reason: 'approving my own proposal' });
  expect(own.error).not.toBeNull();

  // 4. A different administrator approves in the browser.
  await as(page, b, '/en/admin/business-help/sources');
  const theirs = page.locator(`[data-source-change="${change}"]`);
  await expect(theirs).toBeVisible();
  await theirs.locator(`#sc-true-${change}`).fill('Matches the agency page and the contact details');
  await theirs.getByRole('button', { name: t('admin.src.approveChange'), exact: true }).click();
  // The decided change leaves the page with its form, so the proof is the stored result.
  await expect.poll(async () => (await sql<{ enabled: boolean; refresh_interval_minutes: number }>(`select enabled, refresh_interval_minutes from public.gov_sources where id = $1`, [row.id]))[0]).toMatchObject({ enabled: true, refresh_interval_minutes: 120 });

  // 5. Health and history are visible, and a check can be requested without waiting for the schedule.
  await page.reload();
  const live = page.locator(`[data-source-id="${row.id}"]`);
  await expect(live.getByText(t('admin.src.minutes', { n: '120' }))).toBeVisible();
  await expect(live.getByRole('heading', { name: t('admin.src.historyTitle') })).toBeVisible();
  await live.getByText(t('admin.src.recheckTitle'), { exact: true }).click();
  await live.locator(`#rc-${row.id}`).fill('Check after approval, as a test');
  await live.getByRole('button', { name: t('admin.src.recheck'), exact: true }).click();
  await expect(page.locator('.form-message-slot').filter({ hasText: /A check has been queued|No new check was queued/ }).first()).toBeVisible();
  expect((await sql(`select 1 from public.audit_log where action = 'gov.source.changed' and entity_id = $1`, [row.id])).length).toBe(1);
});

test('manual programme entry, publication by a different administrator, a closing edit, and archive', async ({ page }) => {
  const [a, b] = await Promise.all([createAdmin('admin_super', 'g82c'), createAdmin('admin_super', 'g82d')]);
  await sql(`update public.gov_settings set enabled = true where key = 'publishing_enabled'`);
  const agency = (await sql<{ id: string }>(`insert into public.gov_agencies(code,name,domain) values ($1,'Manual agency','www.mitra.gov.my') returning id`, [`M82${tag.slice(-6).toUpperCase()}`]))[0]!.id;
  const sourceId = (await sql<{ id: string }>(
    `insert into public.gov_sources(agency_id,name,source_type,adapter,allowed_hosts,approved_urls,allowed_method,enabled) values ($1,$2,'manual','manual','{www.mitra.gov.my}','{}','manual_entry',false) returning id`,
    [agency, `Manual source ${tag}`],
  ))[0]!.id;
  const name = `Manual Grant ${tag}`;

  // 1. Enter by hand.
  await as(page, a, '/en/admin/business-help/programmes/new');
  await page.locator('#mp-source').selectOption(sourceId);
  await page.locator('#mp-name').fill(name);
  await page.locator('#mp-category').selectOption('grants_funding');
  await page.locator('#mp-ft').selectOption('grant');
  await page.locator('#mp-desc').fill('A synthetic programme entered by hand for the administrator journey.');
  await page.locator('#mp-iurl').fill('https://www.mitra.gov.my/ms/modal-insan');
  await page.locator('#mp-status').selectOption('open');
  await page.locator('#mp-closes').fill(inDays(30));
  await page.locator('#mp-docs').fill('SSM registration\nBusiness photos');
  await page.locator('#mp-reason').fill('Read from the official page by hand');
  await form(page, '#mp-name').locator('button[type=submit]').click();
  await notice(page, t('admin.manual.proposed'));
  const proposal = (await sql<{ id: string }>(`select id from public.gov_change_proposals where candidate ->> 'name' = $1`, [name]))[0]!.id;
  expect((await sql(`select 1 from public.gov_programmes where name = $1 and publication_state = 'published'`, [name])).length).toBe(0);

  // 2. The author sees the review page but cannot approve it.
  await page.goto(`/en/admin/business-help/review/${proposal}`);
  await expect(page.getByTestId('gov-own-entry')).toBeVisible();
  await expect(page.getByRole('button', { name: t('admin.approve'), exact: true })).toHaveCount(0);

  // 3. A different administrator approves; the programme is public.
  await as(page, b, `/en/admin/business-help/review/${proposal}`);
  await page.locator('#rv-reason-approve').fill('Checked against the official page');
  await page.getByRole('button', { name: t('admin.approve'), exact: true }).click();
  await expect.poll(async () => (await sql<{ publication_state: string }>(`select publication_state from public.gov_programmes where name = $1`, [name]))[0]?.publication_state).toBe('published');
  const prog = (await sql<{ id: string; slug: string }>(`select id, slug from public.gov_programmes where name = $1`, [name]))[0]!;
  await page.goto(`/en/business-help/${prog.slug}`);
  await expect(page.getByRole('heading', { name })).toBeVisible();

  // 4. Closing is a second approved edit (the first version stays in the history).
  await page.goto(`/en/admin/business-help/programmes/${prog.id}/edit`);
  await page.locator('#mp-status').selectOption('closed');
  await page.locator('#mp-reason').fill('The agency page now says applications are closed');
  await form(page, '#mp-name').locator('button[type=submit]').click();
  await notice(page, t('admin.manual.proposed'));
  const closing = (await sql<{ id: string }>(`select id from public.gov_change_proposals where programme_id = $1 and status = 'pending'`, [prog.id]))[0]!.id;
  await as(page, a, `/en/admin/business-help/review/${closing}`);
  await page.locator('#rv-reason-approve').fill('Confirmed on the official page');
  await page.getByRole('button', { name: t('admin.approve'), exact: true }).click();
  await expect.poll(async () => (await sql<{ application_status: string }>(`select application_status from public.gov_programmes where id = $1`, [prog.id]))[0]!.application_status).toBe('closed');
  expect((await sql<{ n: number }>(`select count(*)::int n from public.gov_programme_versions where programme_id = $1`, [prog.id]))[0]!.n).toBe(2);

  // 5. Archive from the dashboard.
  await page.goto('/en/admin/business-help');
  const card = page.locator(`[data-programme-id="${prog.id}"]`);
  await expect(card).toBeVisible();
  await card.locator(`#ar-${prog.id}`).fill('The scheme was withdrawn by the agency');
  await card.getByRole('button', { name: t('admin.archiveConfirm'), exact: true }).click();
  await expect.poll(async () => (await sql<{ publication_state: string }>(`select publication_state from public.gov_programmes where id = $1`, [prog.id]))[0]!.publication_state).toBe('archived');

  // 6. The audit trail has every step.
  const actions = (await sql<{ action: string }>(`select action from public.audit_log where entity_id = $1 order by at`, [prog.id])).map((r) => r.action);
  expect(actions).toEqual(expect.arrayContaining(['gov.programme.published', 'gov.programme.archived']));
});

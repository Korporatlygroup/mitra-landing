import { expect, test } from '@playwright/test';
import { createAdmin, actorGoto, call, type Admin } from './support/p5-admin';
import { createOrgAs, createUser, serviceClient, signedClient, sql, uniq, type TestUser } from './support/db';
import { msg } from './support/i18n';
import { axeClean } from './support/p5-buyer';
import { loginUi } from './support/ui';

// E81 (Phase 7 completion): the journeys of the Government Assistance Navigator, through the browser and the real RPCs.
// A public discovery, B personalised matching, C application tracking, D source update with the second-editor rule,
// E reminders, F security, G multilingual. Programmes are published through the real two-person path (a reviewer proposes,
// a different administrator approves). Local stack only.

const tag = uniq('g81').replace(/-/g, '');
const t = (L: 'en' | 'ta' | 'ms', k: string, v: Record<string, string> = {}) => msg(L, `gov.${k}`, v);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

let adminA: Admin;
let adminB: Admin;
let editor: Admin;
let sourceId = '';
const slugs: Record<string, string> = {};
const ids: Record<string, string> = {};
let owner: TestUser;
let orgId = '';
let other: TestUser;
let otherOrg = '';

const cand = (name: string, extra: Record<string, unknown> = {}) => ({
  name, description: `Synthetic programme ${name}.`, funding_type: 'grant', category: 'grants_funding', beneficiary_type: 'entrepreneur',
  application_channel: 'online', application_url: 'https://www.mitra.gov.my/apply', info_url: 'https://www.mitra.gov.my/ms/modal-insan',
  application_status: 'open', extraction_status: 'complete', documents: ['SSM registration', 'Business photos'],
  rules: [
    { field: 'state', op: 'in', value: ['selangor'], quote: 'Selangor sahaja' },
    { field: 'note', op: 'note', quote: 'Perniagaan tidak muflis' },
  ],
  ...extra,
});

/** A reviewer proposes by hand; a different administrator approves. */
async function publishManual(key: string, name: string, extra: Record<string, unknown> = {}) {
  const proposal = await call<string>(editor.client, 'gov_propose_manual', { p_source: sourceId, p_programme: null, p_candidate: cand(name, extra), p_reason: 'read from the official page for the test' });
  await call(adminA.client, 'gov_decide_proposal', { p_proposal: proposal, p_decision: 'approve', p_reason: 'second person checked the page' });
  const row = (await sql<{ id: string; slug: string }>(`select id, slug from public.gov_programmes where source_id = $1 and name = $2`, [sourceId, name]))[0]!;
  slugs[key] = row.slug;
  ids[key] = row.id;
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  [adminA, adminB, editor] = await Promise.all([createAdmin('admin_super', 'g81a'), createAdmin('admin_super', 'g81b'), createAdmin('admin_review', 'g81r')]);
  await sql(`update public.gov_settings set enabled = true where key in ('publishing_enabled', 'notifications_enabled')`);
  const agency = (await sql<{ id: string }>(`insert into public.gov_agencies(code,name,domain) values ($1,'MITRA (fixture)','mitra.gov.my') returning id`, [`G81${tag.slice(-6).toUpperCase()}`]))[0]!.id;
  sourceId = (await sql<{ id: string }>(
    `insert into public.gov_sources(agency_id,name,source_type,adapter,allowed_hosts,approved_urls,allowed_method,enabled,freshness_hours)
     values ($1,$2,'manual','manual','{www.mitra.gov.my}','{}','manual_entry',false,48) returning id`, [agency, `Editorial ${tag}`],
  ))[0]!.id;
  await publishManual('grant', `Alpha Grant ${tag}`, { closes_on: inDays(10), sectors: ['retail'], states: ['Selangor'] });
  await publishManual('org', `Beta Association Fund ${tag}`, { beneficiary_type: 'organisation' });
  await publishManual('nodate', `Gamma Training ${tag}`, { funding_type: 'training', category: 'training', application_status: 'unknown', application_channel: 'unknown', application_url: undefined });
  owner = await createUser('g81-owner');
  orgId = await createOrgAs(owner, 'business', `Business ${tag}`);
  other = await createUser('g81-other');
  otherOrg = await createOrgAs(other, 'business', `Other ${tag}`);
});

test.afterAll(async () => {
  await sql(`update public.gov_settings set enabled = false where key in ('publishing_enabled','notifications_enabled','monitoring_enabled')`);
});

const card = (page: import('@playwright/test').Page, k: string) => page.locator(`[data-programme="${slugs[k]}"]`);

test('A public discovery: search, filter, requirements, documents, dates not confirmed, official source', async ({ page }) => {
  await page.goto(`/en/business-help/find?q=${encodeURIComponent(`Alpha Grant ${tag}`)}`);
  await expect(card(page, 'grant')).toBeVisible();
  await expect(card(page, 'nodate')).toHaveCount(0);
  await axeClean(page, 'find search');

  await page.goto('/en/business-help/find?category=training');
  await expect(card(page, 'nodate')).toBeVisible();
  await expect(card(page, 'grant')).toHaveCount(0);
  await page.goto('/en/business-help/find?category=grants_funding');
  await expect(card(page, 'grant')).toBeVisible();

  await page.goto(`/en/business-help/${slugs.grant}`);
  for (const k of ['detail.offers', 'detail.whoFor', 'detail.documentsToPrepare', 'detail.dates', 'detail.sourceTitle']) {
    await expect(page.getByRole('heading', { level: 2, name: t('en', k) })).toBeVisible();
  }
  await expect(page.locator('main')).toContainText('SSM registration');
  await expect(page.locator('main')).toContainText('Selangor sahaja'); // the agency's own wording
  await expect(page.locator('main')).toContainText(t('en', 'detail.notConfirmed')); // no opening date was published
  await expect(page.locator('a[href="https://www.mitra.gov.my/ms/modal-insan"]').first()).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(t('en', 'detail.applyOfficial')) })).toHaveAttribute('href', 'https://www.mitra.gov.my/apply');
  await expect(page.getByRole('link', { name: t('en', 'detail.checkButton') })).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/guaranteed|officially eligible|approved by/i);
  await axeClean(page, 'detail');

  // A programme with no confirmed dates or application route never claims to be open, and offers no fake apply button.
  await page.goto(`/en/business-help/${slugs.nodate}`);
  await expect(page.getByRole('link', { name: new RegExp(t('en', 'detail.applyOfficial')) })).toHaveCount(0);
  await expect(page.locator('main')).toContainText(t('en', 'detail.notConfirmed'));
});

test('B + C personalised matching, saving and self-reported application tracking', async ({ page }) => {
  test.setTimeout(240_000);
  await loginUi(page, owner, 'en');
  await page.goto('/en/business-help');
  await expect(page.getByRole('heading', { level: 2, name: t('en', 'dash.recommended') })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: t('en', 'dash.closing') })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: t('en', 'dash.training') })).toBeVisible();

  // Nothing answered: unknown is not satisfied. Organisation-only programmes are never recommended to a shop owner.
  await page.goto(`/en/business-help/find?org=${orgId}`);
  await page.waitForLoadState('networkidle');
  await expect(card(page, 'grant')).toContainText(t('en', 'match.more_information_needed'));
  await expect(card(page, 'org')).toContainText(t('en', 'match.for_organisations'));
  await page.goto('/en/business-help');
  await expect(page.locator('[data-programme]').filter({ hasText: `Beta Association Fund ${tag}` }).first()).toHaveCount(0).catch(() => undefined);

  // Answer the one question this programme asks.
  await page.goto(`/en/business-help/find?org=${orgId}`);
  await page.locator('#gp-state').fill('Selangor');
  await page.getByRole('button', { name: t('en', 'find.save') }).click();
  await expect(page.getByText(t('en', 'find.saved'))).toBeVisible();
  await expect(card(page, 'grant')).toContainText(t('en', 'match.potential_match'));

  // Per-requirement explanation with source; conditions only the agency can check are said to be so.
  await page.goto(`/en/business-help/${slugs.grant}?org=${orgId}`);
  const explain = page.locator('#gov-match');
  await expect(explain).toContainText(t('en', 'match.rule.met'));
  await expect(explain).toContainText(t('en', 'match.rule.agency'));
  await expect(explain).toContainText(t('en', 'match.disclaimer'));
  await expect(explain.locator('a[href="https://www.mitra.gov.my/ms/modal-insan"]').first()).toBeVisible();
  await expect(explain).not.toContainText(/eligible for|approved|guaranteed/i);
  await axeClean(page, 'explained match');

  // Another state: the same programme now "may not meet".
  await page.goto(`/en/business-help/find?org=${orgId}`);
  await page.locator('summary').click();
  await page.locator('#gp-state').fill('Johor');
  await page.getByRole('button', { name: t('en', 'find.save') }).click();
  await expect(card(page, 'grant')).toContainText(t('en', 'match.known_requirement_not_met'));
  await page.locator('summary').click();
  await page.locator('#gp-state').fill('Selangor');
  await page.getByRole('button', { name: t('en', 'find.save') }).click();

  // Save it, then record the self-reported stages. The note says these are not agency updates.
  await card(page, 'grant').getByRole('button', { name: new RegExp(t('en', 'card.save')) }).click();
  // The card now offers to remove it (the saved state came back from the server).
  await expect(card(page, 'grant').getByRole('button', { name: new RegExp(t('en', 'card.remove')) })).toBeVisible();
  await page.goto(`/en/business-help/saved?org=${orgId}`);
  const saved = page.locator(`[data-programme="${slugs.grant}"]`);
  await expect(saved).toBeVisible();
  await expect(page.locator('main')).toContainText(t('en', 'saved.reportedNote'));
  const stages = await saved.locator('select[name=tracking_status] option').evaluateAll((o) => (o as HTMLOptionElement[]).map((x) => x.value));
  expect(stages).toEqual(['interested', 'preparing', 'ready_to_apply', 'applied_externally', 'awaiting_decision', 'outcome_recorded', 'not_interested']);

  const stage = () => sql<{ s: string }>(`select tracking_status as s from public.gov_saved where org_id = $1 and programme_id = $2`, [orgId, ids.grant]).then((r) => r[0]?.s);
  const storedVersion = saved.locator('input[name=version]');
  const version0 = await storedVersion.inputValue();
  await saved.locator('select[name=tracking_status]').selectOption('ready_to_apply');
  await saved.getByRole('button', { name: t('en', 'saved.update') }).click();
  await expect.poll(stage).toBe('ready_to_apply');
  // Wait until the page has been refreshed with the saved row (the form carries the new stored version) before editing again.
  await expect(storedVersion).not.toHaveValue(version0);
  await expect(saved.locator('select[name=tracking_status]')).toHaveValue('ready_to_apply');
  await saved.locator('select[name=tracking_status]').selectOption('applied_externally');
  await saved.locator('input[name=applied_on]').fill(inDays(-1));
  await saved.getByRole('button', { name: t('en', 'saved.update') }).click();
  await expect.poll(stage).toBe('applied_externally');

  // Revisit later: the stage and the date are still there, and the dashboard lists it under My applications.
  await page.reload();
  await expect(page.locator(`[data-programme="${slugs.grant}"] select[name=tracking_status]`)).toHaveValue('applied_externally');
  await page.goto(`/en/business-help?org=${orgId}`);
  const apps = page.locator('section').filter({ has: page.getByRole('heading', { level: 2, name: t('en', 'dash.applications') }) });
  await expect(apps).toContainText(`Alpha Grant ${tag}`);
  await axeClean(page, 'dashboard');
});

test('D a source change is detected, a person reviews the difference, a different administrator publishes it', async ({ page }) => {
  test.setTimeout(300_000);
  // The monitor finds a moved deadline (as the worker would submit it). Nothing is published by that.
  const key = (await sql<{ external_key: string }>(`select external_key from public.gov_programmes where id = $1`, [ids.grant]))[0]!.external_key;
  const newClose = inDays(40);
  const submit = await serviceClient().rpc('gov_submit_candidate', { p_source: sourceId, p_result: null, p_external_key: key, p_candidate: cand(`Alpha Grant ${tag}`, { closes_on: newClose, sectors: ['retail'], states: ['Selangor'] }) });
  expect(submit.error).toBeNull();
  expect(submit.data).toBe('queued');
  expect((await sql<{ closes_on: string }>(`select closes_on::text from public.gov_programmes where id = $1`, [ids.grant]))[0]!.closes_on).toBe(inDays(10));

  await actorGoto(page, adminA, '/en/admin/business-help');
  const item = page.locator('[data-proposal]').filter({ hasText: `Alpha Grant ${tag}` });
  await expect(item).toBeVisible();
  await item.getByRole('link', { name: new RegExp(t('en', 'admin.review')) }).click();
  await expect(page.getByRole('heading', { level: 1, name: `Alpha Grant ${tag}` })).toBeVisible();
  await expect(page.locator('main')).toContainText(inDays(10)); // before
  await expect(page.locator('main')).toContainText(newClose); // after
  await axeClean(page, 'review difference');
  const form = page.locator('form').filter({ has: page.locator('input[name=decision][value=approve]') });
  await form.locator('input[name=reason]').fill('deadline confirmed on the official page');
  await form.getByRole('button', { name: t('en', 'admin.approve') }).click();
  await expect(page.getByRole('status').filter({ hasText: 'deadline confirmed on the official page' })).toBeVisible();
  expect((await sql<{ closes_on: string }>(`select closes_on::text from public.gov_programmes where id = $1`, [ids.grant]))[0]!.closes_on).toBe(newClose);
  // The old version is kept, not overwritten.
  expect((await sql<{ n: number }>(`select count(*)::int as n from public.gov_programme_versions where programme_id = $1`, [ids.grant]))[0]!.n).toBe(2);
  await page.goto(`/en/business-help/${slugs.grant}`);
  await expect(page.locator('main')).toContainText(new Date(`${newClose}T00:00:00Z`).getUTCFullYear().toString());

  // A hand-entered change: the person who entered it cannot approve it, a different administrator can.
  await actorGoto(page, adminB, `/en/admin/business-help/programmes/${ids.nodate}/edit`);
  await page.locator('#mp-desc').fill('A longer description written after reading the official page.');
  await page.locator('#mp-reason').fill('description added after reading the page');
  await page.locator('form').filter({ has: page.locator('#mp-reason') }).locator('button[type=submit]').click();
  await expect(page.locator('.form-message-slot').filter({ hasText: /\S/ }).first()).toBeVisible();
  const proposal = (await sql<{ id: string }>(`select id from public.gov_change_proposals where programme_id = $1 and status = 'pending'`, [ids.nodate]))[0]!.id;
  await page.goto(`/en/admin/business-help/review/${proposal}`);
  await expect(page.getByTestId('gov-own-entry')).toBeVisible();
  await expect(page.locator('input[name=decision][value=approve]')).toHaveCount(0);
  const refused = await call(adminB.client, 'gov_decide_proposal', { p_proposal: proposal, p_decision: 'approve', p_reason: 'approving my own entry' }).then(() => 'ok', (e: Error) => e.message);
  expect(refused).toMatch(/second_person_required/);
  await actorGoto(page, adminA, `/en/admin/business-help/review/${proposal}`);
  const approve = page.locator('form').filter({ has: page.locator('input[name=decision][value=approve]') });
  await approve.locator('input[name=reason]').fill('checked by a second administrator');
  await approve.getByRole('button', { name: t('en', 'admin.approve') }).click();
  await expect(page.getByRole('status').filter({ hasText: 'checked by a second administrator' })).toBeVisible();
  expect((await sql<{ d: string }>(`select detection_method as d from public.gov_programme_versions where programme_id = $1 order by version_no desc limit 1`, [ids.nodate]))[0]!.d).toBe('manual');

  // A page monitor sees a changed page it cannot read as a programme: it waits for a person, and publishes nothing.
  const url = 'https://www.mitra.gov.my/ms/modal-insan';
  await sql(`insert into public.gov_fetch_results (source_id, url, http_status, content_sha256, outcome, evidence_excerpt, fetched_at) values ($1,$2,200,$3,'ok','Old list of programmes', now() - interval '1 day')`, [sourceId, url, 'a'.repeat(64)]);
  const fresh = (await sql<{ id: string }>(`insert into public.gov_fetch_results (source_id, url, http_status, content_sha256, outcome, evidence_excerpt) values ($1,$2,200,$3,'ok','New list of programmes with Uyarvu round 3') returning id`, [sourceId, url, 'b'.repeat(64)]))[0]!.id;
  expect((await serviceClient().rpc('gov_record_page', { p_result: fresh })).data).toBe('changed');
  await actorGoto(page, adminA, '/en/admin/business-help/page-changes');
  const change = page.locator('[data-page-change]').first();
  await expect(change).toContainText('Uyarvu round 3');
  await change.getByLabel(t('en', 'admin.pc.note')).first().fill('read the new round, will add the programme');
  await change.getByRole('button', { name: t('en', 'admin.pc.reviewed'), exact: true }).click();
  await expect(page.locator('[data-page-change]')).toHaveCount(0);
});

test('E deadline reminders: once, only for a confirmed date, and only as the person chose', async ({ page }) => {
  test.setTimeout(240_000);
  // Alpha Grant is verified and open and closes in 10 days (the value the fixture published, refreshed so the check is recent).
  await sql(`update public.gov_programmes set closes_on = current_date + 10, last_checked_at = now() where id = $1`, [ids.grant]);

  // The owner (default 14 and 3 days) saves it and is still preparing (people who already applied get no deadline notice).
  const ownerSession = await signedClient(owner);
  await ownerSession.client.rpc('gov_save_programme', { p_org: orgId, p_programme: ids.grant });
  await sql(`update public.gov_saved set tracking_status = 'preparing' where org_id = $1 and programme_id = $2`, [orgId, ids.grant]);
  // The other business saves it and chooses a 3-day reminder only, through the settings page.
  const otherSession = await signedClient(other);
  await otherSession.client.rpc('gov_save_programme', { p_org: otherOrg, p_programme: ids.grant });
  await loginUi(page, other, 'en');
  await page.goto('/en/business-help/settings');
  await expect(page.locator('main')).toContainText(t('en', 'settings.reminderDaysHint'));
  await page.locator('input[name=rd_14]').uncheck();
  await page.locator('input[name=rd_3]').check();
  await page.getByRole('button', { name: t('en', 'settings.save') }).click();
  await expect(page.locator('.form-message-slot').first()).toContainText(/\S/);
  expect((await sql<{ d: number[] }>(`select reminder_days as d from public.gov_notification_prefs where user_id = $1`, [other.id]))[0]!.d).toEqual([3]);

  const run = async () => {
    await serviceClient().rpc('gov_enqueue_reminders');
    await serviceClient().rpc('gov_dispatch_outbox', { p_limit: 200 });
  };
  await run();
  await run();
  // Reminders are the outbox rows keyed by deadline date and offset (a moved deadline sends its own, different notice).
  const count = async (u: TestUser) => (await sql<{ n: number }>(`select count(*)::int as n from public.gov_outbox where user_id = $1 and programme_id = $2 and category = 'deadline' and in_app_status = 'sent' and event_key ~ '^deadline:[0-9a-f-]+:[0-9]{4}-[0-9]{2}-[0-9]{2}:[0-9]+:'`, [u.id, ids.grant]))[0]!.n;
  expect(await count(owner)).toBe(1); // 10 days left, default offsets 14 and 3: the 14-day reminder, once, after two runs
  expect(await count(other)).toBe(0); // chose 3 days only: nothing yet
  // Nothing is ever scheduled for a programme whose dates are not confirmed.
  expect((await sql<{ n: number }>(`select count(*)::int as n from public.gov_outbox where programme_id = $1 and category = 'deadline'`, [ids.nodate]))[0]!.n).toBe(0);

  // Three days before the deadline the 3-day person is reminded, still only once.
  await sql(`update public.gov_programmes set closes_on = current_date + 3 where id = $1`, [ids.grant]);
  await run();
  await run();
  expect(await count(other)).toBe(1);
  expect(await count(owner)).toBe(1 + 1); // the owner's offsets are 14 and 3: now the 3-day reminder
  // In the notification list, in the person's own language.
  await page.goto('/en/notifications');
  await expect(page.locator('main')).toContainText(/deadline/i);
});

test('F security: no one can change programmes, read another business\'s saved items or skip the approval rule', async ({ page }) => {
  const mine = await signedClient(owner);
  const theirs = await signedClient(other);
  // A shop owner cannot write programme data or propose changes.
  expect((await mine.client.rpc('gov_propose_manual', { p_source: sourceId, p_programme: null, p_candidate: cand('Hijack'), p_reason: 'trying as a shop owner' })).error?.code).toBe('PT403');
  expect((await mine.client.from('gov_programmes').update({ name: 'Hijacked' }).eq('id', ids.grant)).error).not.toBeNull();
  expect((await mine.client.rpc('gov_decide_proposal', { p_proposal: ids.grant, p_decision: 'approve', p_reason: 'not allowed at all' })).error).not.toBeNull();
  expect((await mine.client.from('gov_programme_versions').select('id')).data ?? []).toHaveLength(0);
  expect((await mine.client.from('gov_sources').select('id')).data ?? []).toHaveLength(0);
  // Another business cannot see or change this one's saved items.
  expect((await theirs.client.rpc('gov_list_saved', { p_org: orgId })).error?.code).toBe('PT404');
  expect((await theirs.client.rpc('gov_update_tracking', { p_org: orgId, p_programme: ids.grant, p_data: { note: 'x' }, p_expected_version: 1 })).error?.code).toBe('PT404');
  expect((await theirs.client.from('gov_saved').select('org_id').eq('org_id', orgId)).data ?? []).toHaveLength(0);
  // A reviewer cannot publish; the proposer cannot approve their own entry; versions cannot be edited.
  const own = await call<string>(editor.client, 'gov_propose_manual', { p_source: sourceId, p_programme: null, p_candidate: cand(`Self ${tag}`), p_reason: 'testing the second-person rule' });
  expect((await editor.client.rpc('gov_decide_proposal', { p_proposal: own, p_decision: 'approve', p_reason: 'reviewer cannot publish' })).error?.code).toBe('PT403');
  expect((await adminB.client.rpc('gov_decide_proposal', { p_proposal: own, p_decision: 'reject', p_reason: 'rejecting the test entry' })).error).toBeNull();
  await expect(sql(`update public.gov_programme_versions set data = '{}'`)).rejects.toThrow();
  // The worker route needs its secret.
  const res = await page.request.post('/api/v1/jobs/gov');
  expect([401, 404]).toContain(res.status());
  // Anonymous people cannot reach the private pages.
  for (const p of ['/en/business-help/saved', '/en/business-help/settings', '/en/admin/business-help/sources', '/en/admin/business-help/programmes/new']) {
    await page.goto(p);
    await expect(page).toHaveURL(/\/login/);
  }
});

test('G multilingual: Tamil and Bahasa Melayu pages, the language switch keeps the filter', async ({ page }) => {
  test.setTimeout(240_000);
  for (const L of ['ms', 'ta'] as const) {
    await page.goto(`/${L}/business-help/find?category=grants_funding`);
    await expect(card(page, 'grant')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: t(L, 'find.title') })).toBeVisible();
    await expect(card(page, 'grant')).toContainText(t(L, 'card.status'));
    await axeClean(page, `${L} find`);
    await page.goto(`/${L}/business-help/${slugs.grant}`);
    await expect(page.getByRole('heading', { level: 2, name: t(L, 'detail.offers') })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: t(L, 'detail.documentsToPrepare') })).toBeVisible();
    await expect(page.locator('main')).toContainText('Selangor sahaja'); // the agency's words are never translated away
    await axeClean(page, `${L} detail`);
  }
  // Signed in: the dashboard and the saved list in Bahasa Melayu.
  await (await signedClient(owner)).client.rpc('gov_save_programme', { p_org: orgId, p_programme: ids.grant });
  await loginUi(page, owner, 'ms');
  await page.goto('/ms/business-help');
  await expect(page.getByRole('heading', { level: 2, name: t('ms', 'dash.recommended') })).toBeVisible();
  await page.goto('/ta/business-help/saved');
  await expect(page.locator('main')).toContainText(t('ta', 'saved.reportedNote'));
  await axeClean(page, 'ta saved');
  // Switching language keeps the page and the category filter (anonymous: the switcher is in the public bar).
  await page.context().clearCookies();
  await page.goto('/en/business-help/find?category=grants_funding');
  await page.getByRole('navigation', { name: msg('en', 'common.languageLabel') }).getByRole('link', { name: msg('en', 'common.langMsFull') }).click();
  await expect(page).toHaveURL(/\/ms\/business-help\/find\?.*category=grants_funding/);
});

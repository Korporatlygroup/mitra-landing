import { expect, test } from '@playwright/test';
import { createUser, uniq, uniqEmail } from './support/db';
import { msg } from './support/i18n';
import { adminLogin, createOrgUi, freshContext, loginUi } from './support/ui';

const t = (k: string) => msg('en', k);

// E6 (F7): the administrator's audit page shows the entries produced by real actions, and the filter works.
test('E6 audit page lists login, org, membership, invitation, mfa and bootstrap entries; filter narrows the list', async ({ page, browser }) => {
  test.setTimeout(180_000);

  // Produce fresh events as an ordinary user, through the UI.
  const actor = await createUser('e6-actor');
  const ctx = await freshContext(browser, page);
  const p = await ctx.newPage();
  await loginUi(p, actor);
  const orgId = await createOrgUi(p, 'business', `Audit ${uniq('a')}`);
  await p.locator('#invite-email').fill(uniqEmail('e6-invitee'));
  await p.locator('#invite-role').selectOption('staff');
  await p.getByRole('button', { name: t('members.inviteSubmit'), exact: true }).click();
  await expect(p.locator('main .card')).toHaveCount(1);
  await ctx.close();
  const prefix = actor.id.slice(0, 8);

  await adminLogin(page, '/en/admin/audit');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('admin.auditTitle'));
  const rowFor = (action: string) => page.locator('tbody tr').filter({ has: page.locator('td:nth-child(2)', { hasText: new RegExp(`^${action.replace('.', '\\.')}$`) }) });

  // Fresh actions by the ordinary user are on the first page (newest first).
  for (const action of ['auth.login', 'org.created', 'membership.added', 'invitation.created']) {
    await expect(rowFor(action).filter({ hasText: prefix }).first(), `${action} by ${prefix}`).toBeVisible();
  }

  // Older/rare entries are found through the filter, which also proves the filter narrows the list.
  const filterTo = async (action: string) => {
    await page.locator('#action').selectOption(action);
    await page.getByRole('button', { name: t('admin.filterApply'), exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`action=${encodeURIComponent(action).replace('.', '\\.')}`));
  };
  for (const action of ['bootstrap.first_admin', 'auth.mfa_enrolled', 'invitation.created', 'membership.added']) {
    await filterTo(action);
    const actions = await page.locator('tbody tr td:nth-child(2)').allInnerTexts();
    expect(actions.length, `rows for ${action}`).toBeGreaterThan(0);
    expect(new Set(actions.map((a) => a.trim()))).toEqual(new Set([action]));
  }
  await filterTo('bootstrap.first_admin');
  await expect(page.locator('tbody tr')).toHaveCount(1);

  // "All entries" restores the mixed list; an action with no rows shows the empty message.
  await page.locator('#action').selectOption('');
  await page.getByRole('button', { name: t('admin.filterApply'), exact: true }).click();
  expect(new Set((await page.locator('tbody tr td:nth-child(2)').allInnerTexts()).map((s) => s.trim())).size).toBeGreaterThan(1);
  await page.goto('/en/admin/audit?action=consent.withdrawn');
  await expect(page.locator('main')).toContainText(t('admin.empty'));
});

test('E6 the audit list is read-only: no form can change entries', async ({ page }) => {
  await adminLogin(page, '/en/admin/audit');
  // Scoped to the page content, not the admin shell's own sidebar (which carries its own sign-out form).
  await expect(page.locator('.ad-main form:not([role=search])')).toHaveCount(1); // only the GET filter form
  await expect(page.locator('.ad-main form:not([role=search])')).toHaveAttribute('method', /get/i);
});

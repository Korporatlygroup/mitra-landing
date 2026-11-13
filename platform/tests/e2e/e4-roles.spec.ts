import { expect, test } from '@playwright/test';
import { addMember, countInvitations, createOrgAs, createUser, roleOf, rpcFromPage, signedClient, uniq } from './support/db';
import { msg } from './support/i18n';
import { loginUi } from './support/ui';

const t = (k: string) => msg('en', k);

async function org() {
  const owner = await createUser('e4-owner');
  const orgId = await createOrgAs(owner, 'business', `Roles ${uniq('r')}`);
  return { owner, orgId };
}

test('E4 the last owner cannot leave or be demoted: the UI shows the error and the role is unchanged', async ({ page }) => {
  const { owner, orgId } = await org();
  const second = await createUser('e4-second');
  await addMember(orgId, second.id, 'owner');

  // Owner 1 demotes owner 2 through the UI (allowed: it is not the last owner), leaving owner 1 as the only owner.
  await loginUi(page, owner);
  await page.goto(`/en/orgs/${orgId}/members`);
  const row2 = page.locator('tr', { hasText: second.name });
  await row2.locator('select[name=role]').selectOption('manager');
  await row2.getByRole('button', { name: t('members.changeRole') }).click();
  await expect.poll(() => roleOf(orgId, second.id)).toBe('manager');

  // The sole owner has no role control for themselves; leaving is refused with the last-owner message.
  await page.goto(`/en/orgs/${orgId}/members`);
  const me = page.locator('tr', { hasText: new RegExp(owner.name + '(?![-w])') });
  await expect(me.locator('select[name=role]')).toHaveCount(0);
  await me.getByRole('button', { name: t('members.leave') }).click();
  await expect(page.locator('main [role=alert]').filter({ hasText: t('errors.last_owner') })).toBeVisible();
  expect(await roleOf(orgId, owner.id)).toBe('owner');

  // Direct attempts: demoting yourself, and removing the last owner as the manager, are both rejected.
  const o = await signedClient(owner);
  const selfDemote = await rpcFromPage(page, o.accessToken, 'set_member_role', { p_org: orgId, p_user: owner.id, p_role: 'manager' });
  expect(selfDemote.status).toBeGreaterThanOrEqual(400);
  const m = await signedClient(second);
  const kick = await rpcFromPage(page, m.accessToken, 'remove_member', { p_org: orgId, p_user: owner.id });
  expect(kick.status).toBeGreaterThanOrEqual(400);
  const leave = await rpcFromPage(page, o.accessToken, 'remove_member', { p_org: orgId, p_user: owner.id });
  expect(leave.status).toBeGreaterThanOrEqual(400);
  expect(leave.body?.message).toBe('last_owner');
  expect(await roleOf(orgId, owner.id)).toBe('owner');
});

test('E4 a member cannot change their own role (no control; direct attempt rejected)', async ({ page }) => {
  const { orgId } = await org();
  const staff = await createUser('e4-staff');
  await addMember(orgId, staff.id, 'staff');
  await loginUi(page, staff);
  await page.goto(`/en/orgs/${orgId}/members`);
  await expect(page.locator('main')).toContainText(t('members.readOnly'));
  await expect(page.locator('select[name=role]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: t('members.changeRole') })).toHaveCount(0);

  const s = await signedClient(staff);
  const r = await rpcFromPage(page, s.accessToken, 'set_member_role', { p_org: orgId, p_user: staff.id, p_role: 'owner' });
  expect(r.status).toBeGreaterThanOrEqual(400);
  expect(await roleOf(orgId, staff.id)).toBe('staff');
});

test('E4 a manager cannot grant owner: the control is absent and direct attempts are rejected', async ({ page }) => {
  const { orgId } = await org();
  const manager = await createUser('e4-manager');
  const staff = await createUser('e4-staffb');
  await addMember(orgId, manager.id, 'manager');
  await addMember(orgId, staff.id, 'staff');
  await loginUi(page, manager);
  await page.goto(`/en/orgs/${orgId}/members`);

  const optionTexts = async (sel: string) => (await page.locator(`${sel} option`).allInnerTexts()).map((s) => s.trim());
  const rowSelect = `tr:has-text("${staff.name}") select[name=role]`;
  expect(await optionTexts(rowSelect)).not.toContain(t('roles.owner'));
  expect(await optionTexts('#invite-role')).not.toContain(t('roles.owner'));
  expect(await optionTexts('#invite-role')).toContain(t('roles.manager'));

  // Direct attempts with the manager's own token, from the page.
  const m = await signedClient(manager);
  const grant = await rpcFromPage(page, m.accessToken, 'set_member_role', { p_org: orgId, p_user: staff.id, p_role: 'owner' });
  expect(grant.status).toBeGreaterThanOrEqual(400);
  expect(grant.body?.message).toBe('cannot_grant_above_own_role');
  const invites = await countInvitations(orgId);
  const invite = await rpcFromPage(page, m.accessToken, 'create_invitation', { p_org: orgId, p_email: `${uniq('x')}@example.test`, p_role: 'owner' });
  expect(invite.status).toBeGreaterThanOrEqual(400);
  expect(await countInvitations(orgId)).toBe(invites);
  expect(await roleOf(orgId, staff.id)).toBe('staff');

  // A manager can still manage lower roles through the UI.
  const row = page.locator('tr', { hasText: staff.name });
  await row.locator('select[name=role]').selectOption('viewer');
  await row.getByRole('button', { name: t('members.changeRole') }).click();
  await expect.poll(() => roleOf(orgId, staff.id)).toBe('viewer');
});

import { expect, test, type Page } from '@playwright/test';
import { invitationState, addMember, countMembers, createOrgAs, createUser, roleOf, sha256hex, sql, uniq, uniqEmail } from './support/db';
import { freshContext, confirmEmailUi, loginUi, logoutUi, signUpUi } from './support/ui';
import { inviteLink, tokenOf, waitForMail } from './support/mail';
import { msg } from './support/i18n';
import { strongPassword } from './support/db';

const INVALID = msg('en', 'errors.invalid_invitation');

async function sendInvite(page: Page, orgId: string, email: string, role = 'viewer') {
  await page.goto(`/en/orgs/${orgId}/members`);
  await page.locator('#invite-email').fill(email);
  await page.locator('#invite-role').selectOption(role);
  await page.getByRole('button', { name: msg('en', 'members.inviteSubmit'), exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: msg('en', 'members.invited') })).toBeVisible();
}

async function invitedLink(email: string) {
  const mail = await waitForMail(email, { match: INVITE_ANY });
  return { mail, link: inviteLink(mail) };
}
const INVITE_ANY = /\/(?:en|ta)\/invite\/[0-9a-f]{64}/;

test('E3 owner invites a new person: bilingual email, sign-up, accept, then the token cannot be reused', async ({ page, browser }) => {
  const owner = await createUser('e3-owner');
  const orgName = `Invite Co ${uniq('o')}`;
  const orgId = await createOrgAs(owner, 'business', orgName);
  await loginUi(page, owner);

  const inviteeEmail = uniqEmail('e3-new');
  await sendInvite(page, orgId, inviteeEmail, 'staff');
  await expect(page.locator('.card', { hasText: inviteeEmail })).toContainText(msg('en', 'roles.staff'));

  // The email carries both languages and a one-time link; the token is stored only as a hash.
  const { mail, link } = await invitedLink(inviteeEmail);
  // The subject is fixed (no organisation name in headers); the body quotes the name as data.
  expect(mail.subject).toBe(`${msg('en', 'email.invite.subject')} / ${msg('ta', 'email.invite.subject')}`);
  expect(mail.subject).not.toContain(orgName);
  for (const l of ['en', 'ta'] as const) {
    expect(mail.text).toContain(msg(l, 'email.invite.intro', { org: `“${orgName}”` }));
  }
  const stored = await sql<{ token_hash: string }>(`select token_hash from public.invitations where org_id = $1 and email = $2`, [orgId, inviteeEmail]);
  expect(stored[0]!.token_hash).toBe(sha256hex(tokenOf(link)));
  expect(stored[0]!.token_hash).not.toContain(tokenOf(link));

  // Invitee, signed out: sees the sign-in / create-account choice, then registers with the invited address.
  const ctx2 = await freshContext(browser, page);
  const p2 = await ctx2.newPage();
  await p2.goto(link);
  await expect(p2.getByRole('heading', { level: 1 })).toHaveText(msg('en', 'invite.title'));
  await expect(p2.locator('main').getByRole('link', { name: msg('en', 'invite.signUp') })).toBeVisible();
  const password = strongPassword();
  await signUpUi(p2, { locale: 'en', name: 'Invitee', email: inviteeEmail, password });
  await confirmEmailUi(p2, inviteeEmail);
  await p2.goto(link);
  await expect(p2).toHaveURL(/\/en\/orgs$/);
  await expect(p2.locator('li.card', { hasText: orgName })).toContainText(msg('en', 'roles.staff'));
  expect(await roleOf(orgId, (await sql<{ id: string }>(`select id from auth.users where email = $1`, [inviteeEmail]))[0]!.id)).toBe('staff');

  // Reusing the token fails with the generic message and changes nothing.
  const before = await countMembers(orgId);
  await p2.goto(link);
  await expect(p2.locator('main [role=alert]')).toContainText(INVALID);
  expect(await countMembers(orgId)).toBe(before);

  // A third, different user using the same (spent) token also gets the generic message.
  const other = await createUser('e3-other');
  const ctx3 = await freshContext(browser, page);
  const p3 = await ctx3.newPage();
  await loginUi(p3, other);
  await p3.goto(link);
  await expect(p3.locator('main [role=alert]')).toContainText(INVALID);
  await ctx2.close();
  await ctx3.close();
});

test('E3 a wrong-email account gets the generic invalid-invitation message and the invitation stays usable', async ({ page, browser }) => {
  const owner = await createUser('e3w-owner');
  const orgId = await createOrgAs(owner, 'business', `Wrong ${uniq('w')}`);
  const invitee = await createUser('e3w-right');
  const stranger = await createUser('e3w-wrong');
  await loginUi(page, owner);
  await sendInvite(page, orgId, invitee.email, 'viewer');
  const { link } = await invitedLink(invitee.email);

  const ctx = await freshContext(browser, page);
  const p = await ctx.newPage();
  await loginUi(p, stranger);
  await p.goto(link);
  await expect(p.getByRole('heading', { level: 1 })).toHaveText(msg('en', 'invite.failedTitle'));
  await expect(p.locator('main [role=alert]')).toContainText(INVALID);
  // Same text as a made-up token: nothing reveals that the token exists.
  await p.goto(`/en/invite/${'0'.repeat(64)}`);
  await expect(p.locator('main [role=alert]')).toContainText(INVALID);
  expect(await roleOf(orgId, stranger.id)).toBeNull();
  const inv = await sql(`select accepted_at from public.invitations where org_id = $1 and email = $2`, [orgId, invitee.email]);
  expect(inv[0]!.accepted_at).toBeNull();
  await ctx.close();

  // The rightful invitee can still accept it.
  const ctx2 = await freshContext(browser, page);
  const p2 = await ctx2.newPage();
  await loginUi(p2, invitee);
  await p2.goto(link);
  await expect(p2).toHaveURL(/\/en\/orgs$/);
  expect(await roleOf(orgId, invitee.id)).toBe('viewer');
  await ctx2.close();
});

test('E3 a revoked invitation cannot be accepted', async ({ page, browser }) => {
  const owner = await createUser('e3r-owner');
  const orgId = await createOrgAs(owner, 'business', `Revoke ${uniq('r')}`);
  const invitee = await createUser('e3r-in');
  await loginUi(page, owner);
  await sendInvite(page, orgId, invitee.email, 'viewer');
  const { link } = await invitedLink(invitee.email);

  await page.locator('.card', { hasText: invitee.email }).getByRole('button', { name: msg('en', 'members.revoke') }).click();
  await expect(page.locator('main')).toContainText(msg('en', 'members.pendingNone'));

  const ctx = await freshContext(browser, page);
  const p = await ctx.newPage();
  await loginUi(p, invitee);
  await p.goto(link);
  await expect(p.locator('main [role=alert]')).toContainText(INVALID);
  expect(await roleOf(orgId, invitee.id)).toBeNull();
  await ctx.close();
});

test('E3 an expired invitation cannot be accepted', async ({ page, browser }) => {
  const owner = await createUser('e3x-owner');
  const orgId = await createOrgAs(owner, 'business', `Expire ${uniq('x')}`);
  const invitee = await createUser('e3x-in');
  await loginUi(page, owner);
  await sendInvite(page, orgId, invitee.email, 'viewer');
  const { link } = await invitedLink(invitee.email);

  // Test setup only, as postgres: age the invitation past its expiry.
  await sql(`update public.invitations set expires_at = now() - interval '1 hour' where org_id = $1 and email = $2`, [orgId, invitee.email]);

  const ctx = await freshContext(browser, page);
  const p = await ctx.newPage();
  await loginUi(p, invitee);
  await p.goto(link);
  await expect(p.locator('main [role=alert]')).toContainText(INVALID);
  expect(await roleOf(orgId, invitee.id)).toBeNull();
  await ctx.close();
});

test('E3 members page: a manager can invite, a viewer sees no invite form', async ({ page }) => {
  const owner = await createUser('e3v-owner');
  const orgId = await createOrgAs(owner, 'business', `Roles ${uniq('v')}`);
  const viewer = await createUser('e3v-viewer');
  await addMember(orgId, viewer.id, 'viewer');
  await loginUi(page, viewer);
  await page.goto(`/en/orgs/${orgId}/members`);
  await expect(page.locator('main')).toContainText(msg('en', 'members.readOnly'));
  await expect(page.locator('#invite-email')).toHaveCount(0);
  await logoutUi(page);
});

test('E3 an invitation stops working once the inviter no longer holds authority', async ({ page, browser }) => {
  const owner1 = await createUser('e3a-owner1');
  const owner2 = await createUser('e3a-owner2');
  const orgId = await createOrgAs(owner1, 'business', `Authority ${uniq('z')}`);
  await addMember(orgId, owner2.id, 'owner');
  const invitee = await createUser('e3a-in');
  await loginUi(page, owner1);
  await sendInvite(page, orgId, invitee.email, 'staff');
  const { link } = await invitedLink(invitee.email);

  // Test setup: the inviter is demoted to staff (no longer owner/manager).
  await addMember(orgId, owner1.id, 'staff');

  const ctx = await freshContext(browser, page);
  const p = await ctx.newPage();
  await loginUi(p, invitee);
  await p.goto(link);
  await expect(p.locator('main [role=alert]')).toContainText(INVALID);
  expect(await roleOf(orgId, invitee.id)).toBeNull();
  expect((await invitationState(orgId, invitee.email))!.accepted_at).toBeNull();
  await ctx.close();
});

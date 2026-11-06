import { expect, test } from '@playwright/test';
import { createUser, mitraOrgId, roleOf, rpcFromPage, signedClient, sql } from './support/db';
import { msg } from './support/i18n';
import { freshCode } from './support/totp';
import { addMitraMember, loginUi, startEnrolAndReadSecret, submitCode } from './support/ui';

const t = (k: string) => msg('en', k);

// E5/E4: the MITRA organisation must always keep one super administrator (last_admin).
test('E5 the last super administrator cannot leave or be demoted (last_admin)', async ({ page }) => {
  test.setTimeout(180_000);
  const mitra = await mitraOrgId();
  const sole = await createUser('e5-sole-admin', { name: `Sole ${Math.random().toString(36).slice(2, 10)}` });
  await addMitraMember(sole.id, 'admin_super');

  // Test setup only: temporarily make `sole` the only super administrator (restored in finally; specs run serially).
  const others = (
    await sql<{ user_id: string }>(
      `select user_id from public.memberships where org_id = $1 and role = 'admin_super' and status = 'active' and user_id <> $2`,
      [mitra, sole.id],
    )
  ).map((r) => r.user_id);
  try {
    for (const id of others) await sql(`update public.memberships set role = 'admin_ops' where org_id = $1 and user_id = $2`, [mitra, id]);

    await loginUi(page, sole);
    await page.goto('/en/admin/users');
    await expect(page).toHaveURL(/\/en\/mfa\/enrol/);
    const secret = await startEnrolAndReadSecret(page);
    await submitCode(page, freshCode(secret));
    await expect(page).toHaveURL(/\/en\/admin\/users$/);

    // No role control for yourself; leaving is refused with the last_admin message.
    const me = page.locator('tr', { hasText: new RegExp(sole.name + '(?![-\\w])') });
    await expect(me.locator('select[name=role]')).toHaveCount(0);
    await me.getByRole('button', { name: t('members.leave') }).click();
    await expect(page.locator('main [role=alert]').filter({ hasText: t('errors.last_admin') })).toBeVisible();
    expect(await roleOf(mitra, sole.id)).toBe('admin_super');

    // Direct attempts with the admin's own aal2 token are refused too, and nothing changes.
    const s = await signedClient(sole);
    const factor = (await s.client.auth.mfa.listFactors()).data!.totp[0]!;
    const ch = await s.client.auth.mfa.challenge({ factorId: factor.id });
    const ver = await s.client.auth.mfa.verify({ factorId: factor.id, challengeId: ch.data!.id, code: freshCode(secret) });
    expect(ver.error).toBeNull();
    const token = (await s.client.auth.getSession()).data.session!.access_token;
    const leave = await rpcFromPage(page, token, 'remove_member', { p_org: mitra, p_user: sole.id });
    expect(leave.status).toBeGreaterThanOrEqual(400);
    // The database reports its generic last-owner key for the MITRA org; the app maps it to the last_admin text.
    expect(['last_admin', 'last_owner']).toContain(leave.body?.message);
    const demote = await rpcFromPage(page, token, 'set_member_role', { p_org: mitra, p_user: sole.id, p_role: 'admin_ops' });
    expect(demote.status).toBeGreaterThanOrEqual(400);
    expect(await roleOf(mitra, sole.id)).toBe('admin_super');
  } finally {
    for (const id of others) await sql(`update public.memberships set role = 'admin_super' where org_id = $1 and user_id = $2`, [mitra, id]);
  }
});

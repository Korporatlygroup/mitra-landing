import { expect, test } from '@playwright/test';
import { createUser, signedClient, sql, uniq } from './support/db';
import { freshCode } from './support/totp';

// E6 (audit derivation): authentication events are written by the database (triggers on GoTrue tables), not
// reported by the app. Signing in through the GoTrue endpoint directly, with no browser and no app code, still
// leaves the rows, and the actor is the authenticated user.
test('E6 auth.login, auth.mfa_enrolled and auth.mfa_verified are written by the DB for direct GoTrue calls', async () => {
  const u = await createUser('e6-direct');
  const rows = async (action: string) =>
    sql<{ details: Record<string, unknown> }>(`select details from public.audit_log where actor_user_id = $1 and action = $2`, [u.id, action]);
  expect(await rows('auth.login')).toHaveLength(0);

  const s = await signedClient(u); // POST /auth/v1/token?grant_type=password
  await expect.poll(async () => (await rows('auth.login')).length).toBe(1);
  expect((await rows('auth.login'))[0]!.details).toMatchObject({ aal: 'aal1' });

  const { data: enr, error } = await s.client.auth.mfa.enroll({ factorType: 'totp', friendlyName: uniq('totp') });
  expect(error).toBeNull();
  const { data: ch } = await s.client.auth.mfa.challenge({ factorId: enr!.id });
  const ver = await s.client.auth.mfa.verify({ factorId: enr!.id, challengeId: ch!.id, code: freshCode(enr!.totp.secret) });
  expect(ver.error).toBeNull();
  await expect.poll(async () => (await rows('auth.mfa_enrolled')).length).toBe(1);
  await expect.poll(async () => (await rows('auth.mfa_verified')).length).toBe(1);

  // A second direct sign-in adds a second login row.
  await signedClient(u);
  await expect.poll(async () => (await rows('auth.login')).length).toBe(2);
});

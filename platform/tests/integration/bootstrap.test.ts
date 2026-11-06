import { afterAll, describe, expect, it } from 'vitest';
import { anonClient, cleanupUsers, createConfirmedUser, resetBootstrapAfterTest, serviceClient, signIn, sql } from './helpers';

// bootstrap_first_admin through the real API (PostgREST + service key).
// NOTE: pgTAP runs the function through a plain psql session; only PostgREST applies pg-safeupdate,
// so this file is what catches statements that PostgREST rejects.

afterAll(async () => {
  await cleanupUsers();
  await resetBootstrapAfterTest();
});

async function freshState(): Promise<boolean> {
  const s = await sql<{ done: boolean; admins: number }>(
    `select (select completed_at is not null from private.bootstrap_state) as done,
            (select count(*)::int from public.memberships where role = 'admin_super') as admins`,
  );
  return !s[0]!.done && s[0]!.admins === 0;
}

describe('bootstrap_first_admin over the API', () => {
  it('is not callable by anon or a user session', async () => {
    const u = await signIn(await createConfirmedUser('bs'));
    expect((await anonClient().rpc('bootstrap_first_admin', { p_email: u.user.email })).error?.code).toBe('42501');
    expect((await u.client.rpc('bootstrap_first_admin', { p_email: u.user.email })).error?.code).toBe('42501');
  });

  it('fails for an unknown e-mail and for an unconfirmed user', async () => {
    const svc = serviceClient();
    const unknown = await svc.rpc('bootstrap_first_admin', { p_email: 'nobody-here@example.test' });
    // on an already-bootstrapped database the first check wins
    expect(['user_not_found_or_unconfirmed', 'already_bootstrapped']).toContain(unknown.error?.message);

    const { data, error } = await svc.auth.admin.createUser({
      email: `unconf-${Date.now()}@example.test`,
      password: 'Pw-unconfirmed-Aa1!',
      email_confirm: false,
    });
    expect(error).toBeNull();
    const r = await svc.rpc('bootstrap_first_admin', { p_email: data.user!.email });
    expect(['user_not_found_or_unconfirmed', 'already_bootstrapped']).toContain(r.error?.message);
    await svc.auth.admin.deleteUser(data.user!.id);
  });

  it('succeeds once for a confirmed user via PostgREST, then fails with already_bootstrapped', async (ctx) => {
    if (!(await freshState())) ctx.skip(); // only meaningful on a database that has not been bootstrapped yet
    const user = await createConfirmedUser('boot');
    const svc = serviceClient();
    const first = await svc.rpc('bootstrap_first_admin', { p_email: user.email });
    expect(first.error, 'bootstrap must work through PostgREST (pg-safeupdate rejects UPDATE without WHERE)').toBeNull();
    expect(first.data).toBe(user.id);

    const rows = await sql<{ role: string; type: string }>(
      `select m.role, o.type from public.memberships m join public.organisations o on o.id = m.org_id where m.user_id = $1`,
      [user.id],
    );
    expect(rows).toEqual([{ role: 'admin_super', type: 'mitra' }]);
    const audit = await sql<{ source: string }>(
      `select source from public.audit_log where action = 'bootstrap.first_admin' and details ->> 'user_id' = $1`,
      [user.id],
    );
    expect(audit).toEqual([{ source: 'bootstrap' }]);

    const other = await createConfirmedUser('boot2');
    const second = await svc.rpc('bootstrap_first_admin', { p_email: other.email });
    expect(second.status).toBe(409);
    expect(second.error?.message).toBe('already_bootstrapped');
  });
});

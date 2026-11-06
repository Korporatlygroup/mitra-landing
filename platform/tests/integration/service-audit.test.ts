import { afterAll, describe, expect, it } from 'vitest';
import { anonClient, cleanupUsers, createConfirmedUser, serviceClient, signIn, sql } from './helpers';

afterAll(cleanupUsers);

describe('(d) service-role audit RPC', () => {
  it('records an app-observed auth event (auth.logout) with the service key, source app-server and the given actor', async () => {
    const user = await createConfirmedUser('aud');
    const svc = serviceClient();
    const res = await svc.rpc('service_record_auth_event', { p_user: user.id, p_action: 'auth.logout', p_details: { via: 'integration-test' } });
    expect(res.error).toBeNull();
    const rows = await sql<{ source: string; actor_user_id: string; entity_id: string; details: { via: string } }>(
      `select source, actor_user_id, entity_id, details from public.audit_log where action = 'auth.logout' and actor_user_id = $1`,
      [user.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe('app-server');
    expect(rows[0]!.entity_id).toBe(user.id);
    expect(rows[0]!.details.via).toBe('integration-test');
  });

  it('rejects unknown actions and unknown users, writing nothing', async () => {
    const user = await createConfirmedUser('aud2');
    const svc = serviceClient();
    const bad = await svc.rpc('service_record_auth_event', { p_user: user.id, p_action: 'org.created' });
    expect(bad.status).toBe(422);
    expect(bad.error?.message).toBe('unknown_action');
    for (const dbOwned of ['auth.login', 'auth.signup', 'auth.mfa_verified', 'auth.mfa_enrolled']) {
      const r = await svc.rpc('service_record_auth_event', { p_user: user.id, p_action: dbOwned });
      expect(r.status, dbOwned).toBe(422);
      expect(r.error?.message).toBe('unknown_action');
    }
    const ghost = await svc.rpc('service_record_auth_event', { p_user: '00000000-0000-4000-8000-000000000000', p_action: 'auth.logout' });
    expect(ghost.status).toBe(404);
    expect(ghost.error?.message).toBe('unknown_user');
    const n = await sql<{ n: number }>(`select count(*)::int as n from public.audit_log where actor_user_id = $1 and action <> 'auth.signup' and action <> 'consent.granted'`, [user.id]);
    expect(n[0]!.n).toBe(0);
  });

  it('is not callable with a user session or the anon key', async () => {
    const s = await signIn(await createConfirmedUser('aud3'));
    const viaUser = await s.client.rpc('service_record_auth_event', { p_user: s.user.id, p_action: 'auth.logout' });
    expect(viaUser.error?.code).toBe('42501');
    const viaAnon = await anonClient().rpc('service_record_auth_event', { p_user: s.user.id, p_action: 'auth.logout' });
    expect(viaAnon.error?.code).toBe('42501');
  });
});

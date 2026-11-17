import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, cleanupUsers, createConfirmedUser, ensureMitraOrg, resetBootstrapAfterTest, signIn, sql, type Signed } from './helpers';

// Migration 229: the administrator MFA requirement is a policy row. Default = required. Switching it off removes only the aal2 condition;
// permissions, roles and conflict checks stay. The policy is always restored at the end.

let reviewer: Signed;
let plain: Signed;

beforeAll(async () => {
  reviewer = await signIn(await createConfirmedUser('pol-rev'));
  plain = await signIn(await createConfirmedUser('pol-usr'));
  const mitra = await ensureMitraOrg(reviewer.user.id);
  await addMember(mitra, reviewer.user.id, 'admin_review');
  await sql(`update private.auth_policy set enabled = true where key = 'admin_mfa_required'`);
});
afterAll(async () => {
  await sql(`update private.auth_policy set enabled = true, reason = 'default: strict' where key = 'admin_mfa_required'`);
  await cleanupUsers();
  await resetBootstrapAfterTest();
});

describe('admin MFA policy', () => {
  it('is required by default: an administrator without an MFA session is refused and the app is told so', async () => {
    expect((await reviewer.client.rpc('admin_mfa_required')).data).toBe(true);
    const r = await reviewer.client.rpc('list_duplicate_flags', { p_status: 'open' });
    expect(r.error?.message ?? '').toContain('forbidden');
  });

  it('switched off: the reviewer role works at a password-only session, other users still do not', async () => {
    await sql(`update private.auth_policy set enabled = false, reason = 'integration test' where key = 'admin_mfa_required'`);
    expect((await reviewer.client.rpc('admin_mfa_required')).data).toBe(false);
    const ok = await reviewer.client.rpc('list_duplicate_flags', { p_status: 'open' });
    expect(ok.error).toBeNull();
    const no = await plain.client.rpc('list_duplicate_flags', { p_status: 'open' });
    expect(no.error?.message ?? '').toContain('forbidden');
  });

  it('the policy table is not reachable by users, and only anon cannot read the switch', async () => {
    const t = await reviewer.client.from('auth_policy').select('*');
    expect(t.error !== null || (t.data ?? []).length === 0).toBe(true);
    const k = await sql<{ r: boolean; o: boolean }>(`select private.requires_mfa('owner','partner') r, private.requires_mfa('owner','business') o`);
    expect(k[0]).toEqual({ r: true, o: false });
  });
});

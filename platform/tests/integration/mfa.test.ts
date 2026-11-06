import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanupUsers,
  createConfirmedUser,
  currentAal,
  enrolAndVerifyTotp,
  resetBootstrapAfterTest,
  serviceClient,
  signIn,
  sql,
  uniqEmail,
  verifyFactor,
  type Signed,
} from './helpers';

// (c) MFA enforcement with a real TOTP factor (RFC 6238 generated in-test).
//
// First admin: bootstrap_first_admin through the service key when the shared DB is still un-bootstrapped.
// If bootstrap already happened (shared DB), the admin is promoted with direct SQL as postgres
// (test SETUP only, never a path available to the application).

let mitraOrg: string;
let admin: Signed;
let setupMode: 'bootstrap' | 'sql-promotion';

beforeAll(async () => {
  const user = await createConfirmedUser('adm');
  const svc = serviceClient();
  const boot = await svc.rpc('bootstrap_first_admin', { p_email: user.email });
  if (!boot.error) {
    setupMode = 'bootstrap';
  } else {
    // already bootstrapped (or bootstrap unavailable, see bootstrap.test.ts DEFECT D2): promote via SQL for setup only
    setupMode = 'sql-promotion';
    const existing = await sql<{ id: string }>(`select id from public.organisations where type = 'mitra'`);
    if (!existing.length) {
      await sql(`insert into public.organisations (type, name, created_by) values ('mitra', 'MITRA Administration', $1)`, [user.id]);
    }
    await sql(
      `insert into public.memberships (org_id, user_id, role)
       select id, $1, 'admin_super' from public.organisations where type = 'mitra'`,
      [user.id],
    );
  }
  mitraOrg = (await sql<{ id: string }>(`select id from public.organisations where type = 'mitra'`))[0]!.id;
  admin = await signIn(user);
});

afterAll(async () => {
  // Undo only what this file did to shared, single-use state; audit_log is never touched.
  await cleanupUsers(); // cascades the admin membership
  await resetBootstrapAfterTest();
});

describe('(c) MFA: admin RPCs and audit_log require aal2', () => {
  it('set-up path was recorded', () => {
    // documents which path ran; both are valid, see header comment
    expect(['bootstrap', 'sql-promotion']).toContain(setupMode);
  });

  it('a fresh admin session is aal1 and is denied admin RPCs and audit_log', async () => {
    expect(await currentAal(admin.client)).toBe('aal1');

    const inv = await admin.client.rpc('create_invitation', { p_org: mitraOrg, p_email: uniqEmail('newadmin'), p_role: 'admin_review' });
    expect(inv.status).toBe(403);
    expect(inv.error?.code).toBe('PT403');

    const audit = await admin.client.from('audit_log').select('id').limit(5);
    expect(audit.error).toBeNull();
    expect(audit.data).toEqual([]);

    const rm = await admin.client.rpc('set_member_role', { p_org: mitraOrg, p_user: admin.user.id, p_role: 'admin_ops' });
    expect(rm.status).toBe(403);
  });

  it('an enrolled but unverified factor does not raise the session level', async () => {
    const { data, error } = await admin.client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'pending-factor' });
    expect(error).toBeNull();
    expect(data!.totp.secret).toBeTruthy();
    expect(await currentAal(admin.client)).toBe('aal1');
    const inv = await admin.client.rpc('create_invitation', { p_org: mitraOrg, p_email: uniqEmail('x'), p_role: 'admin_review' });
    expect(inv.status).toBe(403);
    // clean the unverified factor so the next test enrols a clean one
    await admin.client.auth.mfa.unenroll({ factorId: data!.id });
  });

  it('a wrong TOTP code is rejected and the session stays aal1', async () => {
    const { data: enr } = await admin.client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'wrong-code' });
    const { data: ch } = await admin.client.auth.mfa.challenge({ factorId: enr!.id });
    const bad = await admin.client.auth.mfa.verify({ factorId: enr!.id, challengeId: ch!.id, code: '000000' });
    expect(bad.error).not.toBeNull();
    expect(await currentAal(admin.client)).toBe('aal1');
    await admin.client.auth.mfa.unenroll({ factorId: enr!.id });
  });

  it('after enrol + challenge + verify the session is aal2 and admin RPCs and audit_log succeed', async () => {
    const { factorId, secret } = await enrolAndVerifyTotp(admin.client);
    expect(await currentAal(admin.client)).toBe('aal2');

    const email = uniqEmail('newadmin');
    const inv = await admin.client.rpc('create_invitation', { p_org: mitraOrg, p_email: email, p_role: 'admin_review' });
    expect(inv.error).toBeNull();
    expect(inv.data.token).toMatch(/^[0-9a-f]{64}$/);

    const audit = await admin.client.from('audit_log').select('id, action, org_id').eq('org_id', mitraOrg).limit(50);
    expect(audit.error).toBeNull();
    expect(audit.data!.length).toBeGreaterThan(0);
    expect(audit.data!.map((r) => r.action)).toContain('invitation.created');

    // revoke the invitation we just made (cleanup of pending state; audit rows stay)
    const rv = await admin.client.rpc('revoke_invitation', { p_invitation: inv.data.invitation_id });
    expect(rv.error).toBeNull();

    // a brand new password sign-in is aal1 again => denied; verifying the existing factor upgrades it
    const again = await signIn(admin.user);
    expect(await currentAal(again.client)).toBe('aal1');
    const denied = await again.client.rpc('create_invitation', { p_org: mitraOrg, p_email: uniqEmail('y'), p_role: 'admin_review' });
    expect(denied.status).toBe(403);
    expect((await again.client.from('audit_log').select('id').limit(1)).data).toEqual([]);

    await verifyFactor(again.client, factorId, secret);
    expect(await currentAal(again.client)).toBe('aal2');
    const allowed = await again.client.rpc('create_invitation', { p_org: mitraOrg, p_email: uniqEmail('z'), p_role: 'admin_content' });
    expect(allowed.error).toBeNull();
    await again.client.rpc('revoke_invitation', { p_invitation: allowed.data.invitation_id });
  });
});

describe('(c) MFA: partner organisation owners', () => {
  it('a partner owner is denied owner actions at aal1 and allowed at aal2; a business owner never needs MFA', async () => {
    const partner = await signIn(await createConfirmedUser('ptn'));
    const biz = await signIn(await createConfirmedUser('biz'));
    const p = await partner.client.rpc('create_org', { p_type: 'partner', p_name: 'Integration Partner' });
    const b = await biz.client.rpc('create_org', { p_type: 'business', p_name: 'Integration Business' });
    expect(p.error).toBeNull();
    expect(b.error).toBeNull();

    expect((await biz.client.rpc('rename_org', { p_org: b.data, p_name: 'Business Renamed' })).error).toBeNull();

    const denied = await partner.client.rpc('rename_org', { p_org: p.data, p_name: 'Partner Renamed' });
    expect(denied.status).toBe(403);

    await enrolAndVerifyTotp(partner.client);
    expect(await currentAal(partner.client)).toBe('aal2');
    expect((await partner.client.rpc('rename_org', { p_org: p.data, p_name: 'Partner Renamed' })).error).toBeNull();
  });
});

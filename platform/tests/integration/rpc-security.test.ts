import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  API_URL,
  PUBLISHABLE_KEY,
  anonClient,
  cleanupUsers,
  createConfirmedUser,
  serviceClient,
  signIn,
  sql,
  uniqEmail,
  type Signed,
} from './helpers';

// Everything here goes through the real PostgREST HTTP API with real user JWTs.
// PostgREST maps SQLSTATE PTnnn to HTTP nnn, and 42501 (insufficient privilege) to 403 (401 for anon).

let owner: Signed;
let manager: Signed;
let staff: Signed;
let viewer: Signed;
let otherOwner: Signed;
let outsider: Signed;
let orgA: string;
let orgB: string;

async function invite(by: Signed, org: string, email: string, role: string) {
  return by.client.rpc('create_invitation', { p_org: org, p_email: email, p_role: role });
}
async function join(who: Signed, org: string, role: string) {
  const inv = await invite(owner, org, who.user.email, role);
  expect(inv.error).toBeNull();
  const acc = await who.client.rpc('accept_invitation', { p_token: inv.data.token });
  expect(acc.error).toBeNull();
}

beforeAll(async () => {
  owner = await signIn(await createConfirmedUser('own'));
  manager = await signIn(await createConfirmedUser('mgr'));
  staff = await signIn(await createConfirmedUser('stf'));
  viewer = await signIn(await createConfirmedUser('vwr'));
  otherOwner = await signIn(await createConfirmedUser('own2'));
  outsider = await signIn(await createConfirmedUser('out'));

  const a = await owner.client.rpc('create_org', { p_type: 'business', p_name: 'Integration Org A' });
  expect(a.error).toBeNull();
  orgA = a.data;
  const b = await otherOwner.client.rpc('create_org', { p_type: 'business', p_name: 'Integration Org B' });
  expect(b.error).toBeNull();
  orgB = b.data;
  await join(manager, orgA, 'manager');
  await join(staff, orgA, 'staff');
  await join(viewer, orgA, 'viewer');
});
afterAll(cleanupUsers);

describe('(b) RPC permission checks over HTTP with real JWTs', () => {
  it('viewer and staff sessions calling the RPCs directly get 403', async () => {
    for (const who of [viewer, staff]) {
      const inv = await invite(who, orgA, uniqEmail('x'), 'viewer');
      expect(inv.status).toBe(403);
      expect(inv.error?.code).toBe('PT403');

      const rm = await who.client.rpc('remove_member', { p_org: orgA, p_user: manager.user.id });
      expect(rm.status).toBe(403);
      expect(rm.error?.code).toBe('PT403');

      const role = await who.client.rpc('set_member_role', { p_org: orgA, p_user: manager.user.id, p_role: 'viewer' });
      expect(role.status).toBe(403);
      expect(role.error?.code).toBe('PT403');

      const ren = await who.client.rpc('rename_org', { p_org: orgA, p_name: 'Renamed by non-manager' });
      expect(ren.status).toBe(403);
    }
    const [{ name }] = await sql<{ name: string }>('select name from public.organisations where id = $1', [orgA]);
    expect(name).toBe('Integration Org A');
  });

  it('owner-only actions are denied to a manager; escalation attempts are rejected', async () => {
    const ren = await manager.client.rpc('rename_org', { p_org: orgA, p_name: 'Manager rename' });
    expect(ren.status).toBe(403);
    const up = await invite(manager, orgA, uniqEmail('up'), 'owner');
    expect(up.status).toBe(403);
    expect(up.error?.message).toBe('cannot_grant_above_own_role');
    const admin = await invite(manager, orgA, uniqEmail('adm'), 'admin_super');
    expect(admin.status).toBe(422);
    const self = await manager.client.rpc('set_member_role', { p_org: orgA, p_user: manager.user.id, p_role: 'owner' });
    expect(self.status).toBe(403);
    expect(self.error?.message).toBe('cannot_change_own_role');
    const rmOwner = await manager.client.rpc('remove_member', { p_org: orgA, p_user: owner.user.id });
    expect(rmOwner.status).toBe(403);
  });

  it('cross-tenant: org A users cannot see or act on org B', async () => {
    const orgs = await owner.client.from('organisations').select('id');
    expect(orgs.data?.map((o) => o.id)).toEqual([orgA]);
    const members = await owner.client.from('memberships').select('user_id').eq('org_id', orgB);
    expect(members.data).toEqual([]);
    const audit = await owner.client.from('audit_log').select('id').eq('org_id', orgB);
    expect(audit.data).toEqual([]);

    expect((await invite(owner, orgB, uniqEmail('x'), 'viewer')).status).toBe(403);
    expect((await owner.client.rpc('rename_org', { p_org: orgB, p_name: 'Hijacked' })).status).toBe(403);
    expect((await owner.client.rpc('remove_member', { p_org: orgB, p_user: otherOwner.user.id })).status).toBe(403);
    expect((await owner.client.rpc('set_member_role', { p_org: orgB, p_user: otherOwner.user.id, p_role: 'viewer' })).status).toBe(403);

    // forged ids: own org + foreign user
    const forged = await owner.client.rpc('remove_member', { p_org: orgA, p_user: otherOwner.user.id });
    expect(forged.status).toBe(404);

    // direct table writes are not possible at all
    const upd = await owner.client.from('organisations').update({ name: 'x' }).eq('id', orgB);
    expect(upd.error?.code).toBe('42501');
    const del = await owner.client.from('memberships').delete().eq('org_id', orgB);
    expect(del.error?.code).toBe('42501');
    const ins = await owner.client
      .from('memberships')
      .insert({ org_id: orgB, user_id: owner.user.id, role: 'owner' });
    expect(ins.error?.code).toBe('42501');
    const roleEsc = await manager.client.from('memberships').update({ role: 'owner' }).eq('user_id', manager.user.id);
    expect(roleEsc.error?.code).toBe('42501');

    const [{ name }] = await sql<{ name: string }>('select name from public.organisations where id = $1', [orgB]);
    expect(name).toBe('Integration Org B');
  });

  it('a user with no membership gets nothing and cannot act', async () => {
    for (const table of ['organisations', 'memberships', 'invitations', 'audit_log'] as const) {
      const sel = await outsider.client.from(table).select('*', { count: 'exact' }).limit(1);
      // invitations: select('*') includes token_hash, which is not granted; use explicit columns below
      if (table !== 'invitations') {
        expect(sel.error).toBeNull();
        expect(sel.data).toEqual([]);
      }
    }
    const inv = await outsider.client.from('invitations').select('id, email');
    expect(inv.data).toEqual([]);
    expect((await invite(outsider, orgA, uniqEmail('x'), 'viewer')).status).toBe(403);
  });

  it('audit_log: no INSERT/UPDATE/DELETE for authenticated; service-only RPCs are not callable', async () => {
    const ins = await owner.client.from('audit_log').insert({ action: 'forged.event' });
    expect(ins.error?.code).toBe('42501');
    expect(ins.status).toBe(403);
    expect((await owner.client.from('audit_log').update({ action: 'x' }).eq('org_id', orgA)).error?.code).toBe('42501');
    expect((await owner.client.from('audit_log').delete().eq('org_id', orgA)).error?.code).toBe('42501');

    const svc = await owner.client.rpc('service_record_auth_event', { p_user: owner.user.id, p_action: 'auth.login', p_details: {} });
    expect(svc.status).toBe(403);
    expect(svc.error?.code).toBe('42501');
    const boot = await owner.client.rpc('bootstrap_first_admin', { p_email: owner.user.email });
    expect(boot.status).toBe(403);
    expect(boot.error?.code).toBe('42501');

    const anon = anonClient();
    expect((await anon.rpc('bootstrap_first_admin', { p_email: owner.user.email })).error?.code).toBe('42501');
    expect((await anon.rpc('service_record_auth_event', { p_user: owner.user.id, p_action: 'auth.login' })).error?.code).toBe('42501');
    expect((await anon.rpc('create_org', { p_type: 'business', p_name: 'Anon Org' })).error?.code).toBe('42501');
    expect((await anon.from('organisations').select('id')).error?.code).toBe('42501');
    expect((await anon.from('audit_log').insert({ action: 'forged' })).error?.code).toBe('42501');

    // internal helper functions are not exposed through the API either
    const sch = await fetch(`${API_URL}/rest/v1/rpc/write_audit`, {
      method: 'POST',
      headers: { apikey: PUBLISHABLE_KEY, authorization: `Bearer ${owner.session.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_action: 'x', p_org: null, p_entity_type: null, p_entity_id: null, p_details: {} }),
    });
    expect(sch.status).toBe(404);
  });

  it('token_hash is not readable by any authenticated session; other invitation columns are', async () => {
    const created = await invite(owner, orgA, uniqEmail('th'), 'viewer');
    expect(created.error).toBeNull();
    const a = await owner.client.from('invitations').select('token_hash');
    expect(a.error?.code).toBe('42501');
    const b = await owner.client.from('invitations').select('*');
    expect(b.error?.code).toBe('42501');
    const c = await owner.client.from('invitations').select('id, email, role, expires_at');
    expect(c.error).toBeNull();
    expect(c.data!.length).toBeGreaterThan(0);
    // the raw token is only in the RPC response, never stored
    const rows = await sql('select count(*)::int as n from public.invitations where token_hash = $1', [created.data.token]);
    expect(rows[0]!.n).toBe(0);
    // staff cannot even list invitations
    const s = await staff.client.from('invitations').select('id');
    expect(s.data).toEqual([]);
  });

  it('removal takes effect immediately even though the removed user holds a still-valid JWT', async () => {
    const temp = await signIn(await createConfirmedUser('tmp'));
    await join(temp, orgA, 'staff');
    expect((await temp.client.from('organisations').select('id')).data).toHaveLength(1);

    const rm = await owner.client.rpc('remove_member', { p_org: orgA, p_user: temp.user.id });
    expect(rm.error).toBeNull();

    // same access token, very next request
    expect((await temp.client.from('organisations').select('id')).data).toEqual([]);
    expect((await temp.client.from('memberships').select('id').eq('org_id', orgA)).data).toEqual([]);
    expect((await invite(temp, orgA, uniqEmail('x'), 'viewer')).status).toBe(403);
    expect((await temp.client.rpc('rename_org', { p_org: orgA, p_name: 'Still here?' })).status).toBe(403);
  });

  it('invitation tokens: email-bound, single use, malformed => same generic 404', async () => {
    const invitee = await signIn(await createConfirmedUser('inv'));
    const intruder = await signIn(await createConfirmedUser('intr'));
    const created = await invite(owner, orgA, invitee.user.email, 'viewer');
    const token: string = created.data.token;

    for (const bad of [token, 'zzz', 'A'.repeat(64), '0'.repeat(64), '']) {
      const r = await intruder.client.rpc('accept_invitation', { p_token: bad });
      expect(r.status).toBe(404);
      expect(r.error?.message).toBe('invalid_invitation');
    }
    expect(
      (await sql('select 1 from public.memberships where user_id = $1', [intruder.user.id])).length,
    ).toBe(0);

    const ok = await invitee.client.rpc('accept_invitation', { p_token: token });
    expect(ok.error).toBeNull();
    expect(ok.data.role).toBe('viewer');

    // raw HTTP: the invalid-invitation response is a real 404 with the generic body (returned, not raised)
    const raw = await fetch(`${API_URL}/rest/v1/rpc/accept_invitation`, {
      method: 'POST',
      headers: { apikey: PUBLISHABLE_KEY, authorization: `Bearer ${intruder.session.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_token: token }),
    });
    expect(raw.status).toBe(404);
    expect(await raw.json()).toEqual({ code: 'PT404', message: 'invalid_invitation' });
    const again = await invitee.client.rpc('accept_invitation', { p_token: token });
    expect(again.status).toBe(404);
    expect(again.error?.message).toBe('invalid_invitation');
  });

  it('expired and revoked tokens give the same generic error', async () => {
    const u1 = await signIn(await createConfirmedUser('exp'));
    const u2 = await signIn(await createConfirmedUser('rev'));
    const i1 = await invite(owner, orgA, u1.user.email, 'viewer');
    const i2 = await invite(owner, orgA, u2.user.email, 'viewer');
    await sql(`update public.invitations set expires_at = now() - interval '1 minute' where id = $1`, [i1.data.invitation_id]);
    const rv = await owner.client.rpc('revoke_invitation', { p_invitation: i2.data.invitation_id });
    expect(rv.error).toBeNull();
    const r1 = await u1.client.rpc('accept_invitation', { p_token: i1.data.token });
    const r2 = await u2.client.rpc('accept_invitation', { p_token: i2.data.token });
    for (const r of [r1, r2]) {
      expect(r.status).toBe(404);
      expect(r.error?.message).toBe('invalid_invitation');
    }
  });

  it('a forged/tampered JWT is rejected by the API gateway', async () => {
    const [h, p, s] = owner.session.access_token.split('.');
    const claims = JSON.parse(Buffer.from(p!, 'base64url').toString());
    claims.sub = otherOwner.user.id; // pretend to be the owner of org B
    const forged = `${h}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${s}`;
    const res = await fetch(`${API_URL}/rest/v1/organisations?select=id`, {
      headers: { apikey: PUBLISHABLE_KEY, authorization: `Bearer ${forged}` },
    });
    expect(res.status).toBe(401);

    const unsigned = `${h}.${Buffer.from(JSON.stringify({ ...claims, role: 'service_role' })).toString('base64url')}.`;
    const res2 = await fetch(`${API_URL}/rest/v1/organisations?select=id`, {
      headers: { apikey: PUBLISHABLE_KEY, authorization: `Bearer ${unsigned}` },
    });
    expect(res2.status).toBe(401);

    // a random-looking secret is not a valid service key
    const fakeKey = `sb_secret_${randomBytes(16).toString('hex')}`;
    const res3 = await fetch(`${API_URL}/rest/v1/audit_log?select=id`, { headers: { apikey: fakeKey, authorization: `Bearer ${fakeKey}` } });
    expect([401, 403]).toContain(res3.status);
  });

  it('the service key (server only) still cannot write audit_log directly', async () => {
    const svc = serviceClient();
    expect((await svc.from('audit_log').insert({ action: 'forged' })).error?.code).toBe('42501');
    expect((await svc.from('audit_log').update({ action: 'x' }).eq('org_id', orgA)).error?.code).toBe('42501');
    expect((await svc.from('audit_log').delete().eq('org_id', orgA)).error?.code).toBe('42501');
  });
});

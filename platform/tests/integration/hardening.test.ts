import { afterAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  CONSENT_VERSION,
  anonClient,
  cleanupUsers,
  createConfirmedUser,
  enrolAndVerifyTotp,
  openUserTx,
  resetBootstrapAfterTest,
  serviceClient,
  signIn,
  sql,
  strongPassword,
  trackUser,
  uniq,
  uniqEmail,
  type TestUser,
} from './helpers';

afterAll(async () => {
  await cleanupUsers();
  await resetBootstrapAfterTest();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function audit(action: string, userId: string) {
  return sql<{ source: string; actor_user_id: string; details: Record<string, unknown> }>(
    `select source, actor_user_id, details from public.audit_log where action = $1 and actor_user_id = $2`,
    [action, userId],
  );
}

// ------------------------------------------------------------------------------------------
// H1: two sessions racing to remove/demote the last two holders of a role. Exactly one wins.
// Each racer is its own connection + transaction acting as a different owner (role authenticated + JWT claims).
// ------------------------------------------------------------------------------------------
type Call = (c: pg.Client, orgId: string, actor: TestUser, target: TestUser) => Promise<unknown>;
const removeCall: Call = (c, org, _actor, target) => c.query('select public.remove_member($1, $2)', [org, target.id]);
const demoteCall = (role: string): Call => (c, org, _actor, target) =>
  c.query('select public.set_member_role($1, $2, $3)', [org, target.id, role]);

async function race(orgId: string, a: TestUser, b: TestUser, callA: Call, callB: Call, aal: 'aal1' | 'aal2') {
  const ca = await openUserTx(a.id, a.email, aal);
  const cb = await openUserTx(b.id, b.email, aal);
  try {
    // A acts first and holds its transaction open (not committed).
    await callA(ca, orgId, a, b);
    // B starts while A is uncommitted. Without serialisation B would still see A as an active holder and succeed.
    let bSettled = false;
    const bResult = callB(cb, orgId, b, a).then(
      () => ({ ok: true as const }),
      (e: { code?: string; message?: string }) => ({ ok: false as const, code: e.code, message: e.message }),
    ).finally(() => {
      bSettled = true;
    });
    await sleep(700);
    const bWasBlocked = !bSettled; // B must be waiting on A's lock, not racing ahead
    await ca.query('commit');
    const rb = await bResult;
    if (rb.ok) await cb.query('commit');
    else await cb.query('rollback');
    return { bWasBlocked, rb };
  } finally {
    await ca.end().catch(() => {});
    await cb.end().catch(() => {});
  }
}

describe('H1: concurrent removal/demotion of the last two owners', () => {
  async function twoOwnerOrg() {
    const o1 = await createConfirmedUser('own1');
    const o2 = await createConfirmedUser('own2');
    const { id } = (
      await sql<{ id: string }>(
        `insert into public.organisations (type, name, created_by) values ('business', $1, $2) returning id`,
        [`Race Org ${uniq('r')}`, o1.id],
      )
    )[0]!;
    await sql(`insert into public.memberships (org_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'owner')`, [id, o1.id, o2.id]);
    return { id, o1, o2 };
  }
  const activeOwners = async (org: string) =>
    Number((await sql<{ n: string }>(`select count(*)::text as n from public.memberships where org_id = $1 and role = 'owner' and status = 'active'`, [org]))[0]!.n);

  it('two owners removing each other at the same time: exactly one succeeds, one owner remains', async () => {
    const { id, o1, o2 } = await twoOwnerOrg();
    const { bWasBlocked, rb } = await race(id, o1, o2, removeCall, removeCall, 'aal1');
    expect(bWasBlocked, 'second remover must wait for the first transaction (advisory lock)').toBe(true);
    expect(rb.ok).toBe(false);
    if (!rb.ok) {
      expect(rb.code).toBe('PT409');
      expect(rb.message).toBe('last_owner');
    }
    expect(await activeOwners(id)).toBe(1);
  });

  it('two owners demoting each other at the same time: exactly one succeeds, one owner remains', async () => {
    const { id, o1, o2 } = await twoOwnerOrg();
    const { bWasBlocked, rb } = await race(id, o1, o2, demoteCall('viewer'), demoteCall('viewer'), 'aal1');
    expect(bWasBlocked).toBe(true);
    expect(rb.ok).toBe(false);
    expect(await activeOwners(id)).toBe(1);
  });

  it('a removal racing a demotion of the other owner: exactly one succeeds', async () => {
    const { id, o1, o2 } = await twoOwnerOrg();
    const { rb } = await race(id, o1, o2, removeCall, demoteCall('manager'), 'aal1');
    expect(rb.ok).toBe(false);
    expect(await activeOwners(id)).toBe(1);
  });

  it('two admin_super removing each other at the same time: exactly one succeeds, one admin_super remains', async (ctx) => {
    // admin_super exists only in the single mitra organisation of the shared database.
    const state = await sql<{ n: string }>(`select count(*)::text as n from public.memberships where role = 'admin_super' and status = 'active'`);
    if (Number(state[0]!.n) > 0) ctx.skip(); // a real first admin exists: never touch it. Runs on a fresh DB (CI).
    const a1 = await createConfirmedUser('adm1');
    const a2 = await createConfirmedUser('adm2');
    let org = (await sql<{ id: string }>(`select id from public.organisations where type = 'mitra'`))[0]?.id;
    if (!org) {
      org = (await sql<{ id: string }>(`insert into public.organisations (type, name, created_by) values ('mitra', 'MITRA Administration', $1) returning id`, [a1.id]))[0]!.id;
    }
    await sql(`insert into public.memberships (org_id, user_id, role) values ($1, $2, 'admin_super'), ($1, $3, 'admin_super')`, [org, a1.id, a2.id]);
    const { bWasBlocked, rb } = await race(org, a1, a2, removeCall, removeCall, 'aal2');
    expect(bWasBlocked).toBe(true);
    expect(rb.ok).toBe(false);
    const left = await sql<{ n: string }>(`select count(*)::text as n from public.memberships where org_id = $1 and role = 'admin_super' and status = 'active'`, [org]);
    expect(Number(left[0]!.n)).toBe(1);
  });
});

// ------------------------------------------------------------------------------------------
// H2: audit rows produced by DB triggers on real GoTrue activity (no application code runs)
// ------------------------------------------------------------------------------------------
describe('H2: auth events are written by the database', () => {
  it('sign-up, password sign-in, TOTP enrolment and the aal2 upgrade each produce the right audit row', async () => {
    const email = uniqEmail('h2');
    const password = strongPassword();
    const su = await anonClient().auth.signUp({ email, password, options: { data: { consents: { terms: CONSENT_VERSION, privacy: CONSENT_VERSION } } } });
    expect(su.error).toBeNull();
    const id = su.data.user!.id;
    trackUser(id);
    const signup = await audit('auth.signup', id);
    expect(signup).toHaveLength(1);
    expect(signup[0]!.source).toBe('db');

    // confirm through the admin API (the confirmation e-mail flow itself is covered in signup.test.ts)
    await serviceClient().auth.admin.updateUserById(id, { email_confirm: true });
    expect(await audit('auth.login', id)).toHaveLength(0);

    const s = await signIn({ id, email, password });
    const logins = await audit('auth.login', id);
    expect(logins).toHaveLength(1);
    expect(logins[0]!.source).toBe('db');
    expect(logins[0]!.details.aal).toBe('aal1');

    expect(await audit('auth.mfa_enrolled', id)).toHaveLength(0);
    await enrolAndVerifyTotp(s.client);
    expect(await audit('auth.mfa_enrolled', id)).toHaveLength(1);
    expect(await audit('auth.mfa_verified', id)).toHaveLength(1); // enrol-verify upgraded the session to aal2

    const again = await signIn({ id, email, password });
    expect(await audit('auth.login', id)).toHaveLength(2);
    expect(await audit('auth.mfa_verified', id)).toHaveLength(1);
    void again;
  });

  it('the application cannot forge those events through the service RPC', async () => {
    const u = await createConfirmedUser('h2f');
    for (const action of ['auth.login', 'auth.signup', 'auth.mfa_verified', 'auth.mfa_enrolled']) {
      const r = await serviceClient().rpc('service_record_auth_event', { p_user: u.id, p_action: action });
      expect(r.status).toBe(422);
    }
    expect(await audit('auth.login', u.id)).toHaveLength(0);
  });
});

// ------------------------------------------------------------------------------------------
// M1: consent gate over HTTP
// ------------------------------------------------------------------------------------------
describe('M1: consent is required before creating or joining organisations', () => {
  it('create_org and accept_invitation return 403 consent_required until the current consents are granted', async () => {
    const owner = await signIn(await createConfirmedUser('m1o'));
    const org = await owner.client.rpc('create_org', { p_type: 'business', p_name: 'Consent Org' });
    expect(org.error).toBeNull();

    const nc = await signIn(await createConfirmedUser('m1n', {}, { consent: false }));
    const denied = await nc.client.rpc('create_org', { p_type: 'business', p_name: 'No Consent Org' });
    expect(denied.status).toBe(403);
    expect(denied.error?.message).toBe('consent_required');

    const inv = await owner.client.rpc('create_invitation', { p_org: org.data, p_email: nc.user.email, p_role: 'viewer' });
    expect(inv.error).toBeNull();
    const acc = await nc.client.rpc('accept_invitation', { p_token: inv.data.token });
    expect(acc.status).toBe(403);
    expect(acc.error?.message).toBe('consent_required');

    expect((await nc.client.rpc('grant_consent', { p_purpose: 'terms', p_version: '1999-01' })).status).toBe(422);
    expect((await nc.client.rpc('grant_consent', { p_purpose: 'terms', p_version: CONSENT_VERSION })).error).toBeNull();
    expect((await nc.client.rpc('grant_consent', { p_purpose: 'terms', p_version: CONSENT_VERSION })).error).toBeNull(); // idempotent
    expect((await nc.client.rpc('grant_consent', { p_purpose: 'privacy', p_version: CONSENT_VERSION })).error).toBeNull();
    const rows = await sql('select 1 from public.consents where user_id = $1', [nc.user.id]);
    expect(rows).toHaveLength(2);

    const ok = await nc.client.rpc('accept_invitation', { p_token: inv.data.token });
    expect(ok.error).toBeNull();
    expect((await nc.client.rpc('create_org', { p_type: 'business', p_name: 'Now Consented' })).error).toBeNull();
  });

  it('a sign-up with a bogus consent version records no consent row', async () => {
    const { data, error } = await anonClient().auth.signUp({
      email: uniqEmail('m1b'),
      password: strongPassword(),
      options: { data: { consents: { terms: '1999-01', privacy: '1999-01' } } },
    });
    expect(error).toBeNull();
    trackUser(data.user!.id);
    expect(await sql('select 1 from public.consents where user_id = $1', [data.user!.id])).toHaveLength(0);
  });
});

// ------------------------------------------------------------------------------------------
// M3: account-keyed throttle over HTTP (attempt rows must commit even when refused)
// ------------------------------------------------------------------------------------------
describe('M3: service_auth_attempt', () => {
  it('is service-only, returns true up to the limit then false, and persists every attempt', async () => {
    const svc = serviceClient();
    const key = `login:${uniq('m3')}@example.test`;
    const results: unknown[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await svc.rpc('service_auth_attempt', { p_key: key, p_max: 3, p_window_seconds: 60 });
      expect(r.error).toBeNull();
      results.push(r.data);
    }
    expect(results).toEqual([true, true, true, false, false]);
    const n = await sql<{ n: string }>('select count(*)::text as n from public.rate_limit_events where key = $1', [key]);
    expect(Number(n[0]!.n)).toBe(5);

    const bad = await svc.rpc('service_auth_attempt', { p_key: 'x', p_max: 3, p_window_seconds: 60 });
    expect(bad.status).toBe(422);

    const u = await signIn(await createConfirmedUser('m3u'));
    expect((await u.client.rpc('service_auth_attempt', { p_key: key, p_max: 3, p_window_seconds: 60 })).error?.code).toBe('42501');
    expect((await anonClient().rpc('service_auth_attempt', { p_key: key, p_max: 3, p_window_seconds: 60 })).error?.code).toBe('42501');
    await sql('delete from public.rate_limit_events where key = $1', [key]);
  });
});

// ------------------------------------------------------------------------------------------
// M4: account deletion through the real Auth admin API
// ------------------------------------------------------------------------------------------
describe('M4: deleting a sole owner through GoTrue', () => {
  it('succeeds, keeps the organisation and retains a redacted membership.deleted audit row', async () => {
    const owner = await signIn(await createConfirmedUser('m4'));
    const org = await owner.client.rpc('create_org', { p_type: 'business', p_name: 'Sole Owner Org' });
    expect(org.error).toBeNull();
    const del = await serviceClient().auth.admin.deleteUser(owner.user.id);
    expect(del.error).toBeNull();
    const rows = await sql<{ n: string }>(
      `select count(*)::text as n from public.audit_log where action = 'membership.deleted' and org_id = $1 and actor_user_id is null and not (details ? 'user_id')`,
      [org.data],
    );
    expect(Number(rows[0]!.n)).toBe(1);
    const o = await sql<{ created_by: string | null }>('select created_by from public.organisations where id = $1', [org.data]);
    expect(o[0]!.created_by).toBeNull();
    await sql('delete from public.organisations where id = $1', [org.data]);
  });
});

describe('M5/L4 over HTTP', () => {
  it('rejects a multi-recipient invite address and a banned user keeps no permission', async () => {
    const owner = await signIn(await createConfirmedUser('m5'));
    const org = await owner.client.rpc('create_org', { p_type: 'business', p_name: 'Input Org' });
    const bad = await owner.client.rpc('create_invitation', { p_org: org.data, p_email: 'a@example.test, b@example.test', p_role: 'viewer' });
    expect(bad.status).toBe(422);
    expect(bad.error?.message).toBe('invalid_email');

    await sql(`update auth.users set banned_until = now() + interval '1 day' where id = $1`, [owner.user.id]);
    const r = await owner.client.rpc('rename_org', { p_org: org.data, p_name: 'Banned Rename' });
    expect(r.status).toBe(403);
    await sql(`update auth.users set banned_until = null where id = $1`, [owner.user.id]);
  });
});

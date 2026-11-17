import { expect, test } from '@playwright/test';
import { freshCode } from '../e2e/support/totp';
import { admin, anon, guardStaging, lit, remoteRows, remoteSql, strong } from '../hosted/support';
import { cover, finding } from './harness';
import { PERSONAS } from './personas';
import { loadStore, saveStore } from './store';

// Phase B: test identities. Reuses the isolated staging personas when they exist, creates them otherwise. Passwords and TOTP seeds go
// to the secure test-secret store (outside the repository). Staging only: guardStaging refuses any other project.
test.describe.configure({ mode: 'serial' });
test.beforeAll(guardStaging);

test('provision the six agent identities on mitra-staging', async () => {
  test.setTimeout(300_000);
  const store = loadStore();
  for (const def of PERSONAS) {
    const found = remoteRows<{ id: string }>(`select id from auth.users where lower(email) = ${lit(def.email)}`)[0];
    let rec = store.personas[def.key];
    if (!found) {
      const password = strong();
      const { data, error } = await admin().auth.admin.createUser({
        email: def.email,
        password,
        email_confirm: true, // no mail provider exists yet (documented limitation): confirmation is done with the Auth admin API on staging only
        user_metadata: { display_name: def.displayName, language: 'en', consents: { terms: '2026-07', privacy: '2026-07' } },
      });
      expect(error?.message ?? null, `create ${def.key}`).toBeNull();
      rec = { id: data.user!.id, email: def.email, password };
      cover('provision', `create identity ${def.key}`, 'pass', 'created through the Auth admin API (email confirmation cannot be done by mail)');
    } else if (!rec) {
      const password = strong();
      const { error } = await admin().auth.admin.updateUserById(found.id, { password });
      expect(error?.message ?? null).toBeNull();
      rec = { id: found.id, email: def.email, password };
      cover('provision', `re-key identity ${def.key}`, 'pass', 'store entry was missing; password reset on the synthetic staging account');
    } else {
      cover('provision', `reuse identity ${def.key}`, 'pass');
    }
    // Sign-in check with the stored credentials.
    const c = anon();
    const s = await c.auth.signInWithPassword({ email: def.email, password: rec.password });
    expect(s.error?.message ?? null, `sign-in ${def.key}`).toBeNull();
    if (def.mfa && !rec.totpSecret) {
      const old = await c.auth.mfa.listFactors();
      for (const f of old.data?.all ?? []) await admin().auth.admin.mfa.deleteFactor({ id: f.id, userId: rec.id });
      const enr = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'agent-suite' });
      expect(enr.error?.message ?? null).toBeNull();
      const ch = await c.auth.mfa.challenge({ factorId: enr.data!.id });
      const v = await c.auth.mfa.verify({ factorId: enr.data!.id, challengeId: ch.data!.id, code: freshCode(enr.data!.totp.secret) });
      expect(v.error?.message ?? null).toBeNull();
      rec.totpSecret = enr.data!.totp.secret;
    }
    store.personas[def.key] = rec;
    saveStore(store);
  }

  // Administrator. The one-time bootstrap (bootstrap_first_admin) was already consumed on staging, so the first agent administrator is
  // added to the operator organisation by an operator-side staging statement (the same method earlier hosted suites used). Every further
  // administrator (admin2) is invited in the app by this administrator in the admin scenario.
  const a = store.personas.admin!;
  const isAdmin = remoteRows<{ n: number }>(`select count(*)::int n from public.memberships where user_id = ${lit(a.id)} and role::text = 'admin_super'`)[0]!.n;
  if (!isAdmin) {
    remoteSql(`insert into public.memberships (org_id, user_id, role) select id, ${lit(a.id)}, 'admin_super' from public.organisations where type = 'mitra' on conflict (org_id, user_id) do nothing`);
    cover('provision', 'admin_super membership for agent admin', 'pass', 'operator-side staging statement; bootstrap was already consumed');
  }
  // Second administrator: an in-app invitation is only delivered by email and staging has no mail provider, so it cannot be accepted
  // in the browser (recorded as a limitation). admin2 gets admin_review through the same operator-side statement.
  const a2 = store.personas.admin2!;
  const has2 = remoteRows<{ n: number }>(`select count(*)::int n from public.memberships where user_id = ${lit(a2.id)}`)[0]!.n;
  if (!has2) {
    remoteSql(`insert into public.memberships (org_id, user_id, role) select id, ${lit(a2.id)}, 'admin_review' from public.organisations where type = 'mitra' on conflict (org_id, user_id) do nothing`);
    cover('provision', 'admin_review membership for agent admin2', 'pass', 'invitation emails cannot be delivered on staging (no mail provider)');
  }
  const admins = remoteRows<{ n: number }>(`select count(*)::int n from public.memberships where role::text = 'admin_super'`)[0]!.n;
  if (admins > 5) {
    finding({
      id: 'TI-01', sev: 'P3', cat: 'test-infra', area: 'staging data hygiene',
      title: `Staging holds ${admins} admin_super memberships from earlier hosted test runs`,
      steps: 'select count(*) from memberships where role = admin_super (staging, read-only)',
      expected: 'A handful of named administrators', actual: `${admins} accounts named hosted-*-admin@example.test`,
      evidence: 'Earlier hosted suites add a throwaway administrator per run. Staging only; production is a separate empty project. Clean up before any staging data is copied or reused.',
    });
  }
  expect(Object.keys(store.personas)).toHaveLength(PERSONAS.length);
});

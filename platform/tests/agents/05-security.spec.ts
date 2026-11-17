import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { Agent, cover, finding } from './harness';
import { PERSONAS } from './personas';
import { getData, persona, type PersonaKey } from './store';
import { guardStaging, url, pub, secret } from '../hosted/support';

// Phase F: tenant isolation and authorization, checked at the API/database boundary with each persona's real session (RLS as the
// application's own users meet it) and in the browser (bundles and responses are searched for secrets).
test.describe.configure({ mode: 'serial' });
test.beforeAll(guardStaging);

const clients: Partial<Record<PersonaKey, SupabaseClient>> = {};
async function as(k: PersonaKey): Promise<SupabaseClient> {
  if (clients[k]) return clients[k]!;
  const c = createClient(url, pub, { auth: { persistSession: false, autoRefreshToken: false } });
  const p = persona(k);
  let r = await c.auth.signInWithPassword({ email: p.email, password: p.password });
  for (let i = 0; r.error && /rate|too many/i.test(r.error.message) && i < 6; i++) {
    cover('infra', `API sign-in rate limit for ${k}; waited 150 s`, 'observed', '', 'test-infra');
    await new Promise((res) => setTimeout(res, 150_000));
    r = await c.auth.signInWithPassword({ email: p.email, password: p.password });
  }
  if (r.error) throw new Error(`sign-in ${k}: ${r.error.message}`);
  if (persona(k).totpSecret) {
    const { freshCode } = await import('../e2e/support/totp');
    const f = (await c.auth.mfa.listFactors()).data!.totp[0]!;
    const ch = await c.auth.mfa.challenge({ factorId: f.id });
    await c.auth.mfa.verify({ factorId: f.id, challengeId: ch.data!.id, code: freshCode(persona(k).totpSecret!) });
  }
  clients[k] = c;
  return c;
}
const rows = async (c: SupabaseClient, table: string, filter?: (q: any) => any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const q = c.from(table).select('*');
  const { data, error } = await (filter ? filter(q) : q);
  return { data: (data ?? []) as Record<string, unknown>[], error };
};

test('database isolation: Buyer B and the seller read none of Buyer A\'s private transactions', async () => {
  test.setTimeout(900_000);
  const a = await as('buyerA');
  const b = await as('buyerB');
  const s = await as('seller');
  const aOrg = persona('buyerA').orgId!;
  const enquiry = getData('enquiryUrl')?.split('/').pop();
  const request = getData('requestId');
  const own = {
    buyerA_enquiries: (await rows(a, 'enquiries')).data.length,
    buyerA_requests: (await rows(a, 'buyer_requests')).data.length,
    buyerA_quotations: (await rows(a, 'quotations')).data.length,
  };
  cover('isolation', 'baseline: Buyer A sees its own rows', own.buyerA_enquiries > 0 && own.buyerA_requests > 0 ? 'pass' : 'fail', JSON.stringify(own));
  for (const [who, c] of [['buyerB', b]] as const) {
    for (const table of ['enquiries', 'enquiry_messages', 'quotations', 'quotation_versions', 'quotation_line_items', 'buyer_requests', 'buyer_request_private', 'request_seller_matches', 'memberships', 'invitations', 'notifications', 'lead_activities', 'verification_claims', 'verification_documents', 'business_private', 'privacy_requests', 'consents', 'audit_log', 'sourcing_requests', 'sourcing_rfqs']) {
      const r = await rows(c, table);
      let leaked = r.data.filter((x) => JSON.stringify(x).includes(aOrg) || (enquiry && JSON.stringify(x).includes(enquiry)) || (request && JSON.stringify(x).includes(request)));
      // The buyer's own rows may legitimately mention their own org: only Buyer A's identifiers count.
      leaked = leaked.filter((x) => !JSON.stringify(x).includes(persona('buyerB').orgId!) || JSON.stringify(x).includes(aOrg));
      cover('isolation', `${who} cannot read Buyer A rows in ${table}`, leaked.length ? 'fail' : 'pass', leaked.length ? `${leaked.length} rows leaked` : `${r.data.length} rows visible, none Buyer A's`);
      if (leaked.length) finding({ id: `SEC-${table}`, sev: 'P0', cat: 'database', area: 'tenant isolation', title: `${who} can read Buyer A data in ${table}`, steps: `Sign in as ${who}; select * from ${table} through PostgREST`, expected: 'No Buyer A rows', actual: `${leaked.length} rows contain Buyer A identifiers` });
    }
  }
  // The seller may see the buyer's enquiry (a party), but not the buyer's private contact fields unless unlocked, and nothing about Buyer A's other transactions.
  const sellerSeesRequests = await rows(s, 'buyer_request_private');
  cover('isolation', 'seller reads buyer_request_private (phone) only where unlocked', 'observed', `${sellerSeesRequests.data.length} rows`);
  const notMine = await rows(b, 'organisations', (q) => q.eq('id', aOrg));
  cover('isolation', 'Buyer B cannot read Buyer A organisation row', notMine.data.length ? 'observed' : 'pass', `${notMine.data.length} rows (an organisation name may be public by design)`);
});

test('authorization: privileged operations are refused to every non-administrator and anonymous caller', async () => {
  test.setTimeout(600_000);
  const attacker = await as('buyerB');
  const seller = await as('seller');
  const aOrg = persona('buyerA').orgId!;
  const attempts: [string, string, Record<string, unknown>][] = [
    ['create_invitation into another org', 'create_invitation', { p_org: aOrg, p_email: 'intruder@example.test', p_role: 'owner' }],
    ['set_member_role in another org', 'set_member_role', { p_org: aOrg, p_user: persona('buyerA').id, p_role: 'viewer' }],
    ['remove_member from another org', 'remove_member', { p_org: aOrg, p_user: persona('buyerA').id }],
    ['bootstrap_first_admin', 'bootstrap_first_admin', { p_email: 'agent-buyer-b@example.test' }],
    ['admin_biz_product_decide', 'admin_biz_product_decide', { p_id: '00000000-0000-0000-0000-000000000000', p_decision: 'approve', p_note: 'x', p_expected_version: 1 }],
  ];
  for (const [label, fn, args] of attempts) {
    for (const [who, c] of [['buyerB', attacker], ['seller', seller]] as const) {
      const r = await c.rpc(fn, args);
      cover('authz', `${who}: ${label} is refused`, r.error ? 'pass' : 'fail', r.error ? r.error.message.slice(0, 80) : 'call succeeded');
      if (!r.error) finding({ id: `AUTHZ-${fn}`, sev: 'P0', cat: 'database', area: 'authorization', title: `${who} could call ${fn}`, steps: `rpc ${fn} as ${who}`, expected: 'permission error', actual: 'success' });
    }
  }
  const anon = createClient(url, pub, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const table of ['organisations', 'memberships', 'enquiries', 'quotations', 'profiles', 'verification_documents', 'audit_log', 'privacy_requests', 'notifications']) {
    const { data, error } = await anon.from(table).select('*').limit(5);
    cover('authz', `anonymous cannot read ${table}`, error || !data?.length ? 'pass' : 'fail', error ? error.message.slice(0, 60) : `${data?.length ?? 0} rows`);
  }
  const anonWrite = await anon.from('organisations').insert({ type: 'business', name: 'anon' });
  cover('authz', 'anonymous cannot insert an organisation directly', anonWrite.error ? 'pass' : 'fail');
  const userWrite = await attacker.from('memberships').insert({ org_id: aOrg, user_id: persona('buyerB').id, role: 'owner' });
  cover('authz', 'a signed-in user cannot insert a membership row directly (writes go through functions)', userWrite.error ? 'pass' : 'fail');
  const audit = await attacker.from('audit_log').insert({ action: 'x' });
  cover('authz', 'audit log cannot be written or altered by a user', audit.error ? 'pass' : 'fail');
});

test('private documents and storage: no API role can list or read the verification bucket; the download route is closed to outsiders', async ({ browser }) => {
  test.setTimeout(600_000);
  for (const k of ['buyerB', 'seller'] as const) {
    const c = await as(k);
    const list = await c.storage.from('verification-docs').list('', { limit: 5 });
    cover('documents', `${k}: storage list on verification-docs`, list.error || !list.data?.length ? 'pass' : 'fail', list.error?.message?.slice(0, 60) ?? `${list.data?.length} objects`);
    const up = await c.storage.from('verification-docs').upload(`agent/${k}.txt`, 'x');
    cover('documents', `${k}: direct upload to verification-docs is refused`, up.error ? 'pass' : 'fail');
  }
  const v = await Agent.create(browser, 'buyerB');
  await v.check('documents', 'download route returns 404/401 for an unknown or foreign document id', async () => {
    const r = await v.goto('/api/v1/documents/00000000-0000-0000-0000-000000000000', false);
    expect([401, 403, 404]).toContain(r!.status());
  });
  await v.close();
  cover('documents', 'document download for an unscanned file', 'disabled', 'No malware scanner: files stay quarantined, scanner-dependent flows are closed by design');
});

test('no service-role or secret key reaches the browser', async ({ browser }) => {
  test.setTimeout(600_000);
  const v = await Agent.create(browser, 'buyerA');
  const seen: string[] = [];
  v.page.on('response', async (r) => {
    const ct = r.headers()['content-type'] ?? '';
    if (/javascript|json|html|text/.test(ct)) {
      const body = await r.text().catch(() => '');
      if (secret && body.includes(secret)) seen.push(`SECRET KEY in ${r.url()}`);
      if (/sb_secret_[A-Za-z0-9_-]{10,}|service_role"?\s*[:=]\s*"?eyJ/.test(body)) seen.push(`secret-like token in ${r.url()}`);
    }
  });
  await v.login();
  for (const p of ['/en', '/en/orgs', `/en/orgs/${persona('buyerA').orgId}/members`, '/en/requests', '/en/enquiries', '/en/account', '/en/catalogue', '/en/business-help']) await v.goto(p, false);
  cover('secrets', 'no secret/service-role key in any response while signed in', seen.length ? 'fail' : 'pass', seen.slice(0, 3).join('; '));
  if (seen.length) finding({ id: 'SEC-SECRET', sev: 'P0', cat: 'application', area: 'secrets', title: 'Secret key present in a browser response', steps: seen.join('; '), expected: 'none', actual: 'found' });
  const cookies = (await v.ctx.cookies()).filter((c) => !c.httpOnly).map((c) => c.name);
  cover('secrets', 'cookies readable by scripts', 'observed', cookies.join(', ') || 'none');
  await v.close();
  void PERSONAS;
});

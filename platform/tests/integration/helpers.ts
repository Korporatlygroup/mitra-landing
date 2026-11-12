import { createHmac, randomBytes } from 'node:crypto';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';

export const API_URL = process.env.TEST_API_URL!;
export const PUBLISHABLE_KEY = process.env.TEST_PUBLISHABLE_KEY!;
export const SERVICE_KEY = process.env.TEST_SERVICE_KEY!;
export const MAILPIT_URL = process.env.TEST_MAILPIT_URL!;
export const DB_URL = process.env.TEST_DB_URL!;

const authOpts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;

export const uniq = (prefix: string) => `${prefix}-${randomBytes(5).toString('hex')}`;
export const uniqEmail = (prefix: string) => `${uniq(prefix)}@example.test`;
export const strongPassword = () => `Pw-${randomBytes(9).toString('hex')}-Aa1!`;

export function serviceClient(): SupabaseClient {
  return createClient(API_URL, SERVICE_KEY, authOpts);
}
export function anonClient(): SupabaseClient {
  return createClient(API_URL, PUBLISHABLE_KEY, authOpts);
}

// ---------- direct DB access as postgres (setup, inspection, cleanup only) ----------
export async function withPg<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
export async function sql<T extends pg.QueryResultRow = Record<string, any>>(text: string, params: unknown[] = []): Promise<T[]> {
  return withPg(async (c) => (await c.query<T>(text, params)).rows);
}

// ---------- users ----------
export interface TestUser {
  id: string;
  email: string;
  password: string;
}
const created: string[] = [];

export const CONSENT_VERSION = '2026-07';

/** Creates a confirmed user. Consented to the current terms and privacy versions by default (pass consent: false to opt out). */
export async function createConfirmedUser(
  prefix = 'user',
  metadata: Record<string, unknown> = {},
  opts: { consent?: boolean } = {},
): Promise<TestUser> {
  const email = uniqEmail(prefix);
  const password = strongPassword();
  const { data, error } = await serviceClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata:
      opts.consent === false ? metadata : { consents: { terms: CONSENT_VERSION, privacy: CONSENT_VERSION }, ...metadata },
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  created.push(data.user.id);
  return { id: data.user.id, email, password };
}

export function trackUser(id: string) {
  created.push(id);
}

export interface Signed {
  client: SupabaseClient;
  user: TestUser;
  session: Session;
}
export async function signIn(user: TestUser): Promise<Signed> {
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error || !data.session) throw new Error(`signIn failed: ${error?.message}`);
  return { client, user, session: data.session };
}
export async function userSession(prefix = 'user'): Promise<Signed> {
  return signIn(await createConfirmedUser(prefix));
}

/** Delete everything the tests created (organisations they created, then the users). Never touches audit_log. */
export async function cleanupUsers(): Promise<void> {
  await removeTrackedObjects();
  const ids = created.splice(0);
  if (!ids.length) return;
  // Organisations first: deleting a creator while their org exists is blocked (see 06_user_deletion.test.sql).
  await sql(
    `delete from public.organisations o where o.created_by = any($1::uuid[])
       and (o.type <> 'mitra' or not exists (select 1 from public.memberships m where m.org_id = o.id and m.user_id <> all($1::uuid[])))`,
    [ids],
  );
  const admin = serviceClient();
  for (const id of ids) await admin.auth.admin.deleteUser(id);
}

// ---------- JWT helpers ----------
export function jwtClaims(accessToken: string): Record<string, any> {
  return JSON.parse(Buffer.from(accessToken.split('.')[1]!, 'base64url').toString('utf8'));
}

// ---------- Mailpit ----------
interface MailpitSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}
export async function waitForEmail(
  to: string,
  timeoutMs = 20000,
): Promise<{ id: string; subject: string; text: string; html: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/messages`);
    if (res.ok) {
      const body = (await res.json()) as { messages: MailpitSummary[] };
      const hit = body.messages.find((m) => m.To.some((t) => t.Address.toLowerCase() === to.toLowerCase()));
      if (hit) {
        const full = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${hit.ID}`)).json()) as { Text: string; HTML: string };
        return { id: hit.ID, subject: hit.Subject, text: full.Text, html: full.HTML };
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`No email for ${to} arrived in Mailpit within ${timeoutMs}ms`);
}
export async function deleteEmailsTo(to: string): Promise<void> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/messages`);
  if (!res.ok) return;
  const body = (await res.json()) as { messages: MailpitSummary[] };
  const ids = body.messages.filter((m) => m.To.some((t) => t.Address.toLowerCase() === to.toLowerCase())).map((m) => m.ID);
  if (ids.length) {
    await fetch(`${MAILPIT_URL}/api/v1/messages`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ IDs: ids }),
    });
  }
}

// ---------- RFC 6238 TOTP (SHA-1, 6 digits, 30 s), no dependency ----------
function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()) {
    const v = alphabet.indexOf(ch);
    if (v < 0) throw new Error('invalid base32');
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
export function totp(secretBase32: string, atMs = Date.now(), digits = 6, step = 30): string {
  const counter = Math.floor(atMs / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secretBase32)).update(buf).digest();
  const offset = h[h.length - 1]! & 0x0f;
  const code = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return (code % 10 ** digits).toString().padStart(digits, '0');
}
/** RFC 6238 Appendix B: secret "12345678901234567890" (base32 below), T=59 s, SHA-1 => 94287082 (8 digits). */
export const RFC6238_SECRET_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

export async function verifyFactor(client: SupabaseClient, factorId: string, secret: string): Promise<void> {
  const { data: ch, error: e2 } = await client.auth.mfa.challenge({ factorId });
  if (e2 || !ch) throw new Error(`mfa.challenge failed: ${e2?.message}`);
  const { error: e3 } = await client.auth.mfa.verify({ factorId, challengeId: ch.id, code: totp(secret) });
  if (e3) throw new Error(`mfa.verify failed: ${e3.message}`);
}
/** Enrol a TOTP factor and verify it, upgrading the session to aal2. */
export async function enrolAndVerifyTotp(client: SupabaseClient): Promise<{ factorId: string; secret: string }> {
  const { data: enr, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: uniq('totp') });
  if (error || !enr) throw new Error(`mfa.enroll failed: ${error?.message}`);
  await verifyFactor(client, enr.id, enr.totp.secret);
  return { factorId: enr.id, secret: enr.totp.secret };
}
export async function currentAal(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getSession();
  return String(jwtClaims(data.session!.access_token).aal);
}

/**
 * Test teardown for the single-use bootstrap state: if bootstrap completed only because a test user
 * (since deleted by cleanupUsers) was made first admin, re-open it and drop the now member-less mitra org.
 * Never touches audit_log. A real first admin (an existing user) is left untouched.
 */
export async function resetBootstrapAfterTest(): Promise<void> {
  await sql(
    `update private.bootstrap_state set completed_at = null, completed_user_id = null
      where completed_at is not null and not exists (select 1 from auth.users u where u.id = completed_user_id)
        and not exists (select 1 from public.memberships where role = 'admin_super')`,
  );
  await sql(
    `delete from public.organisations o where o.type = 'mitra'
       and not exists (select 1 from public.memberships m where m.org_id = o.id)`,
  );
}

/** A transaction on its own connection acting as an authenticated user (same GUCs PostgREST sets). Caller commits/rolls back and ends it. */
export async function openUserTx(userId: string, email: string, aal: 'aal1' | 'aal2' = 'aal1'): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  await c.query('begin');
  await c.query('set local role authenticated');
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: 'authenticated', email, aal }),
  ]);
  return c;
}

// ---------- Phase 2 helpers ----------
export const DOCS_BUCKET = 'verification-docs';
const objects: string[] = [];
export const trackObject = (path: string) => objects.push(path);
export async function removeTrackedObjects(): Promise<void> {
  const paths = objects.splice(0);
  if (paths.length) await serviceClient().storage.from(DOCS_BUCKET).remove(paths);
}

export const STD_PROFILE = {
  business_name: 'Integration Foods',
  category_slug: 'food-beverage',
  registration_status: 'registered',
  ssm_number: '202001012345',
  business_type: 'sole_proprietorship',
  state: 'Selangor',
  district: 'Petaling',
  address_line: '1 Jalan Satu',
  postcode: '47500',
  contact_phone: '+60 3 1234 5678',
  contact_email: 'biz@example.test',
};

/** A business organisation with a complete profile and representative, owned by `owner` (RPCs over HTTP). */
export async function createBusinessOrg(owner: Signed, name = `Org ${uniq('o')}`): Promise<string> {
  const org = await owner.client.rpc('create_org', { p_type: 'business', p_name: name });
  if (org.error) throw new Error(`create_org failed: ${org.error.message}`);
  const orgId = org.data as string;
  const p = await owner.client.rpc('save_business_profile', { p_org: orgId, p_data: STD_PROFILE });
  if (p.error) throw new Error(`save_business_profile failed: ${p.error.message}`);
  const r = await owner.client.rpc('save_representative', { p_org: orgId, p_name: 'Rep Person', p_role: 'owner', p_email: null, p_phone: null });
  if (r.error) throw new Error(`save_representative failed: ${r.error.message}`);
  return orgId;
}

/** Registers a document row directly through the service RPC (no Storage object). */
export async function registerDoc(
  orgId: string,
  userId: string,
  opts: { claimType?: string; docType?: string; status?: 'clean' | 'pending' | 'failed'; path?: string } = {},
): Promise<string> {
  const { data, error } = await serviceClient().rpc('service_register_document', {
    p_org: orgId,
    p_user: userId,
    p_claim_type: opts.claimType ?? 'business_registration',
    p_doc_type: opts.docType ?? 'ssm_certificate',
    p_display_name: 'integration.pdf',
    p_mime: 'application/pdf',
    p_size: 1000,
    p_sha256: randomBytes(32).toString('hex'),
    p_storage_path: opts.path ?? `it/${randomBytes(8).toString('hex')}.pdf`,
    p_scan_status: opts.status ?? 'clean',
    p_scan_engine: 'integration',
  });
  if (error) throw new Error(`service_register_document failed: ${error.message}`);
  return data as string;
}

/** The (single) MITRA organisation; created by SQL for the test when none exists. Reviewer setup only. */
export async function ensureMitraOrg(createdBy: string): Promise<string> {
  const ex = await sql<{ id: string }>(`select id from public.organisations where type = 'mitra'`);
  if (ex[0]) return ex[0].id;
  const r = await sql<{ id: string }>(
    `insert into public.organisations (type, name, created_by) values ('mitra', 'MITRA Administration', $1) returning id`,
    [createdBy],
  );
  return r[0]!.id;
}
export async function addMember(orgId: string, userId: string, role: string): Promise<void> {
  await sql(`insert into public.memberships (org_id, user_id, role) values ($1, $2, $3)`, [orgId, userId, role]);
}

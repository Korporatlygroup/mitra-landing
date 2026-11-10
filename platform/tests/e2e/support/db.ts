import { createHash, randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';
import { API_URL, CONSENT_VERSION, DB_URL, PUBLISHABLE_KEY, SERVICE_KEY } from './env';

const authOpts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;

export const uniq = (prefix: string) => `${prefix}-${randomBytes(5).toString('hex')}`;
export const uniqEmail = (prefix: string) => `${uniq(prefix)}@example.test`;
export const strongPassword = () => `Pw-${randomBytes(9).toString('hex')}-Aa1!`;
export const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');

export const serviceClient = (): SupabaseClient => createClient(API_URL, SERVICE_KEY, authOpts);
export const anonClient = (): SupabaseClient => createClient(API_URL, PUBLISHABLE_KEY, authOpts);

/** Direct DB access as postgres: test setup and state inspection only. */
export async function sql<T extends pg.QueryResultRow = Record<string, any>>(text: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  try {
    return (await c.query<T>(text, params)).rows;
  } finally {
    await c.end();
  }
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  name: string;
}

/** Creates an email-confirmed user through the Auth admin API (setup only; some specs sign up through the UI instead). */
export async function createUser(prefix = 'user', opts: { email?: string; language?: 'en' | 'ta' | 'ms'; name?: string; consent?: boolean } = {}): Promise<TestUser> {
  const email = opts.email ?? uniqEmail(prefix);
  const password = strongPassword();
  const name = opts.name ?? `E2E ${prefix}`;
  const { data, error } = await serviceClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      display_name: name,
      language: opts.language ?? 'en',
      // The DB records consent from sign-up metadata only for the current version.
      ...(opts.consent === false ? {} : { consents: { terms: CONSENT_VERSION, privacy: CONSENT_VERSION } }),
    },
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  await sql(`update public.profiles set display_name = $2, language = $3 where id = $1`, [data.user.id, name, opts.language ?? 'en']);
  return { id: data.user.id, email, password, name };
}

export interface Signed {
  client: SupabaseClient;
  user: TestUser;
  accessToken: string;
}
/** Signs in with the supabase client (as a script would) to obtain the user's own access token. */
export async function signedClient(user: { email: string; password: string }): Promise<Signed> {
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error || !data.session) throw new Error(`signIn failed: ${error?.message}`);
  return { client, user: user as TestUser, accessToken: data.session.access_token };
}

/** Creates an org through the real create_org RPC as `owner` and returns its id. */
export async function createOrgAs(owner: TestUser, type: 'business' | 'buyer' | 'partner', name: string): Promise<string> {
  const s = await signedClient(owner);
  const { data, error } = await s.client.rpc('create_org', { p_type: type, p_name: name });
  if (error) throw new Error(`create_org failed: ${error.message}`);
  return String(data);
}

/** Test setup only: put a user into an org with a role, as postgres. */
export async function addMember(orgId: string, userId: string, role: string): Promise<void> {
  await sql(
    `insert into public.memberships (org_id, user_id, role) values ($1, $2, $3::public.member_role)
     on conflict (org_id, user_id) do update set role = excluded.role, status = 'active', removed_at = null`,
    [orgId, userId, role],
  );
}

export async function roleOf(orgId: string, userId: string): Promise<string | null> {
  const r = await sql<{ role: string; status: string }>(`select role, status from public.memberships where org_id = $1 and user_id = $2`, [orgId, userId]);
  return r[0] && r[0].status === 'active' ? r[0].role : null;
}
export async function countMembers(orgId: string): Promise<number> {
  return Number((await sql(`select count(*)::int as n from public.memberships where org_id = $1 and status = 'active'`, [orgId]))[0]!.n);
}
export async function countInvitations(orgId: string): Promise<number> {
  return Number((await sql(`select count(*)::int as n from public.invitations where org_id = $1`, [orgId]))[0]!.n);
}
export async function mitraOrgId(): Promise<string> {
  return String((await sql(`select id from public.organisations where type = 'mitra'`))[0]!.id);
}

/** Calls PostgREST like a hostile client would: from the browser page, with the user's own access token. */
export async function rpcFromPage(page: Page, accessToken: string, fn: string, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
  return page.evaluate(
    async ({ url, key, token, fn, body }) => {
      const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: key, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      let parsed: unknown = null;
      try {
        parsed = await r.json();
      } catch {
        parsed = null;
      }
      return { status: r.status, body: parsed };
    },
    { url: API_URL, key: PUBLISHABLE_KEY, token: accessToken, fn, body },
  );
}

/** Test setup only: invitation row for (org, email), if any. */
export async function invitationState(orgId: string, email: string): Promise<{ accepted_at: string | null; revoked_at: string | null } | null> {
  const r = await sql(`select accepted_at, revoked_at from public.invitations where org_id = $1 and email = $2 order by created_at desc limit 1`, [orgId, email]);
  return (r[0] as { accepted_at: string | null; revoked_at: string | null } | undefined) ?? null;
}

export async function hasConsents(userId: string): Promise<boolean> {
  const r = await sql(`select count(distinct purpose)::int as n from public.consents where user_id = $1 and version = $2 and withdrawn_at is null`, [userId, CONSENT_VERSION]);
  return Number(r[0]!.n) >= 2;
}

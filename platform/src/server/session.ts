import { redirect } from 'next/navigation';
import { cache } from 'react';
import type { Locale } from '@/i18n/routing';
import { requiresMfa } from '@/lib/permissions';
import { createClient as createClientUncached } from '@/lib/supabase/server';
import { getProfile, type Profile } from './services/auth';
import { adminMfaRequired, getMfaStatus } from './services/mfa';
import { listMyMemberships, type MyMembership } from './services/orgs';

export interface AppSession {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: { id: string; email: string };
  profile: Profile;
  memberships: MyMembership[];
  /** True when any membership requires MFA (admin_* role, or owner of a partner organisation). */
  needsMfa: boolean;
  aal: 'aal1' | 'aal2';
}

/**
 * Per-request memoisation (React cache: one render, one set of answers). The layout, the page gate and the proxy-refreshed cookies used to
 * trigger the same Auth-server and database calls several times per signed-in page; each call costs Worker CPU (TLS, JSON) on the Free
 * plan. Identity is still validated by the Auth server (getUser), once per render instead of three times. Outside a render (server
 * actions, route handlers) cache() does not memoise, so those paths behave exactly as before.
 */
const createClient = cache(createClientUncached);
const userOnce = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  return { supabase, user: data.user, error };
});
const profileOnce = cache((supabase: Awaited<ReturnType<typeof createClient>>, userId: string) => getProfile(supabase, userId));
const membershipsOnce = cache((supabase: Awaited<ReturnType<typeof createClient>>, userId: string) => listMyMemberships(supabase, userId));
/** Same as listMyMemberships, once per render. */
export const myMembershipsOnce = membershipsOnce;
export const myProfileOnce = profileOnce;

export const localePath = (locale: string, path: string) => `/${locale}${path === '/' ? '' : path}`;

/**
 * The one gate every protected page uses.
 *  - not signed in            -> /login?next=<this page>
 *  - MFA required, no factor  -> /mfa/enrol?next=<this page>
 *  - MFA required, aal1       -> /mfa/verify?next=<this page>
 * `path` is the locale-less path of the calling page (used for the `next` parameter).
 * Identity comes from auth.getUser() (validated by the Auth server), never from getSession().
 */
export async function requireSession(opts: {
  locale: Locale | string;
  path: string;
  requireMfaIfNeeded?: boolean;
}): Promise<AppSession> {
  const { locale, path, requireMfaIfNeeded = true } = opts;
  const { supabase, user, error } = await userOnce();
  const next = encodeURIComponent(localePath(locale, path));
  if (error || !user) redirect(`${localePath(locale, '/login')}?next=${next}`);

  const [profile, memberships, adminMfa] = await Promise.all([profileOnce(supabase, user.id), membershipsOnce(supabase, user.id), adminMfaRequired(supabase)]);
  const needsMfa = memberships.some((m) => requiresMfa(m.role, m.org.type, adminMfa));

  const mfa = await getMfaStatus(supabase);
  const aal: 'aal1' | 'aal2' = mfa.currentLevel === 'aal2' ? 'aal2' : 'aal1';

  if (requireMfaIfNeeded && needsMfa && aal !== 'aal2') {
    if (mfa.verifiedFactorId) redirect(`${localePath(locale, '/mfa/verify')}?next=${next}`);
    redirect(`${localePath(locale, '/mfa/enrol')}?next=${next}`);
  }

  return { supabase, user: { id: user.id, email: user.email ?? '' }, profile, memberships, needsMfa, aal };
}

/** Signed-in user or null, without redirecting (public pages). Tolerates a missing Supabase configuration. */
export async function getOptionalUser() {
  try {
    const { supabase, user } = await userOnce();
    return { supabase, user };
  } catch {
    return { supabase: null, user: null };
  }
}

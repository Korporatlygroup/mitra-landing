import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSupabasePublishableKey, getSupabaseUrl } from '../env';
import { sessionCookieOptions } from './config';

/** Cookie-based, per-request user client (RLS applies as the signed-in user). */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookieOptions: sessionCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are read-only there. The proxy refreshes the session instead.
        }
      },
    },
  });
}

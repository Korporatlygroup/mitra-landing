import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser client for anonymous/public calls only. Session cookies are HttpOnly (see ./config.ts), so this client
 * never holds a session: all authenticated work goes through server actions. Not used by Phase 1 screens.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}

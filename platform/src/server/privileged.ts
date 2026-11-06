import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * The ONLY module allowed to read the service key or create a service-role client (enforced by a unit test).
 * It may only be imported from server actions and route handlers, after they have verified the session
 * with supabase.auth.getUser().
 *
 * Sign-in, MFA and sign-up audit events are written by database triggers; the app can only record the
 * two events the database cannot observe itself.
 */

export type AuthEventAction = 'auth.logout' | 'auth.password_changed';

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('privileged client is not configured');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Records an auth event via RPC service_record_auth_event. Never throws and never blocks the user: failures are logged only. */
export async function recordAuthEvent(
  userId: string,
  action: AuthEventAction,
  details: Record<string, string | number | boolean> = {},
): Promise<void> {
  try {
    const { error } = await serviceClient().rpc('service_record_auth_event', {
      p_user: userId,
      p_action: action,
      p_details: details,
    });
    if (error) console.error('auth event not recorded', { action, code: error.code });
  } catch {
    console.error('auth event not recorded', { action });
  }
}

/**
 * Account-keyed throttle (RPC service_auth_attempt). Returns true when the attempt is allowed.
 * Fails CLOSED: any error (missing config, network, RPC failure) returns false.
 */
export async function authAttempt(key: string, max: number, windowSeconds: number): Promise<boolean> {
  try {
    const { data, error } = await serviceClient().rpc('service_auth_attempt', {
      p_key: key,
      p_max: max,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.error('auth throttle unavailable', { code: error.code });
      return false;
    }
    return data === true;
  } catch {
    console.error('auth throttle unavailable');
    return false;
  }
}

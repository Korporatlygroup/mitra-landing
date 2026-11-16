import { fail, failFrom, ok, type Db, type Result } from './result';

export interface Profile {
  display_name: string;
  language: 'en' | 'ta' | 'ms';
}

interface SignUpArgs {
  email: string;
  password: string;
  displayName: string;
  language: 'en' | 'ta' | 'ms';
  redirectTo: string;
  consentVersion: string;
  /** Optional marketing consent: recorded only when the box was ticked. */
  marketing?: boolean;
}

/**
 * Registers a user. Success is returned identically whether or not the email is already registered
 * (Supabase obfuscates existing confirmed accounts when email confirmation is on).
 */
export async function signUp(supabase: Db, a: SignUpArgs): Promise<Result<null>> {
  const { error } = await supabase.auth.signUp({
    email: a.email,
    password: a.password,
    options: {
      emailRedirectTo: a.redirectTo,
      data: {
        display_name: a.displayName,
        language: a.language,
        consents: { terms: a.consentVersion, privacy: a.consentVersion, ...(a.marketing ? { marketing: a.consentVersion } : {}) },
      },
    },
  });
  if (error) {
    // Already-registered address: answer exactly like a fresh sign-up so the form cannot be used to probe accounts.
    if (error.code === 'user_already_exists') return ok(null);
    if (error.code === 'weak_password') return fail('password_weak');
    if (error.code === 'over_email_send_rate_limit' || error.status === 429) return fail('rate_limited');
    return fail('internal');
  }
  return ok(null);
}

/** Generic failure on purpose: never reveals whether the email exists. */
export async function signIn(supabase: Db, email: string, password: string): Promise<Result<null>> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return error.status === 429 ? fail('rate_limited') : fail('login_failed');
  return ok(null);
}

export async function signOut(supabase: Db): Promise<void> {
  await supabase.auth.signOut();
}

export async function getProfile(supabase: Db, userId: string): Promise<Profile> {
  const { data } = await supabase.from('profiles').select('display_name, language').eq('id', userId).maybeSingle();
  const row = data as Profile | null;
  return { display_name: row?.display_name ?? '', language: row?.language === 'ta' || row?.language === 'ms' ? row.language : 'en' };
}

export async function updateProfile(
  supabase: Db,
  userId: string,
  p: { displayName: string; language: 'en' | 'ta' | 'ms' },
): Promise<Result<null>> {
  const { error } = await supabase
    .from('profiles')
    .update({ display_name: p.displayName, language: p.language })
    .eq('id', userId);
  return error ? failFrom(error) : ok(null);
}

export async function changePassword(supabase: Db, password: string): Promise<Result<null>> {
  const { error } = await supabase.auth.updateUser({ password });
  if (!error) return ok(null);
  if (error.code === 'weak_password') return fail('password_weak');
  if (error.code === 'same_password') return fail('password_same');
  if (error.code === 'insufficient_aal') return fail('mfa_required');
  return fail('internal');
}

/**
 * Sends a password-reset email. The result NEVER depends on whether the address exists or the call succeeded:
 * errors are swallowed (logged without the address) so the response cannot be used to enumerate accounts.
 */
export async function requestPasswordReset(supabase: Db, email: string, redirectTo: string): Promise<Result<null>> {
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) console.error('password reset request failed', { code: error.code ?? error.status });
  } catch {
    console.error('password reset request failed');
  }
  return ok(null);
}

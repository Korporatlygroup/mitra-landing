import { CONSENT_PURPOSES, CONSENT_VERSION } from '@/lib/consent';
import { failFrom, ok, type Db, type Result } from './result';

/** True when the user holds an un-withdrawn consent for every purpose at the current version. */
export async function hasCurrentConsents(supabase: Db, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('consents')
    .select('purpose')
    .eq('user_id', userId)
    .eq('version', CONSENT_VERSION)
    .is('withdrawn_at', null);
  const have = new Set(((data ?? []) as { purpose: string }[]).map((r) => r.purpose));
  return CONSENT_PURPOSES.every((p) => have.has(p));
}

/** Records consent for both purposes at the current version (RPC grant_consent, idempotent). */
export async function grantConsents(supabase: Db): Promise<Result<null>> {
  for (const purpose of CONSENT_PURPOSES) {
    const { error } = await supabase.rpc('grant_consent', { p_purpose: purpose, p_version: CONSENT_VERSION });
    if (error) return failFrom(error);
  }
  return ok(null);
}

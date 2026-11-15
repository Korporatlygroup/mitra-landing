import { fail, ok, type Db, type Result } from './result';

export interface MfaStatus {
  currentLevel: 'aal1' | 'aal2' | null;
  nextLevel: 'aal1' | 'aal2' | null;
  /** First verified TOTP factor, if any. */
  verifiedFactorId: string | null;
}

/**
 * Assurance level comes from verified JWT claims (getClaims), never from the session user object
 * (getAuthenticatorAssuranceLevel reads session.user from cookie storage and triggers supabase-js's
 * "could be insecure" warning). Factors come from listFactors, which authenticates with the Auth server.
 */
export async function getMfaStatus(supabase: Db): Promise<MfaStatus> {
  const [claims, factors] = await Promise.all([supabase.auth.getClaims(), supabase.auth.mfa.listFactors()]);
  const aal = claims.data?.claims?.aal;
  const verifiedFactorId = factors.data?.totp?.[0]?.id ?? null;
  const currentLevel: MfaStatus['currentLevel'] = aal === 'aal2' ? 'aal2' : aal === 'aal1' ? 'aal1' : null;
  return { currentLevel, nextLevel: verifiedFactorId ? 'aal2' : 'aal1', verifiedFactorId };
}

export interface TotpEnrolment {
  factorId: string;
  qrCode: string;
  secret: string;
}

/** Starts TOTP enrolment. Abandoned (unverified) factors are removed first so the user can retry. */
export async function startTotpEnrol(supabase: Db): Promise<Result<TotpEnrolment>> {
  const existing = await supabase.auth.mfa.listFactors();
  for (const f of existing.data?.all ?? []) {
    if (f.factor_type === 'totp' && f.status === 'unverified') {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    issuer: 'INOK',
    friendlyName: `authenticator-${Date.now()}`,
  });
  if (error || !data) return fail('internal');
  return ok({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
}

/** Challenge + verify a TOTP code. On success the session is upgraded to aal2 (cookies set by the caller's client). */
export async function verifyTotp(supabase: Db, factorId: string, code: string): Promise<Result<null>> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return error.status === 429 ? fail('rate_limited') : fail('invalid_code');
  return ok(null);
}

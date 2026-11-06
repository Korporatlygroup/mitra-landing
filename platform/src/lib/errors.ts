/**
 * Maps database/RPC errors to translated message keys (under the `errors` namespace in messages/*.json).
 * Raw database text is never shown to users.
 */

export interface RpcErrorLike {
  code?: string | null;
  message?: string | null;
}

/** Machine keys raised by the migrations (private.raise_error second argument). */
export const KNOWN_MESSAGE_KEYS = [
  'last_owner',
  'invalid_invitation',
  'already_member',
  'invalid_org_type',
  'invalid_name',
  'org_limit_reached',
  'invalid_role',
  'invalid_email',
  'cannot_grant_above_own_role',
  'target_outranks_actor',
  'cannot_change_own_role',
  'invitation_not_pending',
  'immutable_columns',
  'role_not_allowed_for_org_type',
  'mitra_org_cannot_be_suspended',
  'unknown_action',
  'unknown_user',
  'details_too_large',
  'already_bootstrapped',
  'user_not_found_or_unconfirmed',
  'consent_required',
  'invalid_consent',
  'invalid_throttle',
] as const;

/** Default machine keys per PTnnn code (private.raise_error default messages). */
export const CODE_KEYS: Record<string, string> = {
  PT401: 'unauthenticated',
  PT403: 'forbidden',
  PT404: 'not_found',
  PT409: 'conflict',
  PT422: 'invalid',
  PT429: 'rate_limited',
  PT500: 'internal',
};

export const FALLBACK_KEY = 'internal';

/** Returns a key inside the `errors` namespace (e.g. "last_owner"). Always a key that exists in the messages. */
export function mapRpcError(error: RpcErrorLike | null | undefined): string {
  if (!error) return FALLBACK_KEY;
  const msg = (error.message ?? '').trim();
  if ((KNOWN_MESSAGE_KEYS as readonly string[]).includes(msg)) return msg;
  const code = error.code ?? '';
  if (code in CODE_KEYS) return CODE_KEYS[code];
  // Postgres "insufficient privilege" / RLS denial surfaces as 42501 or 403-ish.
  if (code === '42501') return 'forbidden';
  return FALLBACK_KEY;
}

/** All keys this module can return (used by tests to check the message files). */
export function allErrorKeys(): string[] {
  return [...new Set([...KNOWN_MESSAGE_KEYS, ...Object.values(CODE_KEYS), FALLBACK_KEY])];
}

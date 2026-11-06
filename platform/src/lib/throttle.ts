import { createHash } from 'node:crypto';

/** Throttle limits (attempts per window in seconds). */
export const LIMITS = {
  login: { max: 10, windowSeconds: 900 },
  mfa: { max: 10, windowSeconds: 900 },
  signup: { max: 5, windowSeconds: 3600 },
  reset: { max: 5, windowSeconds: 3600 },
} as const;

/** "prefix:" + sha256(lower(trimmed email)) so no raw address is stored in the throttle table. */
export function emailThrottleKey(prefix: 'login' | 'signup' | 'reset', email: string): string {
  return `${prefix}:${createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}`;
}

export function mfaThrottleKey(userId: string): string {
  return `mfa:${userId}`;
}

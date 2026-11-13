'use server';

import { getSiteUrl } from '@/lib/env';
import { parseForm } from '@/lib/form';
import { failure, success, type FormState } from '@/lib/form-state';
import { forgotPasswordSchema } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';
import { LIMITS, emailThrottleKey } from '@/lib/throttle';
import { authAttempt } from '@/server/privileged';
import { requestPasswordReset } from '@/server/services/auth';

/**
 * Always answers with the same neutral message for a well-formed address: registered or not, throttled or not,
 * mail sent or not.
 */
export async function forgotPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(forgotPasswordSchema, formData);
  if (!parsed.ok) return failure(parsed.errorKey, parsed.values);
  const { email } = parsed.data;

  const allowed = await authAttempt(emailThrottleKey('reset', email), LIMITS.reset.max, LIMITS.reset.windowSeconds);
  if (allowed) {
    const supabase = await createClient();
    await requestPasswordReset(supabase, email, `${getSiteUrl()}/auth/callback`);
  }
  return success('forgot.sent');
}

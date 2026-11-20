'use server';

import { getSiteUrl } from '@/lib/env';
import { parseForm } from '@/lib/form';
import { failure, success, type FormState } from '@/lib/form-state';
import { forgotPasswordSchema } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';
import { LIMITS, emailThrottleKey } from '@/lib/throttle';
import { captchaEnabled, captchaTokenFrom } from '@/lib/turnstile';
import { authAttempt } from '@/server/privileged';
import { requestPasswordReset } from '@/server/services/auth';

/**
 * Always answers with the same neutral message for a well-formed address: registered or not, throttled or not,
 * mail sent or not.
 */
export async function forgotPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(forgotPasswordSchema, formData);
  const captchaToken = captchaTokenFrom(formData);
  // One refusal path: a malformed form, or (only when captcha is on) a missing security-check token. Neither depends on whether the account exists.
  const blocked = !parsed.ok ? parsed.errorKey : captchaEnabled() && !captchaToken ? 'captcha_failed' : null;
  if (blocked !== null || !parsed.ok) return failure(blocked ?? 'invalid_input', parsed.ok ? { email: parsed.data.email } : parsed.values);
  const { email } = parsed.data;

  const allowed = await authAttempt(emailThrottleKey('reset', email), LIMITS.reset.max, LIMITS.reset.windowSeconds);
  if (allowed) {
    const supabase = await createClient();
    await requestPasswordReset(supabase, email, `${getSiteUrl()}/auth/callback`, captchaToken);
  }
  return success('forgot.sent');
}

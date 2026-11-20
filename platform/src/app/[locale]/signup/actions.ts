'use server';

import { redirect } from 'next/navigation';
import { CONSENT_VERSION } from '@/lib/consent';
import { getSiteUrl } from '@/lib/env';
import { nonSecretValues, parseForm } from '@/lib/form';
import { failure, type FormState } from '@/lib/form-state';
import { signUpSchema } from '@/lib/schemas';
import { captchaEnabled, captchaTokenFrom } from '@/lib/turnstile';
import { createClient } from '@/lib/supabase/server';
import { LIMITS, emailThrottleKey } from '@/lib/throttle';
import { authAttempt } from '@/server/privileged';
import { signUp } from '@/server/services/auth';

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(signUpSchema, formData);
  if (!parsed.ok) return failure(parsed.errorKey, parsed.values);
  const d = parsed.data;
  const neutral = `/${d.language}/signup/check-email`;

  // Throttled (or throttle unavailable) sign-ups get the exact same page as a normal sign-up, so the limit
  // cannot be used to learn whether an address is registered. Nothing is sent in that case.
  const allowed = await authAttempt(emailThrottleKey('signup', d.email), LIMITS.signup.max, LIMITS.signup.windowSeconds);
  if (!allowed) redirect(neutral);

  const captchaToken = captchaTokenFrom(formData);
  if (captchaEnabled() && !captchaToken) return failure('captcha_failed', nonSecretValues(parsed.raw));

  const supabase = await createClient();
  const result = await signUp(supabase, {
    captchaToken,
    email: d.email,
    password: d.password,
    displayName: d.displayName,
    language: d.language,
    redirectTo: `${getSiteUrl()}/auth/callback`,
    consentVersion: CONSENT_VERSION,
    marketing: d.acceptMarketing,
    intent: d.intent,
  });
  if (!result.ok) return failure(result.errorKey, nonSecretValues(parsed.raw));
  redirect(neutral);
}

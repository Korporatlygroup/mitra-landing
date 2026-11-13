'use server';

import { redirect } from 'next/navigation';
import { parseForm } from '@/lib/form';
import { failure, type FormState } from '@/lib/form-state';
import { retargetLocale, safeRedirectPath } from '@/lib/safe-redirect';
import { localeSchema, loginSchema } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';
import { LIMITS, emailThrottleKey } from '@/lib/throttle';
import { authAttempt } from '@/server/privileged';
import { getProfile, signIn } from '@/server/services/auth';

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(loginSchema, formData);
  // Any problem with the credentials gets the same generic message.
  if (!parsed.ok) return failure('login_failed', { email: parsed.values.email ?? '' });
  const { email, password } = parsed.data;

  // Account-keyed throttle BEFORE the password is checked (fails closed). Over the limit: GoTrue is not called.
  const allowed = await authAttempt(emailThrottleKey('login', email), LIMITS.login.max, LIMITS.login.windowSeconds);
  if (!allowed) return failure('rate_limited', { email });

  const supabase = await createClient();
  const result = await signIn(supabase, email, password);
  if (!result.ok) return failure(result.errorKey, { email });

  // The sign-in itself is audited by the database (trigger on auth.sessions).
  const { data } = await supabase.auth.getUser();
  if (!data.user) return failure('login_failed', { email });

  const profile = await getProfile(supabase, data.user.id);
  const formLocale = localeSchema.safeParse(formData.get('locale'));
  const locale = formLocale.success ? formLocale.data : profile.language;
  const nextRaw = formData.get('next');
  const next = safeRedirectPath(typeof nextRaw === 'string' ? nextRaw : null, '');
  redirect(next ? retargetLocale(next, locale) : `/${profile.language}`);
}

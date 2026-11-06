'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { parseForm } from '@/lib/form';
import { failure, type FormState } from '@/lib/form-state';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { localeSchema, totpCodeSchema } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';
import { LIMITS, mfaThrottleKey } from '@/lib/throttle';
import { authAttempt } from '@/server/privileged';
import { getMfaStatus, verifyTotp } from '@/server/services/mfa';

const schema = z.object({ code: totpCodeSchema, locale: localeSchema, next: z.string().optional() });

export async function verifyMfaAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return failure(parsed.errorKey);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return failure('unauthenticated');

  if (!(await authAttempt(mfaThrottleKey(data.user.id), LIMITS.mfa.max, LIMITS.mfa.windowSeconds))) {
    return failure('rate_limited');
  }

  const mfa = await getMfaStatus(supabase);
  if (!mfa.verifiedFactorId) redirect(`/${parsed.data.locale}/mfa/enrol`);

  // The upgrade to aal2 is audited by the database (trigger on auth.sessions).
  const r = await verifyTotp(supabase, mfa.verifiedFactorId, parsed.data.code);
  if (!r.ok) return failure(r.errorKey);
  redirect(safeRedirectPath(parsed.data.next, `/${parsed.data.locale}`));
}

'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { failure, success, type FormState } from '@/lib/form-state';
import { parseForm } from '@/lib/form';
import { localeSchema, totpCodeSchema, uuidSchema } from '@/lib/schemas';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { createClient } from '@/lib/supabase/server';
import { LIMITS, mfaThrottleKey } from '@/lib/throttle';
import { authAttempt } from '@/server/privileged';
import { startTotpEnrol, verifyTotp } from '@/server/services/mfa';

export async function startEnrolAction(): Promise<FormState> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return failure('unauthenticated');
  const r = await startTotpEnrol(supabase);
  if (!r.ok) return failure(r.errorKey);
  return success(undefined, { factorId: r.data.factorId, qrCode: r.data.qrCode, secret: r.data.secret });
}

const confirmSchema = z.object({
  factorId: uuidSchema,
  code: totpCodeSchema,
  locale: localeSchema,
  next: z.string().optional(),
});

export async function confirmEnrolAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(confirmSchema, formData);
  if (!parsed.ok) return failure(parsed.errorKey);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return failure('unauthenticated');

  if (!(await authAttempt(mfaThrottleKey(data.user.id), LIMITS.mfa.max, LIMITS.mfa.windowSeconds))) {
    return failure('rate_limited');
  }

  // Enrolment is audited by the database (trigger on auth.mfa_factors).
  const r = await verifyTotp(supabase, parsed.data.factorId, parsed.data.code);
  if (!r.ok) return failure(r.errorKey);
  redirect(safeRedirectPath(parsed.data.next, `/${parsed.data.locale}/account`));
}

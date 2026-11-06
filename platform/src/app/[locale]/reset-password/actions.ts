'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { parseForm } from '@/lib/form';
import { failure, type FormState } from '@/lib/form-state';
import { localeSchema, passwordSchema } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';
import { recordAuthEvent } from '@/server/privileged';
import { changePassword } from '@/server/services/auth';

const schema = z.object({ password: passwordSchema, locale: localeSchema });

/** Sets a new password for the session created by the recovery link. */
export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return failure(parsed.errorKey);
  const { locale, password } = parsed.data;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return failure('unauthenticated');

  const r = await changePassword(supabase, password);
  if (!r.ok) {
    if (r.errorKey === 'mfa_required') {
      redirect(`/${locale}/mfa/verify?next=${encodeURIComponent(`/${locale}/reset-password`)}`);
    }
    return failure(r.errorKey);
  }
  await recordAuthEvent(data.user.id, 'auth.password_changed', { via: 'recovery' });
  redirect(`/${locale}/account?saved=1`);
}

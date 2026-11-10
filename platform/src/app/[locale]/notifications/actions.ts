'use server';

import { revalidatePath } from 'next/cache';
import { parseForm } from '@/lib/form';
import { failure, success, type FormState } from '@/lib/form-state';
import { markReadSchema } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';
import { markNotificationRead } from '@/server/services/verification';

export async function markNotificationReadAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(markReadSchema, formData);
  if (!p.ok) return failure(p.errorKey);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return failure('unauthenticated');
  const r = await markNotificationRead(supabase, p.data.id);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath('/', 'layout');
  return success();
}

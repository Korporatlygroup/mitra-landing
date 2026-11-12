'use server';

import { revalidatePath } from 'next/cache';
import { parseForm } from '@/lib/form';
import { failure, success, type FormState } from '@/lib/form-state';
import { respondSchema } from '@/lib/schemas';
import { actionUser } from '@/server/action-user';
import { respondToInvitation } from '@/server/services/directory';

export async function respondAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(respondSchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const r = await respondToInvitation(supabase, d.requestId, d.orgId, d.response, d.note ?? null);
  if (!r.ok) return failure(r.errorKey, { note: d.note ?? '' });
  revalidatePath('/', 'layout');
  return success(`inbox.sent.${d.response}`);
}

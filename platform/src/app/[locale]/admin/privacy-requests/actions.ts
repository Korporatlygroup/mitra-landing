'use server';

import { revalidatePath } from 'next/cache';
import { failure, success, type FormState } from '@/lib/form-state';
import { parseForm } from '@/lib/form';
import { privacyHandleSchema } from '@/lib/schemas';
import { actionUser } from '@/server/action-user';
import { adminUpdatePrivacyRequest } from '@/server/services/privacy';

/** Moves a data request forward. Closing it needs a written answer; the database enforces who may do this and records the audit row. */
export async function handlePrivacyRequestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(privacyHandleSchema, formData);
  if (!parsed.ok) return failure(parsed.errorKey);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await adminUpdatePrivacyRequest(supabase, parsed.data.id, parsed.data.status, parsed.data.note);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath(`/${parsed.data.locale}/admin/privacy-requests`);
  return success('account.requestSent');
}

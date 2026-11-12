'use server';

import { revalidatePath } from 'next/cache';
import { nonSecretValues, parseForm } from '@/lib/form';
import { failure, success, type FormState } from '@/lib/form-state';
import { partnerProfileSchema } from '@/lib/schemas';
import { actionUser } from '@/server/action-user';
import { savePartnerProfile } from '@/server/services/p5-partner';

/** Creates or updates the partner profile (needs org:manage). A new profile starts as "waiting for approval". */
export async function saveProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(partnerProfileSchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const r = await savePartnerProfile(supabase, d.orgId, d.displayName, d.contactEmail);
  if (!r.ok) return failure(r.errorKey, nonSecretValues(p.raw));
  revalidatePath('/', 'layout');
  return success(r.data.created ? 'p5partner.gate.profileSaved' : 'p5partner.settings.saved');
}

'use server';

import { revalidatePath } from 'next/cache';
import { failure, success, type FormState } from '@/lib/form-state';
import { uuidSchema } from '@/lib/schemas';
import { actionUser } from '@/server/action-user';
import { openReferralEnquiry } from '@/server/services/directory';

/** The recipient of an accepted referral starts the conversation with the customer. All checks are in the database. */
export async function openReferralEnquiryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const referral = String(formData.get('referralId') ?? '').trim();
  if (!uuidSchema.safeParse(referral).success) return failure('invalid_input');
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await openReferralEnquiry(supabase, referral);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath('/', 'layout');
  return success('p4.handoffOpened');
}

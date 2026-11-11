'use server';

import { revalidatePath } from 'next/cache';
import { failure, success, type FormState } from '@/lib/form-state';
import { mapRpcError } from '@/lib/errors';
import { uuidSchema } from '@/lib/schemas';
import { actionUser } from '@/server/action-user';

export async function moderateReviewAction(_prev: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get('reviewId') ?? '');
  const status = String(form.get('status') ?? '');
  const reason = String(form.get('reason') ?? '').trim();
  if (!uuidSchema.safeParse(id).success || !['published','flagged','removed'].includes(status) || reason.length < 3 || reason.length > 1000) return failure('invalid_input');
  const { user, supabase } = await actionUser();
  if (!user) return failure('unauthenticated');
  const { error } = await supabase.rpc('moderate_business_review', { p_review: id, p_status: status, p_reason: reason });
  if (error) return failure(mapRpcError(error));
  revalidatePath('/', 'layout');
  return success('p4.reviewModerated');
}

export async function moderateResponseAction(_prev: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get('reviewId') ?? '');
  const decision = String(form.get('decision') ?? '');
  const reason = String(form.get('reason') ?? '').trim();
  if (!uuidSchema.safeParse(id).success || !['approve','remove'].includes(decision) || reason.length < 3 || reason.length > 1000) return failure('invalid_input');
  const { user, supabase } = await actionUser();
  if (!user) return failure('unauthenticated');
  const { error } = await supabase.rpc('moderate_review_response', { p_review: id, p_approve: decision === 'approve', p_reason: reason });
  if (error) return failure(mapRpcError(error));
  revalidatePath('/', 'layout');
  return success('p4.reviewModerated');
}

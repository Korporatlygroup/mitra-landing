'use server';

import { revalidatePath } from 'next/cache';
import { parseForm } from '@/lib/form';
import { failure, success, type FormState } from '@/lib/form-state';
import { handleReportSchema, reviewListingSchema, suspendListingSchema } from '@/lib/schemas';
import { actionUser } from '@/server/action-user';
import { handleReport, reinstateListing, reviewListing, suspendListing } from '@/server/services/directory';

export async function reviewListingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(reviewListingSchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const r = await reviewListing(supabase, d.orgId, d.decision, d.reason ?? null, d.expectedVersion);
  if (!r.ok) return failure(r.errorKey, { decision: d.decision, reason: d.reason ?? '' });
  revalidatePath('/', 'layout');
  return success('adminList.decided');
}

export async function suspendListingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(suspendListingSchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const r = d.mode === 'suspend' ? await suspendListing(supabase, d.orgId, d.reason) : await reinstateListing(supabase, d.orgId, d.reason);
  if (!r.ok) return failure(r.errorKey, { reason: d.reason });
  revalidatePath('/', 'layout');
  return success(d.mode === 'suspend' ? 'adminList.suspended' : 'adminList.reinstated');
}

export async function handleReportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(handleReportSchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const r = await handleReport(supabase, d.reportId, d.action, d.note);
  if (!r.ok) return failure(r.errorKey, { note: d.note });
  revalidatePath('/', 'layout');
  return success('adminList.reportHandled');
}

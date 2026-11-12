'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { formToObject } from '@/lib/form';
import { failure, type FormState } from '@/lib/form-state';
import { sourcingRespondSchema } from '@/lib/schemas';
import { actionUser } from '@/server/action-user';
import { respondSourcingRequest } from '@/server/services/p5-partner';

/** Acknowledge (note optional) or ask the buyer for clarification (note required, at least 5 characters). The database checks the rest. */
export async function respondRequestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formToObject(formData);
  const action = raw.intent === 'clarify' ? 'clarify' : 'acknowledge';
  const parsed = sourcingRespondSchema.safeParse({ ...raw, action });
  if (!parsed.success) return failure(parsed.error.issues[0]?.message === 'invalid_note' ? 'invalid_note' : 'invalid_input', { note: raw.note ?? '' });
  const d = parsed.data;
  if (action === 'clarify' && (d.note ?? '').length < 5) return failure('invalid_note', { note: raw.note ?? '' });
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await respondSourcingRequest(supabase, d.requestId, action, d.note ?? null, d.expectedVersion ?? null);
  if (!r.ok) return failure(r.errorKey, { note: raw.note ?? '' });
  revalidatePath('/', 'layout');
  redirect(`/${d.locale}/orgs/${d.orgId}/partner/requests/${d.requestId}?done=${action}`);
}

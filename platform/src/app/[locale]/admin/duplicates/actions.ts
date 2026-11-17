'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { parseForm } from '@/lib/form';
import { failure, success, type FormState } from '@/lib/form-state';
import { localeSchema, uuidSchema } from '@/lib/schemas';
import { actionUser } from '@/server/action-user';
import { resolveDuplicateFlag } from '@/server/services/directory';

const schema = z.object({
  locale: localeSchema,
  flagId: uuidSchema,
  decision: z.enum(['dismiss', 'confirm'], 'invalid_decision'),
  note: z.string('reason_required').trim().min(5, 'reason_required').max(1000, 'reason_required'),
});

/** Records a reviewer decision on a suspected duplicate pair. Nothing is merged, hidden or deleted. */
export async function resolveDuplicateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(schema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await resolveDuplicateFlag(supabase, p.data.flagId, p.data.decision, p.data.note);
  if (!r.ok) return failure(r.errorKey, p.raw);
  revalidatePath('/', 'layout');
  return success('dupAdmin.saved');
}

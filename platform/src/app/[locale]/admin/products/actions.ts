'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { failure, success, type FormState } from '@/lib/form-state';
import { uuidSchema } from '@/lib/schemas';
import { actionUser } from '@/server/action-user';
import { adminDecideProduct } from '@/server/services/biz-products';

const schema = z.object({
  id: uuidSchema,
  version: z.coerce.number().int().min(1),
  decision: z.enum(['approve', 'request_changes', 'reject']),
  note: z.string().trim().max(500).optional(),
});

/** One reviewer decision on a business product or service. The database checks the permission, the version and the written note. */
export async function decideProductAction(_prev: FormState, f: FormData): Promise<FormState> {
  const p = schema.safeParse({ id: f.get('id'), version: f.get('version'), decision: f.get('decision'), note: String(f.get('note') ?? '') });
  if (!p.success) return failure('invalid_input');
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await adminDecideProduct(supabase, p.data.id, p.data.decision, p.data.note || null, p.data.version);
  if (!r.ok) return failure(r.errorKey, { note: p.data.note ?? '' });
  revalidatePath('/', 'layout');
  return success('adm2.products.saved');
}

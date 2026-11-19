'use server';

import { revalidatePath } from 'next/cache';
import { failure, success, type FormState } from '@/lib/form-state';
import { uuidSchema } from '@/lib/schemas';
import { actionUser } from '@/server/action-user';
import { orderAction, setOrderDetails, type OrderAction } from '@/server/services/deals';

const text = (f: FormData, key: string) => String(f.get(key) ?? '').trim();
const ACTIONS = ['start', 'mark_delivered', 'confirm', 'dispute', 'cancel'] as const;

/** One button per allowed transition. The database decides who may do what; this only passes the request on. */
export async function orderActionAction(_prev: FormState, f: FormData): Promise<FormState> {
  const id = text(f, 'orderId'), action = text(f, 'action');
  if (!uuidSchema.safeParse(id).success || !(ACTIONS as readonly string[]).includes(action)) return failure('invalid_input');
  const { supabase, user } = await actionUser(); if (!user) return failure('unauthenticated');
  const r = await orderAction(supabase, id, action as OrderAction, text(f, 'note') || null);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath(`/orders/${id}`); revalidatePath('/orders');
  return success('p4.saved');
}

export async function orderDetailsAction(_prev: FormState, f: FormData): Promise<FormState> {
  const id = text(f, 'orderId'), date = text(f, 'serviceDate');
  if (!uuidSchema.safeParse(id).success || (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))) return failure('invalid_input');
  const { supabase, user } = await actionUser(); if (!user) return failure('unauthenticated');
  const r = await setOrderDetails(supabase, id, date || null, text(f, 'deposit') || null);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath(`/orders/${id}`);
  return success('p4.saved');
}

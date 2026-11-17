'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formToObject, nonSecretValues, parseForm } from '@/lib/form';
import { failure, success, type FormState } from '@/lib/form-state';
import { localeSchema, uuidSchema } from '@/lib/schemas';
import { actionUser } from '@/server/action-user';
import { requestOrgMembership, resolveJoinRequest } from '@/server/services/directory';

const requestSchema = z.object({
  locale: localeSchema,
  slug: z.string('invalid_input').regex(/^[a-z0-9-]{3,80}$/, 'invalid_input'),
  message: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(500, 'invalid_input').optional()),
});

/** "Ask to join": a signed-in person with a confirmed email asks the owners of a PUBLISHED business. No membership is created. */
export async function requestMembershipAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(requestSchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await requestOrgMembership(supabase, p.data.slug, p.data.message ?? null);
  if (!r.ok) return failure(r.errorKey, nonSecretValues(formToObject(formData)));
  revalidatePath('/', 'layout');
  return success('orgs.dupSent');
}

const resolveSchema = z.object({
  locale: localeSchema,
  requestId: uuidSchema,
  decision: z.enum(['invited', 'declined'], 'invalid_decision'),
});

/** Owner side: record that the person was invited (using the normal invitation form) or declined. */
export async function resolveJoinRequestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(resolveSchema, formData);
  if (!p.ok) return failure(p.errorKey);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await resolveJoinRequest(supabase, p.data.requestId, p.data.decision);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath('/', 'layout');
  return success('dupAdmin.saved');
}

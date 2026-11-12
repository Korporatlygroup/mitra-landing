'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formToObject, nonSecretValues } from '@/lib/form';
import { failure, success, type FormState } from '@/lib/form-state';
import { actionUser } from '@/server/action-user';
import { decideGovProposal, setGovProgrammeState, setGovSetting } from '@/server/services/gov';

const reason = z.string().trim().min(5).max(1000);

const decisionSchema = z.object({ proposalId: z.uuid(), decision: z.enum(['approve', 'reject', 'needs_info']), expectedStatus: z.enum(['pending', 'needs_info']).default('pending'), reason });
const stateSchema = z.object({ programmeId: z.uuid(), state: z.enum(['published', 'paused', 'archived']), reason });
const settingSchema = z.object({ key: z.enum(['monitoring_enabled', 'publishing_enabled', 'notifications_enabled']), enabled: z.enum(['true', 'false']), reason });

/** Every action validates, re-reads the signed-in user from the Auth server and calls one database function. The database decides who may. */
export async function decideProposalAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formToObject(formData);
  const p = decisionSchema.safeParse(raw);
  if (!p.success) return failure(p.error.issues.some((i) => i.path[0] === 'reason') ? 'reason' : 'decision', nonSecretValues(raw));
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await decideGovProposal(supabase, p.data.proposalId, p.data.decision, p.data.reason, p.data.expectedStatus);
  if (!r.ok) return failure(r.errorKey, nonSecretValues(raw));
  revalidatePath('/', 'layout');
  return success('gov.admin.decided');
}

export async function setProgrammeStateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formToObject(formData);
  const p = stateSchema.safeParse(raw);
  if (!p.success) return failure(p.error.issues.some((i) => i.path[0] === 'reason') ? 'reason' : 'state', nonSecretValues(raw));
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await setGovProgrammeState(supabase, p.data.programmeId, p.data.state, p.data.reason);
  if (!r.ok) return failure(r.errorKey, nonSecretValues(raw));
  revalidatePath('/', 'layout');
  return success('gov.admin.decided');
}

export async function setSettingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formToObject(formData);
  const p = settingSchema.safeParse(raw);
  if (!p.success) return failure(p.error.issues.some((i) => i.path[0] === 'reason') ? 'reason' : 'key', nonSecretValues(raw));
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await setGovSetting(supabase, p.data.key, p.data.enabled === 'true', p.data.reason);
  if (!r.ok) return failure(r.errorKey, nonSecretValues(raw));
  revalidatePath('/', 'layout');
  return success('gov.admin.decided');
}

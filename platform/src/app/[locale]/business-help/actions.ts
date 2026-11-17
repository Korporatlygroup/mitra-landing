'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { formToObject, nonSecretValues } from '@/lib/form';
import { failure, success, type FormState } from '@/lib/form-state';
import { REMINDER_DAY_CHOICES, eligibleAssistOrgs, govPrefsSchema, govProfileSchema, govSaveSchema, govTrackingSchema } from '@/lib/gov-ui';
import { uuidSchema } from '@/lib/schemas';
import { actionUser } from '@/server/action-user';
import { saveGovProfile, saveGovProgramme, saveMyGovProgramme, setGovPrefs, unsaveGovProgramme, unsaveMyGovProgramme, updateGovTracking } from '@/server/services/gov';
import { listMyMemberships } from '@/server/services/orgs';

const localeOf = (raw: Record<string, string>) => (['en', 'ta', 'ms'].includes(raw.locale ?? '') ? (raw.locale as string) : 'en');

export async function saveGovProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formToObject(formData);
  const p = govProfileSchema.safeParse(raw);
  if (!p.success) return failure('invalid_data', nonSecretValues(raw));
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const needs = d.need ? [d.need] : [];
  const r = await saveGovProfile(
    supabase,
    d.orgId,
    {
      needs,
      business_size: d.business_size ?? '',
      employees: d.employees ?? '',
      years_operating: d.years_operating ?? '',
      registration: d.registration ?? '',
      state: d.state ?? '',
      community: d.community ?? '',
      citizenship: d.citizenship ?? '',
      owner_age: d.owner_age ?? '',
    },
    d.version,
  );
  if (!r.ok) return failure(r.errorKey, nonSecretValues(raw));
  revalidatePath('/', 'layout');
  redirect(`/${localeOf(raw)}/business-help/find?${new URLSearchParams({ ...(d.need ? { need: d.need } : {}), org: d.orgId, saved: '1' }).toString()}`);
}

export async function saveGovProgrammeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = govSaveSchema.safeParse(formToObject(formData));
  if (!p.success) return failure('invalid_data');
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await saveGovProgramme(supabase, p.data.orgId, p.data.programmeId);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath('/', 'layout');
  return success('gov.ok.saved');
}

const myProgrammeSchema = z.object({ programmeId: uuidSchema });

/** Bookmark a programme for the signed-in person. No business is needed; a business that tracks applications is kept in step when there is one. */
export async function saveMyProgrammeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = myProgrammeSchema.safeParse(formToObject(formData));
  if (!p.success) return failure('invalid_data');
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await saveMyGovProgramme(supabase, p.data.programmeId);
  if (!r.ok) return failure(r.errorKey);
  const org = eligibleAssistOrgs(await listMyMemberships(supabase, user.id))[0];
  if (org) await saveGovProgramme(supabase, org.org.id, p.data.programmeId);
  revalidatePath('/', 'layout');
  return success('gov.ok.saved');
}

export async function unsaveMyProgrammeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = myProgrammeSchema.safeParse(formToObject(formData));
  if (!p.success) return failure('invalid_data');
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await unsaveMyGovProgramme(supabase, p.data.programmeId);
  if (!r.ok) return failure(r.errorKey);
  const org = eligibleAssistOrgs(await listMyMemberships(supabase, user.id))[0];
  if (org) await unsaveGovProgramme(supabase, org.org.id, p.data.programmeId);
  revalidatePath('/', 'layout');
  return success('gov.ok.removed');
}

export async function unsaveGovProgrammeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = govSaveSchema.safeParse(formToObject(formData));
  if (!p.success) return failure('invalid_data');
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await unsaveGovProgramme(supabase, p.data.orgId, p.data.programmeId);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath('/', 'layout');
  return success('gov.ok.removed');
}

export async function updateGovTrackingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formToObject(formData);
  const p = govTrackingSchema.safeParse(raw);
  if (!p.success) return failure('invalid_data', nonSecretValues(raw));
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const r = await updateGovTracking(
    supabase,
    d.orgId,
    d.programmeId,
    { tracking_status: d.tracking_status, note: d.note ?? '', applied_on: d.applied_on ?? '', outcome: d.outcome ?? '', reminder_on: d.reminder_on ?? '', mark_seen: d.markSeen ? 'true' : 'false' },
    d.version,
  );
  if (!r.ok) return failure(r.errorKey, nonSecretValues(raw));
  revalidatePath('/', 'layout');
  return success('gov.saved.updated');
}

const CATEGORY_FIELDS = ['new_match', 'opens', 'deadline', 'rule_change', 'unavailable', 'reminder'] as const;

export async function setGovPrefsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formToObject(formData);
  const p = govPrefsSchema.safeParse(raw);
  if (!p.success) return failure('invalid_data', nonSecretValues(raw));
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const data: Record<string, unknown> = {
    channel_in_app: raw.channel_in_app === 'on',
    channel_email: raw.channel_email === 'on',
    frequency: p.data.frequency,
    paused_until: p.data.paused_until ? `${p.data.paused_until}T00:00:00Z` : '',
  };
  for (const f of CATEGORY_FIELDS) data[f] = raw[f] === 'on';
  // One checkbox per offset (rd_14, rd_7, ...). At least one is needed while deadline notices are on; the database stores them largest first.
  const days = REMINDER_DAY_CHOICES.filter((d) => raw[`rd_${d}`] === 'on');
  if (days.length === 0 && raw.deadline === 'on') return { status: 'error', messageKey: 'gov.settings.daysRequired', values: nonSecretValues(raw) };
  if (days.length > 0) data.reminder_days = days;
  const r = await setGovPrefs(supabase, data);
  if (!r.ok) return failure(r.errorKey, nonSecretValues(raw));
  revalidatePath('/', 'layout');
  return success('gov.settings.saved');
}

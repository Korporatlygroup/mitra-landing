'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { nonSecretValues, parseForm } from '@/lib/form';
import { failure, type FormState } from '@/lib/form-state';
import { MY_STATES, businessStep1Schema, uuidSchema } from '@/lib/schemas';
import { actionUser } from '@/server/action-user';
import { getOwnerListing, saveListingDraft, submitListing } from '@/server/services/directory';
import { getBusinessProfile, listCategories, saveBusinessProfile } from '@/server/services/verification';

/**
 * Quick start: three short steps that use the SAME services, validation and review rules as the full onboarding and the listing editor.
 * Nothing here publishes anything: step 3 sends the page to INOK for review exactly like "Submit for review" in the listing editor.
 * Registration details, the authorised person and documents are NOT collected here; they stay required for verification and appear as Next steps.
 */
const base = (locale: string, orgId: string) => `/${locale}/orgs/${orgId}/business/quickstart`;
const formBase = { orgId: uuidSchema, locale: z.enum(['en', 'ms', 'ta']) };

const step2Schema = z.object({
  ...formBase,
  state: z.enum(MY_STATES, 'invalid_state'),
  district: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(80, 'invalid_district').optional()),
});
const step3Schema = z.object({
  ...formBase,
  headline: z.string('invalid_headline').trim().min(10, 'invalid_headline').max(120, 'invalid_headline'),
  description: z.string('invalid_description').trim().min(30, 'invalid_description').max(2000, 'invalid_description'),
  service_name: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().min(2, 'invalid_service_name').max(120, 'invalid_service_name').optional()),
  coverage: z.enum(['state', 'all'], 'invalid_input'),
  whatsapp: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(30, 'invalid_input').optional()),
});

export async function quickStep1Action(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(businessStep1Schema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const r = await saveBusinessProfile(supabase, d.orgId, {
    business_name: d.business_name,
    category_slug: d.category_slug,
    registration_status: d.registered === 'yes' ? 'registered' : 'unregistered',
  });
  if (!r.ok) return failure(r.errorKey, nonSecretValues(p.raw));
  revalidatePath('/', 'layout');
  return redirect(`${base(d.locale, d.orgId)}?step=2`);
}

export async function quickStep2Action(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(step2Schema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const r = await saveBusinessProfile(supabase, d.orgId, { state: d.state, district: d.district });
  if (!r.ok) return failure(r.errorKey, nonSecretValues(p.raw));
  revalidatePath('/', 'layout');
  return redirect(`${base(d.locale, d.orgId)}?step=3`);
}

export async function quickStep3Action(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(step3Schema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const [profile, categories, listing] = await Promise.all([getBusinessProfile(supabase, d.orgId), listCategories(supabase), getOwnerListing(supabase, d.orgId)]);
  if (!profile || !profile.state) return failure('listing_incomplete');
  const existing = listing?.draft?.services ?? [];
  const slug = categories.find((c) => c.id === profile.category_id)?.slug;
  if (existing.length === 0 && (!d.service_name || !slug)) return failure('invalid_service_name', nonSecretValues(p.raw));
  const services = existing.length > 0
    ? existing
    : [{ name: d.service_name!, description: null, category_slug: slug!, nationwide: d.coverage === 'all', areas: d.coverage === 'state' ? [profile.state] : [], min_order_qty: null, min_order_unit: null, lead_time_days: null, capacity_note: null }];
  const draft = listing?.draft ?? {};
  const saved = await saveListingDraft(
    supabase,
    d.orgId,
    {
      headline: d.headline,
      description: d.description,
      show_phone: false,
      show_email: false,
      public_phone: null,
      public_email: null,
      links: { ...((draft as { links?: Record<string, string | null> }).links ?? {}), whatsapp: d.whatsapp ?? null },
      hours: (draft as { hours?: string | null }).hours ?? null,
      services,
      portfolio: draft.portfolio ?? [],
    },
    listing?.draft_version ?? 0,
  );
  if (!saved.ok) return failure(saved.errorKey, nonSecretValues(p.raw));
  const sent = await submitListing(supabase, d.orgId, saved.data.version);
  if (!sent.ok) return failure(sent.errorKey, nonSecretValues(p.raw));
  revalidatePath('/', 'layout');
  return redirect(`${base(d.locale, d.orgId)}?step=done`);
}

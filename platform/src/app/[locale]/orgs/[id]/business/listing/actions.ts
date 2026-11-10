'use server';

import { revalidatePath } from 'next/cache';
import { formToObject, nonSecretValues, parseForm } from '@/lib/form';
import { failure, success, type FormState } from '@/lib/form-state';
import { acceptingSchema, listingOrgSchema, listingSaveSchema, listingVersionSchema } from '@/lib/schemas';
import { actionUser } from '@/server/action-user';
import {
  republishListing,
  saveListingDraft,
  setAcceptingRequests,
  submitListing,
  unpublishListing,
  withdrawListingSubmission,
} from '@/server/services/directory';
import type { Db } from '@/server/services/result';

const MAX_SERVICES = 10;
const MAX_PORTFOLIO = 8;

const text = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v.trim() : '');
const orNull = (s: string) => (s === '' ? null : s);

/** Reads the repeated service and portfolio rows. Fully blank rows are skipped; the database validates the rest. */
function readRows(formData: FormData) {
  const services: Record<string, unknown>[] = [];
  for (let i = 0; i < MAX_SERVICES; i++) {
    const row = {
      name: text(formData.get(`svc_name_${i}`)),
      description: text(formData.get(`svc_desc_${i}`)),
      category_slug: text(formData.get(`svc_cat_${i}`)),
      nationwide: formData.get(`svc_nat_${i}`) === 'on',
      areas: formData.getAll(`svc_areas_${i}`).filter((v): v is string => typeof v === 'string'),
      min_order_qty: text(formData.get(`svc_minqty_${i}`)),
      min_order_unit: text(formData.get(`svc_unit_${i}`)),
      lead_time_days: text(formData.get(`svc_lead_${i}`)),
      capacity_note: text(formData.get(`svc_cap_${i}`)),
    };
    const blank =
      !row.name && !row.description && !row.nationwide && row.areas.length === 0 && !row.min_order_qty && !row.min_order_unit && !row.lead_time_days && !row.capacity_note;
    if (blank) continue;
    services.push({
      ...row,
      description: orNull(row.description),
      min_order_qty: orNull(row.min_order_qty),
      min_order_unit: orNull(row.min_order_unit),
      lead_time_days: orNull(row.lead_time_days),
      capacity_note: orNull(row.capacity_note),
    });
  }
  const portfolio: Record<string, unknown>[] = [];
  for (let i = 0; i < MAX_PORTFOLIO; i++) {
    const title = text(formData.get(`pf_title_${i}`));
    const description = text(formData.get(`pf_desc_${i}`));
    if (!title && !description) continue;
    portfolio.push({ title, description: orNull(description) });
  }
  return { services, portfolio };
}

export async function saveListingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(listingSaveSchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const { services, portfolio } = readRows(formData);
  const r = await saveListingDraft(
    supabase,
    d.orgId,
    {
      headline: d.headline ?? null,
      description: d.description ?? null,
      show_phone: d.show_phone,
      show_email: d.show_email,
      public_phone: d.public_phone ?? null,
      public_email: d.public_email ?? null,
      services,
      portfolio,
    },
    d.expectedVersion,
  );
  if (!r.ok) return failure(r.errorKey, nonSecretValues(formToObject(formData)));
  revalidatePath('/', 'layout');
  return success('listing.saved');
}

export async function submitListingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(listingVersionSchema, formData);
  if (!p.ok) return failure(p.errorKey);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await submitListing(supabase, p.data.orgId, p.data.expectedVersion);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath('/', 'layout');
  return success('listing.submitted');
}

async function simple(
  formData: FormData,
  run: (db: Db, orgId: string) => Promise<{ ok: true } | { ok: false; errorKey: string }>,
  okKey: string,
): Promise<FormState> {
  const p = parseForm(listingOrgSchema, formData);
  if (!p.ok) return failure(p.errorKey);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await run(supabase, p.data.orgId);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath('/', 'layout');
  return success(okKey);
}

export async function withdrawListingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return simple(formData, (db, org) => withdrawListingSubmission(db, org), 'listing.withdrawn');
}
export async function unpublishListingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return simple(formData, (db, org) => unpublishListing(db, org), 'listing.unpublished');
}
export async function republishListingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return simple(formData, (db, org) => republishListing(db, org), 'listing.republished');
}

export async function acceptingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(acceptingSchema, formData);
  if (!p.ok) return failure(p.errorKey);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await setAcceptingRequests(supabase, p.data.orgId, p.data.value === 'true');
  if (!r.ok) return failure(r.errorKey);
  revalidatePath('/', 'layout');
  return success(p.data.value === 'true' ? 'listing.acceptingOn' : 'listing.acceptingOff');
}

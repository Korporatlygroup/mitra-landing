'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eligibleBuyerOrgs } from '@/lib/buyer-orgs';
import { formToObject, nonSecretValues, parseForm } from '@/lib/form';
import { failure, success, type FormState } from '@/lib/form-state';
import { endRequestSchema, findMoreSchema, inviteSellerSchema, requestStepSchema, submitRequestSchema } from '@/lib/schemas';
import { actionUser } from '@/server/action-user';
import { getProfile } from '@/server/services/auth';
import { endRequest, findCandidates, getBuyerRequest, inviteSeller, saveRequestDraft, setRequestVisibility, submitRequest } from '@/server/services/directory';
import { createOrg, listMyMemberships } from '@/server/services/orgs';

/** Which fields each wizard step may write (anything else in the form is ignored). */
const STEP_FIELDS: Record<number, string[]> = {
  1: ['title', 'category_slug'],
  2: ['target_state', 'target_district'],
  3: ['quantity', 'unit', 'needed_by', 'budget_min', 'budget_max'],
  4: ['description', 'contact_phone', 'contact_email'],
};

export async function saveRequestStepAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(requestStepSchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const fields = d as unknown as Record<string, string | undefined>;

  let orgId = d.orgId;
  if (!d.requestId) {
    // First step: the chosen organisation, else the only eligible one, else a new buyer organisation.
    const eligible = eligibleBuyerOrgs(await listMyMemberships(supabase, user.id));
    if (!orgId) orgId = eligible[0]?.org.id;
    if (!orgId) {
      const profile = await getProfile(supabase, user.id);
      const made = await createOrg(supabase, 'buyer', (profile.display_name || 'My requests').slice(0, 160));
      if (!made.ok) return failure(made.errorKey);
      orgId = made.data;
    }
  } else {
    orgId = (await getBuyerRequest(supabase, d.requestId))?.buyer_org_id;
    if (!orgId) return failure('not_found');
  }

  const data: Record<string, unknown> = {};
  for (const f of STEP_FIELDS[d.step] ?? []) data[f] = fields[f] ?? null;
  if (d.step === 4) data.share_contact = d.share_contact;

  const r = await saveRequestDraft(supabase, orgId, d.requestId ?? null, d.key, data, d.requestId ? d.expectedVersion : 0);
  if (!r.ok) return failure(r.errorKey, nonSecretValues(formToObject(formData)));
  revalidatePath('/', 'layout');
  if (formData.get('intent') === 'later') redirect(`/${d.locale}/requests`);
  redirect(`/${d.locale}/requests/new?step=${d.step + 1}&id=${r.data.id}`);
}

export async function submitRequestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(submitRequestSchema, formData);
  if (!p.ok) return failure(p.errorKey);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const vis = await setRequestVisibility(supabase, p.data.requestId, p.data.visibility);
  if (!vis.ok) return failure(vis.errorKey);
  const r = await submitRequest(supabase, p.data.requestId, p.data.expectedVersion);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath('/', 'layout');
  redirect(`/${p.data.locale}/requests/${p.data.requestId}?sent=1`);
}

export async function inviteSellerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(inviteSellerSchema, formData);
  if (!p.ok) return failure(p.errorKey);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await inviteSeller(supabase, p.data.requestId, p.data.sellerOrgId);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath('/', 'layout');
  return success('req.invited');
}

export async function findMoreAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(findMoreSchema, formData);
  if (!p.ok) return failure(p.errorKey);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await findCandidates(supabase, p.data.requestId, p.data.broaden === 'true');
  if (!r.ok) return failure(r.errorKey);
  revalidatePath('/', 'layout');
  return success(r.data > 0 ? 'req.foundSome' : 'req.foundNone', { n: String(r.data) });
}

export async function endRequestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(endRequestSchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await endRequest(supabase, p.data.requestId, p.data.status, p.data.reason ?? null);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath('/', 'layout');
  return success(p.data.status === 'closed' ? 'req.closed' : 'req.withdrawn');
}

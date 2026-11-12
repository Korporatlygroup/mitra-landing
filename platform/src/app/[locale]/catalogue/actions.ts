'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { effectiveMoq } from '@/components/catalogue/helpers';
import { eligibleBuyerOrgs } from '@/lib/buyer-orgs';
import { formToObject, nonSecretValues, parseForm } from '@/lib/form';
import { failure, success, type FormState } from '@/lib/form-state';
import { SCHEMA_ERROR_KEYS, productReportSchema, savedProductSchema, sourcingReplySchema, sourcingRequestSchema, sourcingWithdrawSchema, uuidSchema } from '@/lib/schemas';
import { actionUser } from '@/server/action-user';
import { getProfile } from '@/server/services/auth';
import { getCatalogueItem, replySourcingRequest, reportProduct, saveProduct, submitSourcingRequest, unsaveProduct, withdrawSourcingRequest } from '@/server/services/p5-buyer';
import { createOrg, listMyMemberships } from '@/server/services/orgs';

/** An error whose message is one of this area's own texts (p5buyer.*) instead of an `errors.*` key. */
const own = (messageKey: string, values?: Record<string, string>, data?: Record<string, string>): FormState => ({ status: 'error', messageKey, values, data });

// ------------------------------------------------------------------------------------------------ saved products

export async function saveProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(savedProductSchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await saveProduct(supabase, p.data.productId);
  if (!r.ok) return failure(r.errorKey === 'not_found' ? 'not_found' : r.errorKey);
  revalidatePath('/', 'layout');
  return success();
}

export async function unsaveProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(savedProductSchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await unsaveProduct(supabase, p.data.productId);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath('/', 'layout');
  return success();
}

// ------------------------------------------------------------------------------------------------ report

export async function reportProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(productReportSchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated', nonSecretValues(p.raw));
  const r = await reportProduct(supabase, p.data.productId, p.data.reason, p.data.note ?? null);
  if (!r.ok) return failure(r.errorKey, nonSecretValues(p.raw));
  return success('p5buyer.report.sent');
}

// ------------------------------------------------------------------------------------------------ Request Price

const optionalUuid = z.preprocess((v) => (v === '' || v == null ? undefined : v), uuidSchema.optional());
const requestFormSchema = sourcingRequestSchema.omit({ buyerOrgId: true }).extend({ buyerOrgId: optionalUuid, productId: uuidSchema });

/**
 * Sends a price request for ONE catalogue product. The success screen is the request's own page, shown only after the database
 * returned a saved request (the redirect happens after the RPC answered). The idempotency key was made once for the form, so a
 * double click or a retry after a lost answer returns the same request.
 */
export async function requestPriceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formToObject(formData);
  const values = nonSecretValues(raw);
  const parsed = requestFormSchema.safeParse({
    ...raw,
    items: JSON.stringify([{ product_id: raw.productId, ...(raw.variantSku ? { variant_sku: raw.variantSku } : {}), quantity: raw.quantity }]),
  });
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'invalid_input';
    return failure((SCHEMA_ERROR_KEYS as readonly string[]).includes(msg) ? msg : 'invalid_input', values);
  }
  const d = parsed.data;
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated', values);

  // What the buyer was shown: the minimum order for the chosen option, so the message can name it.
  const shown = await getCatalogueItem(supabase, d.productId);
  if (!shown.ok) return own('p5buyer.request.notAccepting', values);
  const line = d.items[0]!;
  const moq = effectiveMoq(shown.data, line.variant_sku);
  if (line.quantity < moq) return own('p5buyer.request.belowMoq', values, { moq: String(moq) });

  let orgId = d.buyerOrgId;
  if (!orgId) orgId = eligibleBuyerOrgs(await listMyMemberships(supabase, user.id))[0]?.org.id;
  if (!orgId) {
    const profile = await getProfile(supabase, user.id);
    const made = await createOrg(supabase, 'buyer', (profile.display_name || 'My requests').slice(0, 160));
    if (!made.ok) return failure(made.errorKey, values);
    orgId = made.data;
  }

  const r = await submitSourcingRequest(supabase, {
    buyerOrgId: orgId,
    key: d.key,
    items: d.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity, ...(i.variant_sku ? { variant_sku: i.variant_sku } : {}) })),
    destinationState: d.destinationState,
    destinationCity: d.destinationCity ?? null,
    neededBy: d.neededBy ?? null,
    notes: d.notes ?? null,
  });
  if (!r.ok) {
    if (r.errorKey === 'supplier_not_available' || r.errorKey === 'supplier_suspended' || r.errorKey === 'not_found') return own('p5buyer.request.notAccepting', values);
    if (r.errorKey === 'below_moq') return own('p5buyer.request.belowMoq', values, { moq: String(moq) });
    return failure(r.errorKey, values);
  }
  revalidatePath('/', 'layout');
  redirect(`/${d.locale}/catalogue/requests/${r.data.id}?sent=1`);
}

// ------------------------------------------------------------------------------------------------ my requests

export async function replyRequestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(sourcingReplySchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated', nonSecretValues(p.raw));
  const r = await replySourcingRequest(supabase, p.data.requestId, p.data.note);
  if (!r.ok) return failure(r.errorKey, nonSecretValues(p.raw));
  revalidatePath('/', 'layout');
  redirect(`/${p.data.locale}/catalogue/requests/${p.data.requestId}?replied=1`);
}

export async function withdrawRequestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(sourcingWithdrawSchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await withdrawSourcingRequest(supabase, p.data.requestId);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath('/', 'layout');
  redirect(`/${p.data.locale}/catalogue/requests/${p.data.requestId}?withdrawn=1`);
}

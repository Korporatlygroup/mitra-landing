'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSiteUrl } from '@/lib/env';
import { formToObject, nonSecretValues, parseForm } from '@/lib/form';
import { failure, success, type FormState } from '@/lib/form-state';
import {
  catalogueSuspendSchema,
  emailSchema,
  localeSchema,
  partnerDecisionSchema,
  partnerProvisionSchema,
  productDecisionSchema,
  productReportDecisionSchema,
  SCHEMA_ERROR_KEYS,
  supplierDecisionSchema,
  uuidSchema,
} from '@/lib/schemas';
import { actionUser } from '@/server/action-user';
import { getMailer } from '@/server/mailer';
import { buildPartnerInviteEmail } from '@/server/partner-invite-email';
import {
  approvePartner,
  handleProductReport,
  provisionPartner,
  reinstateProduct,
  reinstateSupplier,
  resendPartnerInvitation,
  reviewProduct,
  reviewSupplier,
  suspendPartner,
  suspendProduct,
  suspendSupplier,
} from '@/server/services/p5-admin';

/**
 * Server actions of the admin catalogue screens. Each one validates the form, re-reads the signed-in user from the Auth server and
 * calls one database function: the database decides who may (permissions, MFA level, conflict of interest, versions).
 */

const done = () => revalidatePath('/', 'layout');

/** Mails the owner invitation. The token never leaves the server: it is not returned, stored or logged. */
async function mailOwnerInvite(args: { to: string; orgName: string; locale: string; token: string }): Promise<boolean> {
  try {
    await getMailer().send(buildPartnerInviteEmail({ ...args, siteUrl: getSiteUrl() }));
    return true;
  } catch (e) {
    console.error('partner invitation email failed', e instanceof Error ? e.name : 'error');
    return false;
  }
}

export async function provisionPartnerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(partnerProvisionSchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const r = await provisionPartner(supabase, d.name, d.ownerEmail, d.displayName);
  if (!r.ok) return failure(r.errorKey, nonSecretValues(p.raw));
  const sent = await mailOwnerInvite({ to: d.ownerEmail, orgName: d.name, locale: d.locale, token: r.data.token });
  done();
  // The partner exists either way; if the email failed MITRA can send the invitation again from the list.
  return sent ? success('p5admin.messages.partnerProvisioned') : failure('email_failed');
}

const resendSchema = z.object({ locale: localeSchema, orgId: uuidSchema, orgName: z.string().trim().max(160).default(''), ownerEmail: emailSchema });

export async function resendInvitationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(resendSchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const r = await resendPartnerInvitation(supabase, d.orgId, d.ownerEmail);
  if (!r.ok) return failure(r.errorKey, nonSecretValues(p.raw));
  const sent = await mailOwnerInvite({ to: d.ownerEmail, orgName: d.orgName || 'MITRA', locale: d.locale, token: r.data.token });
  done();
  return sent ? success('p5admin.messages.partnerResent') : failure('email_failed');
}

export async function partnerDecisionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(partnerDecisionSchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  if (d.mode === 'suspend' && (!d.reason || d.reason.length < 5)) return failure('reason_required', { reason: d.reason ?? '' });
  const r = d.mode === 'approve' ? await approvePartner(supabase, d.orgId, d.reason ?? null) : await suspendPartner(supabase, d.orgId, d.reason!);
  if (!r.ok) return failure(r.errorKey, { reason: d.reason ?? '' });
  done();
  return success(d.mode === 'approve' ? 'p5admin.messages.partnerApproved' : 'p5admin.messages.partnerSuspended');
}

/** `checks` is a repeated checkbox field, which formToObject would collapse: read it with getAll. */
export async function reviewSupplierAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = { ...formToObject(formData), checks: formData.getAll('checks').filter((v): v is string => typeof v === 'string') };
  const parsed = supplierDecisionSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'invalid_input';
    return failure((SCHEMA_ERROR_KEYS as readonly string[]).includes(msg) ? msg : 'invalid_input', nonSecretValues(formToObject(formData)));
  }
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = parsed.data;
  const checks = d.decision === 'approve' ? d.checks : [];
  const r = await reviewSupplier(supabase, d.supplierId, d.decision, d.reason ?? null, checks, d.expectedVersion);
  if (!r.ok) return failure(r.errorKey, { reason: d.reason ?? '' });
  done();
  return success(d.decision === 'approve' ? 'p5admin.messages.supplierApproved' : d.decision === 'reject' ? 'p5admin.messages.supplierRejected' : 'p5admin.messages.supplierInfoRequested');
}

export async function reviewProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(productDecisionSchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const r = await reviewProduct(supabase, d.productId, d.decision, d.reason ?? null, d.expectedVersion);
  if (!r.ok) return failure(r.errorKey, { reason: d.reason ?? '' });
  done();
  return success(d.decision === 'approve' ? 'p5admin.messages.productApproved' : d.decision === 'reject' ? 'p5admin.messages.productRejected' : 'p5admin.messages.productChangesRequested');
}

/** Suspend or reinstate a supplier or a product, always with a reason. */
export async function suspendAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(catalogueSuspendSchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const fn =
    d.target === 'supplier' ? (d.mode === 'suspend' ? suspendSupplier : reinstateSupplier) : d.mode === 'suspend' ? suspendProduct : reinstateProduct;
  const r = await fn(supabase, d.id, d.reason);
  if (!r.ok) return failure(r.errorKey, { reason: d.reason });
  done();
  return success(`p5admin.messages.${d.target}${d.mode === 'suspend' ? 'Suspended' : 'Reinstated'}`);
}

export async function handleReportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(productReportDecisionSchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const r = await handleProductReport(supabase, d.reportId, d.action, d.note);
  if (!r.ok) return failure(r.errorKey, { note: d.note });
  done();
  return success(d.action === 'dismiss' ? 'p5admin.messages.reportDismissed' : 'p5admin.messages.reportActioned');
}

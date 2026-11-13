'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { nonSecretValues, parseForm } from '@/lib/form';
import { failure, success, type FormState } from '@/lib/form-state';
import { LIMITS, uploadOrgKey, uploadUserKey } from '@/lib/throttle';
import { MAX_UPLOAD_BYTES } from '@/lib/upload';
import {
  businessStep1Schema,
  businessStep2Schema,
  businessStep3Schema,
  businessStep4Schema,
  removeDocumentSchema,
  submitClaimSchema,
  uploadMetaSchema,
  withdrawClaimSchema,
} from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';
import * as priv from '@/server/privileged';
import { scanBytes } from '@/server/scanner';
import { ingestDepsFrom, ingestDocument } from '@/server/services/documents';
import { getRolePermissions, listMyMemberships } from '@/server/services/orgs';
import {
  listClaims,
  listDocuments,
  removeDocument,
  saveBusinessProfile,
  saveRepresentative,
  submitClaim,
  withdrawClaim,
} from '@/server/services/verification';

const base = (locale: string, orgId: string) => `/${locale}/orgs/${orgId}/business`;

async function currentUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}

/** After a step is saved: "Save and finish later" goes to the overview, otherwise to the next step. */
function afterStep(formData: FormData, locale: string, orgId: string, nextStep: number): never {
  const later = formData.get('intent') === 'later';
  redirect(later ? base(locale, orgId) : `${base(locale, orgId)}/onboarding?step=${nextStep}`);
}

export async function saveStep1Action(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(businessStep1Schema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await currentUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const r = await saveBusinessProfile(supabase, d.orgId, {
    business_name: d.business_name,
    category_slug: d.category_slug,
    registration_status: d.registered === 'yes' ? 'registered' : 'unregistered',
  });
  if (!r.ok) return failure(r.errorKey, nonSecretValues(p.raw));
  revalidatePath('/', 'layout');
  return afterStep(formData, d.locale, d.orgId, d.registered === 'yes' ? 2 : 3);
}

export async function saveStep2Action(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(businessStep2Schema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await currentUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const r = await saveBusinessProfile(supabase, d.orgId, { ssm_number: d.ssm_number, business_type: d.business_type });
  if (!r.ok) return failure(r.errorKey, nonSecretValues(p.raw));
  revalidatePath('/', 'layout');
  return afterStep(formData, d.locale, d.orgId, 3);
}

export async function saveStep3Action(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(businessStep3Schema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await currentUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const r = await saveBusinessProfile(supabase, d.orgId, {
    state: d.state,
    district: d.district,
    address_line: d.address_line,
    postcode: d.postcode,
  });
  if (!r.ok) return failure(r.errorKey, nonSecretValues(p.raw));
  revalidatePath('/', 'layout');
  return afterStep(formData, d.locale, d.orgId, 4);
}

export async function saveStep4Action(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(businessStep4Schema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await currentUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const r = await saveRepresentative(supabase, d.orgId, { name: d.rep_name, role: d.rep_role, email: d.rep_email, phone: d.rep_phone });
  if (!r.ok) return failure(r.errorKey, nonSecretValues(p.raw));
  revalidatePath('/', 'layout');
  return afterStep(formData, d.locale, d.orgId, 5);
}

/**
 * Upload pipeline entry point. Order: authenticate (getUser) and check the permission, size before reading the
 * body, then the pure pipeline (validate, hash, scan BEFORE storing, store, register, rollback on failure).
 */
export async function uploadDocumentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(uploadMetaSchema, formData);
  if (!p.ok) return failure(p.errorKey);
  const { supabase, user } = await currentUser();
  if (!user) return failure('unauthenticated');
  const { orgId, claimType, docType } = p.data;

  const mine = (await listMyMemberships(supabase, user.id)).find((m) => m.org.id === orgId);
  if (!mine || mine.org.type !== 'business' || !(await getRolePermissions(supabase, mine.role)).has('verification:submit')) {
    return failure('forbidden');
  }

  // Throttle BEFORE any processing; rejected uploads count too. authAttempt fails closed (false on any error).
  const userOk = await priv.authAttempt(uploadUserKey(user.id), LIMITS.uploadUser.max, LIMITS.uploadUser.windowSeconds);
  const orgOk = await priv.authAttempt(uploadOrgKey(orgId), LIMITS.uploadOrg.max, LIMITS.uploadOrg.windowSeconds);
  if (!userOk || !orgOk) return failure('rate_limited');

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return failure('file_empty');
  if (file.size > MAX_UPLOAD_BYTES) {
    await priv.recordRejectedUpload(orgId, user.id, claimType, 'too_large', null);
    return failure('file_too_large');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());

  const result = await ingestDocument(ingestDepsFrom(priv, scanBytes), {
    orgId,
    userId: user.id,
    claimType,
    docType,
    fileName: file.name,
    declaredMime: file.type,
    bytes,
  });
  if (!result.ok) return failure(result.errorKey);
  revalidatePath('/', 'layout');
  return success(result.scanStatus === 'clean' ? 'documents.received' : 'documents.pendingScan');
}

export async function removeDocumentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(removeDocumentSchema, formData);
  if (!p.ok) return failure(p.errorKey);
  const { supabase, user } = await currentUser();
  if (!user) return failure('unauthenticated');
  const r = await removeDocument(supabase, p.data.docId);
  if (!r.ok) return failure(r.errorKey);
  await priv.deleteObject(r.data); // the database returned the path only after marking the row removed
  revalidatePath('/', 'layout');
  return success('documents.removed');
}

export async function submitClaimAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(submitClaimSchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await currentUser();
  if (!user) return failure('unauthenticated');
  const { orgId, claimType, note, locale } = p.data;

  const claim = (await listClaims(supabase, orgId)).find((c) => c.claim_type === claimType);
  const all = claim ? await listDocuments(supabase, { claimIds: [claim.id] }) : [];
  const docs = all.filter((d) => d.scan_status === 'clean');
  // Files exist but none has passed the security scan yet (quarantine): say so instead of "send 1 to 5 documents".
  if (all.length > 0 && docs.length === 0) return failure('documents_not_ready', nonSecretValues(p.raw));
  const r = await submitClaim(supabase, orgId, claimType, docs.map((d) => d.id), note);
  if (!r.ok) return failure(r.errorKey, nonSecretValues(p.raw));
  revalidatePath('/', 'layout');
  redirect(`${base(locale, orgId)}/verification?sent=1`);
}

export async function withdrawClaimAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(withdrawClaimSchema, formData);
  if (!p.ok) return failure(p.errorKey);
  const { supabase, user } = await currentUser();
  if (!user) return failure('unauthenticated');
  const r = await withdrawClaim(supabase, p.data.claimId);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath('/', 'layout');
  return success('ver.withdrawnDone');
}

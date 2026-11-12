'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { nonSecretValues, parseForm } from '@/lib/form';
import { failure, success, type FormState } from '@/lib/form-state';
import {
  supplierDraftData,
  supplierStep1Schema,
  supplierStep2Schema,
  supplierStep3Schema,
  supplierSubmitSchema,
  supplierWithdrawSchema,
} from '@/lib/schemas';
import { z } from 'zod';
import { actionUser } from '@/server/action-user';
import * as priv from '@/server/privileged';
import { removeSupplierDocument, saveSupplierDraft, submitSupplier, withdrawSupplierSubmission } from '@/server/services/p5-partner';

const base = (locale: string, orgId: string) => `/${locale}/orgs/${orgId}/partner/suppliers`;

type StepSchema = typeof supplierStep1Schema | typeof supplierStep2Schema | typeof supplierStep3Schema;

/** Saves one wizard step. "Save draft" stays on the step, "Save and continue" goes to the next one. */
async function saveStep(schema: StepSchema, step: 1 | 2 | 3, formData: FormData): Promise<FormState> {
  const p = parseForm(schema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data as Record<string, unknown> & { orgId: string; locale: string; supplierId?: string; expectedVersion?: number };
  const stay = formData.get('intent') === 'stay';
  if (!d.supplierId && step !== 1) return failure('invalid_input', nonSecretValues(p.raw));
  const r = await saveSupplierDraft(supabase, d.orgId, d.supplierId ?? null, supplierDraftData(d), d.supplierId ? (d.expectedVersion ?? null) : null);
  if (!r.ok) return failure(r.errorKey, nonSecretValues(p.raw));
  revalidatePath('/', 'layout');
  const id = r.data.id;
  const root = `${base(d.locale, d.orgId)}/${id}/edit`;
  if (stay) {
    if (!d.supplierId) redirect(`${root}?step=${step}&saved=1`);
    return success('p5partner.supplierForm.saved');
  }
  redirect(`${root}?step=${step + 1}`);
}

export async function saveSupplierStep1Action(_prev: FormState, formData: FormData): Promise<FormState> {
  return saveStep(supplierStep1Schema, 1, formData);
}
export async function saveSupplierStep2Action(_prev: FormState, formData: FormData): Promise<FormState> {
  return saveStep(supplierStep2Schema, 2, formData);
}
export async function saveSupplierStep3Action(_prev: FormState, formData: FormData): Promise<FormState> {
  return saveStep(supplierStep3Schema, 3, formData);
}

export async function submitSupplierAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(supplierSubmitSchema, formData);
  if (!p.ok) return failure(p.errorKey);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const r = await submitSupplier(supabase, d.orgId, d.supplierId, d.expectedVersion);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath('/', 'layout');
  redirect(`${base(d.locale, d.orgId)}/${d.supplierId}?sent=1`);
}

export async function withdrawSupplierAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(supplierWithdrawSchema, formData);
  if (!p.ok) return failure(p.errorKey);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const r = await withdrawSupplierSubmission(supabase, d.orgId, d.supplierId);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath('/', 'layout');
  redirect(`${base(d.locale, d.orgId)}/${d.supplierId}?withdrawn=1`);
}

const removeDocSchema = z.object({ docId: z.uuid('invalid_input') });

/** Marks the document removed in the database, then deletes the stored object with the service client. */
export async function removeSupplierDocumentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(removeDocSchema, formData);
  if (!p.ok) return failure(p.errorKey);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await removeSupplierDocument(supabase, p.data.docId);
  if (!r.ok) return failure(r.errorKey);
  // The row is already gone from the partner's view; a failed object delete is NOT retried: there is no object sweeper (see docs/contracts/phase5-phase6.md, known limits), so an orphaned object stays private and unreachable until one is built. The partner is not shown an error.
  await priv.deleteFromBucket(priv.DOCS_BUCKET, r.data);
  revalidatePath('/', 'layout');
  return success('p5partner.docs.removed');
}

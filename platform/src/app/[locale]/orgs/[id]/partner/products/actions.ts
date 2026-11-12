'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { nonSecretValues, parseForm } from '@/lib/form';
import { failure, success, type FormState } from '@/lib/form-state';
import {
  productCreateSchema,
  productDraftData,
  productMediaRemoveSchema,
  productMediaUpdateSchema,
  productPublishSchema,
  productSubmitSchema,
  productUnpublishSchema,
  productUpdateSchema,
} from '@/lib/schemas';
import { clearedBlanks } from '@/lib/partner-ui';
import { actionUser } from '@/server/action-user';
import * as priv from '@/server/privileged';
import {
  publishProduct,
  removeProductMedia,
  saveProductDraft,
  submitProduct,
  unpublishProduct,
  updateProductMedia,
} from '@/server/services/p5-partner';

const base = (locale: string, orgId: string) => `/${locale}/orgs/${orgId}/partner/products`;

type Intent = 'primary' | 'preview' | 'submit';
const intentOf = (f: FormData): Intent => (f.get('intent') === 'preview' ? 'preview' : f.get('intent') === 'submit' ? 'submit' : 'primary');

export async function createProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(productCreateSchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const data = clearedBlanks(p.raw, productDraftData(d));
  // Nothing to clear on create: drop the empty-string keys.
  for (const [k, v] of Object.entries(data)) if (v === '') delete data[k];
  const r = await saveProductDraft(supabase, d.orgId, d.supplierId, null, data, null);
  if (!r.ok) return failure(r.errorKey, nonSecretValues(p.raw));
  revalidatePath('/', 'layout');
  const intent = intentOf(formData);
  redirect(`${base(d.locale, d.orgId)}/${r.data.id}/${intent === 'preview' ? 'preview' : 'edit?saved=1'}`);
}

export async function updateProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(productUpdateSchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const data = clearedBlanks(p.raw, productDraftData(d));
  const r = await saveProductDraft(supabase, d.orgId, d.supplierId, d.productId, data, d.expectedVersion);
  if (!r.ok) return failure(r.errorKey, nonSecretValues(p.raw));
  revalidatePath('/', 'layout');
  const intent = intentOf(formData);
  if (intent === 'preview') redirect(`${base(d.locale, d.orgId)}/${d.productId}/preview`);
  if (intent === 'submit') {
    const s = await submitProduct(supabase, d.orgId, d.productId, r.data.draft_version);
    if (!s.ok) return failure(s.errorKey, nonSecretValues(p.raw));
    revalidatePath('/', 'layout');
    redirect(`${base(d.locale, d.orgId)}/${d.productId}?sent=1`);
  }
  return success('p5partner.productForm.saved');
}

export async function submitProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(productSubmitSchema, formData);
  if (!p.ok) return failure(p.errorKey);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const r = await submitProduct(supabase, d.orgId, d.productId, d.expectedVersion);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath('/', 'layout');
  redirect(`${base(d.locale, d.orgId)}/${d.productId}?sent=1`);
}

export async function publishProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(productPublishSchema, formData);
  if (!p.ok) return failure(p.errorKey);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const r = await publishProduct(supabase, d.orgId, d.productId, d.expectedVersion);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath('/', 'layout');
  redirect(`${base(d.locale, d.orgId)}/${d.productId}?published=1`);
}

export async function unpublishProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(productUnpublishSchema, formData);
  if (!p.ok) return failure(p.errorKey);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const r = await unpublishProduct(supabase, d.orgId, d.productId);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath('/', 'layout');
  redirect(`${base(d.locale, d.orgId)}/${d.productId}?unpublished=1`);
}

export async function updateMediaAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(productMediaUpdateSchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await updateProductMedia(supabase, p.data.mediaId, p.data.alt, p.data.sort);
  if (!r.ok) return failure(r.errorKey, nonSecretValues(p.raw));
  revalidatePath('/', 'layout');
  return success('p5partner.media.saved');
}

export async function removeMediaAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(productMediaRemoveSchema, formData);
  if (!p.ok) return failure(p.errorKey);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await removeProductMedia(supabase, p.data.mediaId);
  if (!r.ok) return failure(r.errorKey);
  await priv.deleteFromBucket(priv.MEDIA_BUCKET, r.data);
  revalidatePath('/', 'layout');
  return success('p5partner.media.removed');
}


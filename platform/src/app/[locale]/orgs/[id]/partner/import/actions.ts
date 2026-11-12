'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { failure, type FormState } from '@/lib/form-state';
import { parseForm } from '@/lib/form';
import { importCancelSchema, importCommitSchema, importStageMetaSchema } from '@/lib/schemas';
import { actionUser } from '@/server/action-user';
import { canonicalRowsForRpc, fileSha256, ImportError, importCatalogueFile, LIMITS } from '@/server/import';
import * as priv from '@/server/privileged';
import type { ImportRowInput } from '@/server/services/p5-types';
import { cancelImport, commitImport, getSupplier, stageImport } from '@/server/services/p5-partner';

const base = (locale: string, orgId: string) => `/${locale}/orgs/${orgId}/partner/import`;
const fileFail = (key: string, data?: Record<string, string>): FormState => ({ status: 'error', messageKey: `p5partner.import.fileErrors.${key}`, data });

/**
 * Upload step: read the file in memory (nothing is written to disk), check it with the import engine, send the rows to the database for
 * checking (stage_import) and open the preview. The same file sent again returns the same preview (the database keys it by the file's hash).
 * A file with a problem never loses anything: the partner just gets a clear message and can upload a corrected file.
 */
export async function stageImportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(importStageMetaSchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return fileFail('import_empty');
  if (file.size > LIMITS.maxCompressedBytes) return fileFail('import_too_large', { max: String(Math.round(LIMITS.maxCompressedBytes / 1048576)) });
  if (!(await priv.authAttempt(`import:u:${user.id}`, 30, 3600))) return failure('rate_limited');

  const sup = await getSupplier(supabase, d.supplierId);
  if (!sup.ok || sup.data.partner_org_id !== d.orgId) return failure('not_found');

  const bytes = new Uint8Array(await file.arrayBuffer());
  let result;
  try {
    result = importCatalogueFile(bytes, file.name, { supplierCode: sup.data.code });
  } catch (e) {
    if (e instanceof ImportError) {
      const data: Record<string, string> = {};
      for (const [k, v] of Object.entries(e.params)) data[k] = Array.isArray(v) ? v.join(', ') : String(v);
      return fileFail(e.key, data);
    }
    return failure('internal');
  }
  if (result.fileErrors.length > 0) return fileFail('orphan_rows', { count: String(result.fileErrors.length) });
  if (result.rows.length === 0) return fileFail('import_empty');

  const name = file.name.replace(/[^\w .()-]/g, '_').slice(0, 120) || 'catalogue';
  const r = await stageImport(supabase, d.orgId, d.supplierId, d.mode, name, fileSha256(bytes), canonicalRowsForRpc(result.rows) as unknown as ImportRowInput[]);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath('/', 'layout');
  redirect(`${base(d.locale, d.orgId)}/${r.data.job_id}`);
}

/** Confirm: writes drafts only (never publishes). Updating existing drafts needs the explicit confirmation box. */
export async function commitImportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(importCommitSchema, formData);
  if (!p.ok) return failure(p.errorKey);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const r = await commitImport(supabase, d.jobId, d.confirmOverwrite);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath('/', 'layout');
  const q = new URLSearchParams({ done: '1', created: String(r.data.created), updated: String(r.data.updated), skipped: String(r.data.skipped), repeat: r.data.repeat ? '1' : '0' });
  redirect(`${base(d.locale, d.orgId)}/${d.jobId}?${q.toString()}`);
}

export async function cancelImportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(importCancelSchema, formData);
  if (!p.ok) return failure(p.errorKey);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;
  const r = await cancelImport(supabase, d.jobId);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath('/', 'layout');
  redirect(`${base(d.locale, d.orgId)}?cancelled=1`);
}

import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * The ONLY module allowed to read the service key or create a service-role client (enforced by a unit test).
 * It may only be imported from server actions and route handlers, after they have verified the session
 * with supabase.auth.getUser().
 *
 * Sign-in, MFA and sign-up audit events are written by database triggers; the app can only record the
 * two events the database cannot observe itself. Phase 2 adds private-bucket object access and the
 * service-only verification RPCs (see the bottom of this file).
 */

export type AuthEventAction = 'auth.logout' | 'auth.password_changed';

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('privileged client is not configured');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Records an auth event via RPC service_record_auth_event. Never throws and never blocks the user: failures are logged only. */
export async function recordAuthEvent(
  userId: string,
  action: AuthEventAction,
  details: Record<string, string | number | boolean> = {},
): Promise<void> {
  try {
    const { error } = await serviceClient().rpc('service_record_auth_event', {
      p_user: userId,
      p_action: action,
      p_details: details,
    });
    if (error) console.error('auth event not recorded', { action, code: error.code });
  } catch {
    console.error('auth event not recorded', { action });
  }
}

/**
 * Account-keyed throttle (RPC service_auth_attempt). Returns true when the attempt is allowed.
 * Fails CLOSED: any error (missing config, network, RPC failure) returns false.
 */
export async function authAttempt(key: string, max: number, windowSeconds: number): Promise<boolean> {
  try {
    const { data, error } = await serviceClient().rpc('service_auth_attempt', {
      p_key: key,
      p_max: max,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.error('auth throttle unavailable', { code: error.code });
      return false;
    }
    return data === true;
  } catch {
    console.error('auth throttle unavailable');
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Verification evidence: private Storage bucket + service-only RPCs. Callers (server actions / route handlers) must
// have authorised the user first; the database re-checks membership in service_register_document.
// ---------------------------------------------------------------------------------------------------------------

export const DOCS_BUCKET = 'verification-docs';

export interface RegisterDocumentInput {
  orgId: string;
  userId: string;
  claimType: string;
  docType: string;
  displayName: string;
  mime: string;
  size: number;
  sha256: string;
  storagePath: string;
  scanStatus: 'clean' | 'pending';
  scanEngine: string | null;
}

export async function uploadObject(path: string, bytes: Uint8Array, contentType: string): Promise<{ ok: boolean }> {
  try {
    const { error } = await serviceClient().storage.from(DOCS_BUCKET).upload(path, bytes, { contentType, upsert: false });
    if (error) console.error('object upload failed', { code: error.name });
    return { ok: !error };
  } catch {
    console.error('object upload failed');
    return { ok: false };
  }
}

export async function downloadObject(path: string): Promise<Blob | null> {
  try {
    const { data, error } = await serviceClient().storage.from(DOCS_BUCKET).download(path);
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

export async function deleteObject(path: string): Promise<boolean> {
  try {
    const { error } = await serviceClient().storage.from(DOCS_BUCKET).remove([path]);
    if (error) console.error('object delete failed', { code: error.name });
    return !error;
  } catch {
    console.error('object delete failed');
    return false;
  }
}

export async function registerDocument(i: RegisterDocumentInput): Promise<{ ok: true; id: string } | { ok: false; error: { code?: string; message?: string } }> {
  try {
    const { data, error } = await serviceClient().rpc('service_register_document', {
      p_org: i.orgId,
      p_user: i.userId,
      p_claim_type: i.claimType,
      p_doc_type: i.docType,
      p_display_name: i.displayName,
      p_mime: i.mime,
      p_size: i.size,
      p_sha256: i.sha256,
      p_storage_path: i.storagePath,
      p_scan_status: i.scanStatus,
      p_scan_engine: i.scanEngine,
    });
    if (error) return { ok: false, error: { code: error.code, message: error.message } };
    return { ok: true, id: String(data) };
  } catch {
    return { ok: false, error: {} };
  }
}

export async function setScanResult(docId: string, status: 'clean' | 'infected' | 'failed', engine: string): Promise<boolean> {
  try {
    const { error } = await serviceClient().rpc('service_set_scan_result', { p_doc: docId, p_status: status, p_engine: engine });
    return !error;
  } catch {
    return false;
  }
}

export async function listUnscanned(limit: number): Promise<{ id: string; storage_path: string; mime_type: string }[]> {
  try {
    const { data, error } = await serviceClient().rpc('service_list_unscanned_documents', { p_limit: limit });
    if (error) return [];
    return (data ?? []) as { id: string; storage_path: string; mime_type: string }[];
  } catch {
    return [];
  }
}

export async function recipientEmails(orgId: string): Promise<string[]> {
  try {
    const { data, error } = await serviceClient().rpc('service_org_recipient_emails', { p_org: orgId });
    if (error) return [];
    return (data ?? []) as string[];
  } catch {
    return [];
  }
}

export async function recordRejectedUpload(
  orgId: string,
  userId: string,
  claimType: string,
  reason: 'infected' | 'bad_type' | 'too_large' | 'unsafe_content' | 'empty',
  sha256: string | null,
): Promise<void> {
  try {
    const { error } = await serviceClient().rpc('service_record_rejected_upload', {
      p_org: orgId,
      p_user: userId,
      p_claim_type: claimType,
      p_reason: reason,
      p_sha256: sha256,
    });
    if (error) console.error('rejected upload not recorded', { code: error.code });
  } catch {
    console.error('rejected upload not recorded');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Phase 5: supplier evidence (bucket verification-docs, path supplier/<org>/<supplier>/<file>) and product images
// (private bucket catalogue-media, path products/<org>/<product>/<file>). Same rules: callers (route handlers / server
// actions) authorise the user first; the database re-checks membership, approval and limits in the service_* RPCs.
// ---------------------------------------------------------------------------------------------------------------

export const MEDIA_BUCKET = 'catalogue-media';
export type StorageBucket = typeof DOCS_BUCKET | typeof MEDIA_BUCKET;

export async function uploadToBucket(bucket: StorageBucket, path: string, bytes: Uint8Array, contentType: string): Promise<{ ok: boolean }> {
  try {
    const { error } = await serviceClient().storage.from(bucket).upload(path, bytes, { contentType, upsert: false });
    if (error) console.error('object upload failed', { bucket, code: error.name });
    return { ok: !error };
  } catch {
    console.error('object upload failed', { bucket });
    return { ok: false };
  }
}

export async function downloadFromBucket(bucket: StorageBucket, path: string): Promise<Blob | null> {
  try {
    const { data, error } = await serviceClient().storage.from(bucket).download(path);
    return error || !data ? null : data;
  } catch {
    return null;
  }
}

export async function deleteFromBucket(bucket: StorageBucket, path: string): Promise<boolean> {
  try {
    const { error } = await serviceClient().storage.from(bucket).remove([path]);
    if (error) console.error('object delete failed', { bucket, code: error.name });
    return !error;
  } catch {
    console.error('object delete failed', { bucket });
    return false;
  }
}

type RegisterResult = { ok: true; id: string } | { ok: false; error: { code?: string; message?: string } };

export interface RegisterSupplierDocumentInput {
  orgId: string;
  userId: string;
  supplierId: string;
  docType: string;
  displayName: string;
  mime: string;
  size: number;
  sha256: string;
  storagePath: string;
  scanStatus: 'clean' | 'pending';
  scanEngine: string | null;
}

export async function registerSupplierDocument(i: RegisterSupplierDocumentInput): Promise<RegisterResult> {
  try {
    const { data, error } = await serviceClient().rpc('service_register_supplier_document', {
      p_org: i.orgId,
      p_user: i.userId,
      p_supplier: i.supplierId,
      p_doc_type: i.docType,
      p_display_name: i.displayName,
      p_mime: i.mime,
      p_size: i.size,
      p_sha256: i.sha256,
      p_storage_path: i.storagePath,
      p_scan_status: i.scanStatus,
      p_scan_engine: i.scanEngine,
    });
    if (error) return { ok: false, error: { code: error.code, message: error.message } };
    return { ok: true, id: String(data) };
  } catch {
    return { ok: false, error: {} };
  }
}

export async function setSupplierDocumentScan(docId: string, status: 'clean' | 'infected' | 'failed', engine: string): Promise<boolean> {
  try {
    const { error } = await serviceClient().rpc('service_set_supplier_document_scan', { p_doc: docId, p_status: status, p_engine: engine });
    return !error;
  } catch {
    return false;
  }
}

export async function listUnscannedSupplierDocuments(limit: number): Promise<{ id: string; storage_path: string; mime_type: string }[]> {
  try {
    const { data, error } = await serviceClient().rpc('service_list_unscanned_supplier_documents', { p_limit: limit });
    return error ? [] : ((data ?? []) as { id: string; storage_path: string; mime_type: string }[]);
  } catch {
    return [];
  }
}

export interface RegisterProductMediaInput {
  orgId: string;
  userId: string;
  productId: string;
  mime: string;
  size: number;
  sha256: string;
  storagePath: string;
  scanStatus: 'clean' | 'pending';
  scanEngine: string | null;
  alt: string | null;
}

export async function registerProductMedia(i: RegisterProductMediaInput): Promise<RegisterResult> {
  try {
    const { data, error } = await serviceClient().rpc('service_register_product_media', {
      p_org: i.orgId,
      p_user: i.userId,
      p_product: i.productId,
      p_mime: i.mime,
      p_size: i.size,
      p_sha256: i.sha256,
      p_storage_path: i.storagePath,
      p_scan_status: i.scanStatus,
      p_scan_engine: i.scanEngine,
      p_alt: i.alt,
    });
    if (error) return { ok: false, error: { code: error.code, message: error.message } };
    return { ok: true, id: String(data) };
  } catch {
    return { ok: false, error: {} };
  }
}

export async function setProductMediaScan(mediaId: string, status: 'clean' | 'infected' | 'failed', engine: string): Promise<boolean> {
  try {
    const { error } = await serviceClient().rpc('service_set_product_media_scan', { p_media: mediaId, p_status: status, p_engine: engine });
    return !error;
  } catch {
    return false;
  }
}

export async function listUnscannedProductMedia(limit: number): Promise<{ id: string; storage_path: string; mime_type: string }[]> {
  try {
    const { data, error } = await serviceClient().rpc('service_list_unscanned_product_media', { p_limit: limit });
    return error ? [] : ((data ?? []) as { id: string; storage_path: string; mime_type: string }[]);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Phase 7: government-assistance monitoring worker. Only the audited worker RPCs can be called through this.
// ---------------------------------------------------------------------------------------------------------------

const GOV_WORKER_RPCS = [
  'gov_enqueue_due_jobs', 'gov_claim_jobs', 'gov_job_source', 'gov_complete_job', 'gov_fail_job', 'gov_submit_candidate', 'gov_mark_missing',
  'gov_enqueue_reminders', 'gov_dispatch_outbox', 'gov_mark_email',
] as const;

export async function govWorkerRpc(
  name: (typeof GOV_WORKER_RPCS)[number],
  args: Record<string, unknown> = {},
): Promise<{ data: unknown; error: { code?: string; message: string } | null }> {
  if (!GOV_WORKER_RPCS.includes(name)) return { data: null, error: { message: 'rpc_not_allowed' } };
  try {
    const { data, error } = await serviceClient().rpc(name, args);
    return { data, error: error ? { code: error.code, message: error.message } : null };
  } catch {
    return { data: null, error: { message: 'worker_unavailable' } };
  }
}

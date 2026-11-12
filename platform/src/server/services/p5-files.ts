import { createHash } from 'node:crypto';
import { mapRpcError } from '@/lib/errors';
import { stripImage, validateImageUpload } from '@/lib/image-upload';
import { sanitizeFileName, stripImageMetadata, validateUpload } from '@/lib/upload';
import type { ScanOutcome, Scanner } from '../scanner';

/**
 * Phase 5 file ingestion: supplier evidence (pdf/png/jpeg, 10 MiB) and product images (png/jpeg/webp, 5 MiB).
 * Pure: every side effect comes through `P5IngestDeps`. Order: validate, strip image metadata, hash, scan BEFORE anything is
 * stored, store, register, roll the object back when registration fails.
 *  - infected -> rejected, nothing stored or registered
 *  - scanner unavailable -> stored privately and registered as `pending`; it stays inaccessible until a later scan marks it clean
 */

export interface P5IngestDeps {
  scan: Scanner;
  upload(path: string, bytes: Uint8Array, mime: string): Promise<boolean>;
  remove(path: string): Promise<boolean>;
  register(i: { mime: string; size: number; sha256: string; storagePath: string; scanStatus: 'clean' | 'pending'; scanEngine: string | null; displayName: string }): Promise<
    { ok: true; id: string } | { ok: false; error: { code?: string; message?: string } }
  >;
  newId(): string;
}

export type P5IngestResult = { ok: true; id: string; scanStatus: 'clean' | 'pending' } | { ok: false; errorKey: string };

const sha256Hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export const supplierDocPath = (orgId: string, supplierId: string, id: string, ext: string) => `supplier/${orgId}/${supplierId}/${id}.${ext}`;
export const productMediaPath = (orgId: string, productId: string, id: string, ext: string) => `products/${orgId}/${productId}/${id}.${ext}`;

async function storeAndRegister(
  deps: P5IngestDeps,
  stored: Uint8Array,
  mime: string,
  storageExt: string,
  pathFor: (id: string, ext: string) => string,
  displayName: string,
): Promise<P5IngestResult> {
  const hash = sha256Hex(stored);
  const scan: ScanOutcome = await deps.scan(stored);
  if (scan.status === 'infected') return { ok: false, errorKey: 'file_infected' };
  const scanStatus: 'clean' | 'pending' = scan.status === 'clean' ? 'clean' : 'pending';

  const path = pathFor(deps.newId(), storageExt);
  if (!(await deps.upload(path, stored, mime))) return { ok: false, errorKey: 'upload_failed' };
  const registered = await deps.register({
    mime,
    size: stored.length,
    sha256: hash,
    storagePath: path,
    scanStatus,
    scanEngine: scanStatus === 'clean' ? scan.engine : null,
    displayName,
  });
  if (!registered.ok) {
    await deps.remove(path);
    return { ok: false, errorKey: mapRpcError(registered.error) };
  }
  return { ok: true, id: registered.id, scanStatus };
}

export async function ingestSupplierDocument(
  deps: P5IngestDeps,
  input: { orgId: string; supplierId: string; fileName: string; declaredMime: string; bytes: Uint8Array },
): Promise<P5IngestResult> {
  const v = validateUpload({ fileName: input.fileName, declaredMime: input.declaredMime, bytes: input.bytes });
  if (!v.ok) return { ok: false, errorKey: v.errorKey };
  let stored: Uint8Array = input.bytes;
  if (v.kind !== 'pdf') {
    const s = stripImageMetadata(input.bytes, v.mime);
    if (!s.ok) return { ok: false, errorKey: 'file_unsafe_content' };
    stored = s.bytes;
  }
  return storeAndRegister(deps, stored, v.mime, v.storageExt, (id, ext) => supplierDocPath(input.orgId, input.supplierId, id, ext), sanitizeFileName(input.fileName));
}

export async function ingestProductImage(
  deps: P5IngestDeps,
  input: { orgId: string; productId: string; fileName: string; declaredMime: string; bytes: Uint8Array },
): Promise<P5IngestResult> {
  const v = validateImageUpload({ fileName: input.fileName, declaredMime: input.declaredMime, bytes: input.bytes });
  if (!v.ok) return { ok: false, errorKey: v.errorKey };
  const s = stripImage(input.bytes, v.kind);
  if (!s.ok) return { ok: false, errorKey: 'file_unsafe_content' };
  return storeAndRegister(deps, s.bytes, v.mime, v.storageExt, (id, ext) => productMediaPath(input.orgId, input.productId, id, ext), sanitizeFileName(input.fileName));
}

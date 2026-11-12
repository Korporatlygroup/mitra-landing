import { createHash } from 'node:crypto';
import { mapRpcError } from '@/lib/errors';
import { MAX_UPLOAD_BYTES, sanitizeFileName, storagePathFor, stripImageMetadata, validateUpload, type RejectReason } from '@/lib/upload';
import type { ScanOutcome, Scanner } from '../scanner';

/**
 * Document ingestion and rescan. Pure: every side effect comes through `IngestDeps`, so the ordering guarantees
 * (validate, hash, scan BEFORE anything is written, rollback on failure) are unit-testable without network.
 * The real deps are wired in server actions / route handlers (the only places allowed to touch privileged.ts).
 */

export interface IngestDeps {
  scan(bytes: Uint8Array): Promise<ScanOutcome>;
  upload(path: string, bytes: Uint8Array, mime: string): Promise<boolean>;
  remove(path: string): Promise<boolean>;
  register(input: {
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
  }): Promise<{ ok: true; id: string } | { ok: false; error: { code?: string; message?: string } }>;
  recordRejected(orgId: string, userId: string, claimType: string, reason: RejectReason | 'infected', sha256: string | null): Promise<void>;
  newId(): string;
}

export interface IngestInput {
  orgId: string;
  userId: string;
  claimType: string;
  docType: string;
  fileName: string;
  declaredMime: string;
  bytes: Uint8Array;
}

export type IngestResult =
  | { ok: true; documentId: string; scanStatus: 'clean' | 'pending' }
  | { ok: false; errorKey: string };

const sha256Hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export async function ingestDocument(deps: IngestDeps, input: IngestInput): Promise<IngestResult> {
  const { orgId, userId, claimType, bytes } = input;

  // 1) size, type, magic bytes, risky content
  const v = validateUpload({ fileName: input.fileName, declaredMime: input.declaredMime, bytes });
  if (!v.ok) {
    await deps.recordRejected(orgId, userId, claimType, v.reason, bytes.length > 0 && bytes.length <= MAX_UPLOAD_BYTES ? sha256Hex(bytes) : null);
    return { ok: false, errorKey: v.errorKey };
  }

  // 2) strip image metadata (EXIF/XMP/comments) BEFORE hashing and scanning, so the scanned buffer is exactly the
  //    stored buffer and the sha256 is of the stored bytes. Malformed images are rejected.
  let stored: Uint8Array = bytes;
  if (v.kind !== 'pdf') {
    const stripped = stripImageMetadata(bytes, v.mime);
    if (!stripped.ok) {
      await deps.recordRejected(orgId, userId, claimType, 'unsafe_content', sha256Hex(bytes));
      return { ok: false, errorKey: 'file_unsafe_content' };
    }
    stored = stripped.bytes;
  }

  // 3) hash, then scan BEFORE anything is written
  const hash = sha256Hex(stored);
  const scan = await deps.scan(stored);
  if (scan.status === 'infected') {
    await deps.recordRejected(orgId, userId, claimType, 'infected', hash);
    return { ok: false, errorKey: 'file_infected' };
  }
  // Clean => usable now. Unavailable / error => quarantine: stored privately, "pending", never served until a scan succeeds.
  const scanStatus: 'clean' | 'pending' = scan.status === 'clean' ? 'clean' : 'pending';

  // 4) store, then register; roll the object back if registration fails
  const path = storagePathFor(orgId, claimType, deps.newId(), v.storageExt);
  const wrote = await deps.upload(path, stored, v.mime);
  if (!wrote) return { ok: false, errorKey: 'upload_failed' };

  const registered = await deps.register({
    orgId,
    userId,
    claimType,
    docType: input.docType,
    displayName: sanitizeFileName(input.fileName),
    mime: v.mime,
    size: stored.length,
    sha256: hash,
    storagePath: path,
    scanStatus,
    scanEngine: scanStatus === 'clean' ? scan.engine : null,
  });
  if (!registered.ok) {
    await deps.remove(path);
    return { ok: false, errorKey: mapRpcError(registered.error) };
  }
  return { ok: true, documentId: registered.id, scanStatus };
}

// ---------------------------------------------------------------------------------------------------------------

export interface RescanDeps {
  list(limit: number): Promise<{ id: string; storage_path: string; mime_type: string }[]>;
  download(path: string): Promise<Uint8Array | null>;
  scan(bytes: Uint8Array): Promise<ScanOutcome>;
  setResult(docId: string, status: 'clean' | 'infected' | 'failed', engine: string): Promise<boolean>;
  remove(path: string): Promise<boolean>;
}

export interface RescanSummary {
  checked: number;
  clean: number;
  infected: number;
  waiting: number;
  /** Documents still unscanned after this run (waiting ones plus those beyond this batch; capped by the list size). */
  remaining: number;
}

/** Scans documents still pending or failed. Documents that cannot be scanned are stamped 'failed' (rotated, still retried). Infected objects are recorded and then deleted from storage. */
export const RESCAN_BATCH = 10;

export async function rescanPending(deps: RescanDeps, limit = RESCAN_BATCH): Promise<RescanSummary> {
  const summary: RescanSummary = { checked: 0, clean: 0, infected: 0, waiting: 0, remaining: 0 };
  const all = await deps.list(100);
  for (const doc of all.slice(0, limit)) {
    summary.checked++;
    const bytes = await deps.download(doc.storage_path);
    if (!bytes) {
      // Missing object: stamp it 'failed' so it rotates to the back of the queue instead of starving newer documents.
      await deps.setResult(doc.id, 'failed', 'storage');
      summary.waiting++;
      continue;
    }
    const outcome = await deps.scan(bytes);
    if (outcome.status === 'unavailable') {
      // Scanner not configured: nothing can be scanned this run, so change nothing and stop (a no-op run).
      if (outcome.reason === 'not_configured') {
        summary.waiting++;
        break;
      }
      // Scanner down or erroring: rotate the document to the back of the queue (it stays listed and is retried).
      await deps.setResult(doc.id, 'failed', outcome.engine);
      summary.waiting++;
      continue;
    }
    if (outcome.status === 'clean') {
      if (await deps.setResult(doc.id, 'clean', outcome.engine)) summary.clean++;
      else summary.waiting++;
      continue;
    }
    // Infected: mark first (so it can never be served), then delete the object.
    if (await deps.setResult(doc.id, 'infected', outcome.engine)) {
      await deps.remove(doc.storage_path);
      summary.infected++;
    } else {
      summary.waiting++;
    }
  }
  summary.remaining = Math.max(0, all.length - summary.clean - summary.infected);
  return summary;
}

// ---------------------------------------------------------------------------------------------------------------
// Wiring helpers. The caller (an actions.ts / route.ts file) passes the privileged module as `port`.
// ---------------------------------------------------------------------------------------------------------------

export interface PrivilegedPort {
  uploadObject(path: string, bytes: Uint8Array, contentType: string): Promise<{ ok: boolean }>;
  downloadObject(path: string): Promise<Blob | null>;
  deleteObject(path: string): Promise<boolean>;
  registerDocument: (i: Parameters<IngestDeps['register']>[0]) => ReturnType<IngestDeps['register']>;
  setScanResult(docId: string, status: 'clean' | 'infected' | 'failed', engine: string): Promise<boolean>;
  listUnscanned: RescanDeps['list'];
  recordRejectedUpload(
    orgId: string,
    userId: string,
    claimType: string,
    reason: 'infected' | 'bad_type' | 'too_large' | 'unsafe_content' | 'empty',
    sha256: string | null,
  ): Promise<void>;
}

export function ingestDepsFrom(port: PrivilegedPort, scan: Scanner): IngestDeps {
  return {
    scan,
    upload: async (path, bytes, mime) => (await port.uploadObject(path, bytes, mime)).ok,
    remove: (path) => port.deleteObject(path),
    register: (input) => port.registerDocument(input),
    recordRejected: (orgId, userId, claimType, reason, sha) => port.recordRejectedUpload(orgId, userId, claimType, reason, sha),
    newId: () => crypto.randomUUID(),
  };
}

export function rescanDepsFrom(port: PrivilegedPort, scan: Scanner): RescanDeps {
  return {
    list: (limit) => port.listUnscanned(limit),
    download: async (path) => {
      const blob = await port.downloadObject(path);
      return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    },
    scan,
    setResult: (id, status, engine) => port.setScanResult(id, status, engine),
    remove: (path) => port.deleteObject(path),
  };
}

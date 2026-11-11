import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { crc32 } from '@/lib/upload';
import { scanWithClamd } from '@/server/scanner';
import type { P5IngestDeps } from '@/server/services/p5-files';
import { DOCS_BUCKET, createConfirmedUser, enrolAndVerifyTotp, serviceClient, signIn, sql, trackObject, uniq, type Signed } from './helpers';

// Shared setup for the Phase 5 integration tests (partner organisations, file builders, pipeline wiring to the real local stack).

export const MEDIA_BUCKET = 'catalogue-media';
export const svc = serviceClient();
export const mediaPaths: string[] = [];

export const pdf = () => Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% ${randomBytes(8).toString('hex')}\ntrailer\n<< >>\n%%EOF\n`);
export const pngChunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
export const png = (idat: Buffer = randomBytes(32), withText = false) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', Buffer.from([0, 0, 0, 8, 0, 0, 0, 8, 8, 2, 0, 0, 0])),
    ...(withText ? [pngChunk('tEXt', Buffer.from('Comment\0gps-secret'))] : []),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
export const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export function deps(bucket: string, scanPort: number, register: P5IngestDeps['register']): P5IngestDeps {
  return {
    scan: (bytes) => scanWithClamd(bytes, { host: '127.0.0.1', port: scanPort, timeoutMs: 8000 }),
    upload: async (path, bytes, mime) => {
      const { error } = await svc.storage.from(bucket).upload(path, bytes, { contentType: mime, upsert: false });
      if (!error) (bucket === DOCS_BUCKET ? trackObject : (p: string) => mediaPaths.push(p))(path);
      return !error;
    },
    remove: async (path) => !(await svc.storage.from(bucket).remove([path])).error,
    register,
    newId: () => randomUUID(),
  };
}

export const registerSupplierDoc = (orgId: string, userId: string, supplierId: string, docType = 'business_registration'): P5IngestDeps['register'] => async (i) => {
  const { data, error } = await svc.rpc('service_register_supplier_document', {
    p_org: orgId, p_user: userId, p_supplier: supplierId, p_doc_type: docType, p_display_name: i.displayName, p_mime: i.mime, p_size: i.size,
    p_sha256: i.sha256, p_storage_path: i.storagePath, p_scan_status: i.scanStatus, p_scan_engine: i.scanEngine,
  });
  return error ? { ok: false, error: { code: error.code, message: error.message } } : { ok: true, id: data as string };
};
export const registerMedia = (orgId: string, userId: string, productId: string): P5IngestDeps['register'] => async (i) => {
  const { data, error } = await svc.rpc('service_register_product_media', {
    p_org: orgId, p_user: userId, p_product: productId, p_mime: i.mime, p_size: i.size, p_sha256: i.sha256, p_storage_path: i.storagePath,
    p_scan_status: i.scanStatus, p_scan_engine: i.scanEngine, p_alt: 'a picture',
  });
  return error ? { ok: false, error: { code: error.code, message: error.message } } : { ok: true, id: data as string };
};

export async function partnerOwner(prefix: string): Promise<{ s: Signed; org: string }> {
  const s = await signIn(await createConfirmedUser(prefix));
  const created = await s.client.rpc('create_org', { p_type: 'partner', p_name: `Partner ${uniq(prefix)}` });
  expect(created.error).toBeNull();
  const org = created.data as string;
  await enrolAndVerifyTotp(s.client); // partner owners must be at aal2 for every action
  const profile = await s.client.rpc('save_partner_profile', { p_org: org, p_display_name: 'Test partner', p_contact_email: `${uniq('p')}@example.test` });
  expect(profile.error).toBeNull();
  // setup only: MITRA approval is covered by the database tests
  await sql(`update public.partner_profiles set status = 'approved', decided_at = now() where org_id = $1`, [org]);
  return { s, org };
}


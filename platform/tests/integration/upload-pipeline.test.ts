import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ingestDocument, rescanPending, type IngestDeps, type IngestInput, type RescanDeps } from '@/server/services/documents';
import { scanWithClamd } from '@/server/scanner';
import { crc32 } from '@/lib/upload';
import { EICAR, closedPort, startClamdStub, type ClamdStub } from './clamd-stub';
import {
  DOCS_BUCKET,
  addMember,
  cleanupUsers,
  createBusinessOrg,
  createConfirmedUser,
  enrolAndVerifyTotp,
  ensureMitraOrg,
  resetBootstrapAfterTest,
  serviceClient,
  signIn,
  sql,
  trackObject,
  type Signed,
} from './helpers';

// The real ingestion pipeline (src/server/services/documents.ts) wired to the REAL local Storage bucket and the REAL
// service-role RPCs, with a stub clamd (TCP, INSTREAM protocol) as the scanner.

let stub: ClamdStub;
let deadPort: number;
let owner: Signed;
let orgId: string;
const svc = serviceClient();

const pdf = (extra = '') => Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n${extra}\n% ${randomBytes(8).toString('hex')}\ntrailer\n<< >>\n%%EOF\n`);
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngChunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
/** A structurally valid PNG (IHDR, optional extra chunks before IDAT, IDAT, IEND, correct CRCs). */
const png = (extra: Buffer[] = [], idat: Buffer = randomBytes(32)) =>
  Buffer.concat([PNG_SIG, pngChunk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])), ...extra, pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
const jseg = (marker: number, data: Buffer) => Buffer.concat([Buffer.from([0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 0xff]), data]);
/** A structurally valid JPEG (SOI, optional extra segments, APP0, SOS + entropy data, EOI). */
const jpeg = (extra: Buffer[] = []) =>
  Buffer.concat([Buffer.from([0xff, 0xd8]), jseg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')), ...extra, jseg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])), Buffer.from([0x12, 0x34, 0x56, 0x78]), Buffer.from([0xff, 0xd9])]);
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

function deps(scanPort: number): IngestDeps {
  return {
    scan: (bytes) => scanWithClamd(bytes, { host: '127.0.0.1', port: scanPort, timeoutMs: 8000 }),
    upload: async (path, bytes, mime) => {
      const { error } = await svc.storage.from(DOCS_BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
      if (!error) trackObject(path);
      return !error;
    },
    remove: async (path) => !(await svc.storage.from(DOCS_BUCKET).remove([path])).error,
    register: async (i) => {
      const { data, error } = await svc.rpc('service_register_document', {
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
      return error ? { ok: false, error: { code: error.code, message: error.message } } : { ok: true, id: data as string };
    },
    recordRejected: async (o, u, claimType, reason, hash) => {
      await svc.rpc('service_record_rejected_upload', { p_org: o, p_user: u, p_claim_type: claimType, p_reason: reason, p_sha256: hash });
    },
    newId: () => randomUUID(),
  };
}

function rescanDeps(scanPort: number, onlyOrg: string): RescanDeps {
  return {
    // Scoped to this test's own organisation, straight from the table: the shared service_list_unscanned_documents() queue
    // is global and oldest-first, so leftover pending documents of other suites must not decide whether these tests pass.
    list: async (limit) =>
      sql<{ id: string; storage_path: string; mime_type: string }>(
        `select id, storage_path, mime_type from public.verification_documents
          where org_id = $1 and scan_status in ('pending', 'failed') and removed_at is null order by created_at limit $2`,
        [onlyOrg, limit],
      ),
    download: async (path) => {
      const { data } = await svc.storage.from(DOCS_BUCKET).download(path);
      return data ? new Uint8Array(await data.arrayBuffer()) : null;
    },
    scan: (bytes) => scanWithClamd(bytes, { host: '127.0.0.1', port: scanPort, timeoutMs: 8000 }),
    setResult: async (id, status, engine) => !(await svc.rpc('service_set_scan_result', { p_doc: id, p_status: status, p_engine: engine })).error,
    remove: async (path) => !(await svc.storage.from(DOCS_BUCKET).remove([path])).error,
  };
}

const input = (bytes: Uint8Array, fileName: string, declaredMime: string, over: Partial<IngestInput> = {}): IngestInput => ({
  orgId,
  userId: owner.user.id,
  claimType: 'business_registration',
  docType: 'ssm_certificate',
  fileName,
  declaredMime,
  bytes,
  ...over,
});

async function objectExists(path: string) {
  return !(await svc.storage.from(DOCS_BUCKET).download(path)).error;
}
async function docCount() {
  return Number((await sql<{ n: string }>('select count(*)::text as n from public.verification_documents where org_id = $1', [orgId]))[0]!.n);
}
async function objectCount() {
  const { data } = await svc.storage.from(DOCS_BUCKET).list(`${orgId}/business_registration`, { limit: 1000 });
  return (data ?? []).length;
}
async function rejections() {
  return sql<{ reason: string; sha256: string | null }>(
    `select details ->> 'reason' as reason, details ->> 'sha256' as sha256 from public.audit_log
      where action = 'verification.upload_rejected' and actor_user_id = $1 and org_id = $2 order by id`,
    [owner.user.id, orgId],
  );
}

beforeAll(async () => {
  stub = await startClamdStub();
  deadPort = await closedPort();
  owner = await signIn(await createConfirmedUser('up'));
  orgId = await createBusinessOrg(owner);
});
afterAll(async () => {
  await stub.close();
  await cleanupUsers();
  await resetBootstrapAfterTest();
});

describe('upload pipeline: accepted files', () => {
  it.each([
    ['PDF', () => pdf(), 'cert.pdf', 'application/pdf'],
    ['PNG', () => png(), 'cert.png', 'image/png'],
    ['JPEG (.jpg)', () => jpeg(), 'photo.jpg', 'image/jpeg'],
    ['JPEG (.jpeg)', () => jpeg(), 'photo.JPEG', 'image/jpeg'],
  ])('a clean %s is scanned, stored privately, registered as clean', async (_n, make, name, mime) => {
    const bytes = make();
    const scansBefore = stub.scans;
    const r = await ingestDocument(deps(stub.port), input(bytes, name, mime));
    expect(r).toMatchObject({ ok: true, scanStatus: 'clean' });
    expect(stub.scans).toBe(scansBefore + 1);
    const row = (await sql<{ storage_path: string; sha256: string; scan_status: string; size_bytes: string; mime_type: string; scan_engine: string }>(
      'select * from public.verification_documents where id = $1', [(r as { documentId: string }).documentId]))[0]!;
    expect(row.scan_status).toBe('clean');
    expect(row.sha256).toBe(sha(bytes));
    expect(Number(row.size_bytes)).toBe(bytes.length);
    expect(row.mime_type).toBe(mime);
    expect(row.storage_path.startsWith(`${orgId}/business_registration/`)).toBe(true);
    expect(row.storage_path).not.toContain(name); // the user-supplied name never reaches the path
    const dl = await svc.storage.from(DOCS_BUCKET).download(row.storage_path);
    expect(Buffer.from(await dl.data!.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it('a file of exactly 10 MiB is accepted', async () => {
    const head = Buffer.from('%PDF-1.4\n');
    const bytes = Buffer.concat([head, Buffer.alloc(10 * 1024 * 1024 - head.length, 0x20)]);
    expect(bytes.length).toBe(10 * 1024 * 1024);
    const r = await ingestDocument(deps(stub.port), input(bytes, 'big.pdf', 'application/pdf'));
    expect(r).toMatchObject({ ok: true, scanStatus: 'clean' });
    expect(stub.lastSize).toBe(bytes.length);
  }, 60_000);
});

describe('upload pipeline: rejected files leave nothing behind', () => {
  async function expectRejected(bytes: Uint8Array, name: string, mime: string, errorKey: string, reason: string, hashed = true) {
    const docsBefore = await docCount();
    const objsBefore = await objectCount();
    const rejBefore = (await rejections()).length;
    const r = await ingestDocument(deps(stub.port), input(bytes, name, mime));
    expect(r).toEqual({ ok: false, errorKey });
    expect(await docCount()).toBe(docsBefore);
    expect(await objectCount()).toBe(objsBefore);
    const rej = await rejections();
    expect(rej).toHaveLength(rejBefore + 1);
    expect(rej.at(-1)!.reason).toBe(reason);
    if (hashed) expect(rej.at(-1)!.sha256).toBe(sha(bytes));
  }

  it('EICAR: rejected as infected, nothing stored, audit row written', async () => {
    const bytes = Buffer.from(`%PDF-1.4\n% ${EICAR}\n%%EOF\n`);
    await expectRejected(bytes, 'invoice.pdf', 'application/pdf', 'file_infected', 'infected');
  });

  it('EICAR inside a PNG is rejected the same way', async () => {
    const bytes = png([], Buffer.from(EICAR, 'latin1'));
    await expectRejected(bytes, 'x.png', 'image/png', 'file_infected', 'infected');
  });

  it('10 MiB + 1 byte is rejected before scanning or storing (no hash recorded)', async () => {
    const head = Buffer.from('%PDF-1.4\n');
    const bytes = Buffer.concat([head, Buffer.alloc(10 * 1024 * 1024 + 1 - head.length, 0x20)]);
    const scansBefore = stub.scans;
    await expectRejected(bytes, 'huge.pdf', 'application/pdf', 'file_too_large', 'too_large', false);
    expect(stub.scans).toBe(scansBefore);
  }, 60_000);

  it('an empty file is rejected', async () => {
    await expectRejected(Buffer.alloc(0), 'empty.pdf', 'application/pdf', 'file_empty', 'empty', false);
  });

  it.each([
    ['PNG bytes named .pdf with a PDF MIME type', () => png(), 'a.pdf', 'application/pdf'],
    ['PDF bytes declared as image/png', () => pdf(), 'a.pdf', 'image/png'],
    ['PDF bytes with a .png extension', () => pdf(), 'a.png', 'application/pdf'],
    ['PDF bytes with an .exe extension', () => pdf(), 'a.exe', 'application/pdf'],
    ['double extension a.pdf.exe', () => pdf(), 'a.pdf.exe', 'application/pdf'],
    ['no extension', () => pdf(), 'cert', 'application/pdf'],
    ['HTML named .pdf', () => Buffer.from('<html><script>alert(1)</script></html>'), 'a.pdf', 'application/pdf'],
    ['Windows executable named .pdf', () => Buffer.concat([Buffer.from('MZ'), randomBytes(64)]), 'a.pdf', 'application/pdf'],
    ['SVG named .png', () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'a.png', 'image/png'],
    ['text/html declared for a real PDF', () => pdf(), 'a.pdf', 'text/html'],
    ['plain text', () => Buffer.from('hello world'), 'a.txt', 'text/plain'],
    ['zip archive named .pdf', () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), randomBytes(64)]), 'a.pdf', 'application/pdf'],
  ])('spoofed type: %s', async (_n, make, name, mime) => {
    await expectRejected(make(), name, mime, 'file_type_not_allowed', 'bad_type');
  });

  it.each([
    ['/JavaScript', '2 0 obj\n<< /S /JavaScript /JS (app.alert(1)) >>\nendobj'],
    ['/JS shorthand', '2 0 obj\n<< /JS (x) >>\nendobj'],
    ['name-obfuscated /J#61vaScript', '2 0 obj\n<< /S /J#61vaScript >>\nendobj'],
    ['/OpenAction', '<< /OpenAction 5 0 R >>'],
    ['/Launch', '<< /S /Launch /F (cmd.exe) >>'],
    ['/EmbeddedFile', '<< /Type /EmbeddedFile >>'],
  ])('a PDF with %s is rejected as unsafe', async (_n, body) => {
    await expectRejected(pdf(body), 'active.pdf', 'application/pdf', 'file_unsafe_content', 'unsafe_content');
  });

  it('image metadata is stripped BEFORE hashing and scanning: stored bytes, size and sha256 describe the stripped file', async () => {
    const secret = 'GPS-LAT-3.1390-LON-101.6869';
    const pngIn = png([pngChunk('tEXt', Buffer.from('Comment\0' + secret)), pngChunk('eXIf', Buffer.from('Exif\0\0' + secret)), pngChunk('tIME', Buffer.alloc(7))]);
    const jpegIn = jpeg([jseg(0xe1, Buffer.from('Exif\0\0' + secret)), jseg(0xed, Buffer.from('Photoshop 3.0\0' + secret)), jseg(0xfe, Buffer.from(secret))]);
    for (const [bytes, name, mime] of [
      [pngIn, 'meta.png', 'image/png'],
      [jpegIn, 'meta.jpg', 'image/jpeg'],
    ] as const) {
      expect(bytes.includes(Buffer.from(secret))).toBe(true);
      const scansBefore = stub.scans;
      const r = await ingestDocument(deps(stub.port), input(bytes, name, mime));
      expect(r).toMatchObject({ ok: true, scanStatus: 'clean' });
      const row = (await sql<{ storage_path: string; sha256: string; size_bytes: string }>('select storage_path, sha256, size_bytes from public.verification_documents where id = $1', [(r as { documentId: string }).documentId]))[0]!;
      const dl = await svc.storage.from(DOCS_BUCKET).download(row.storage_path);
      const storedBytes = Buffer.from(await dl.data!.arrayBuffer());
      expect(storedBytes.includes(Buffer.from(secret))).toBe(false);
      expect(storedBytes.length).toBeLessThan(bytes.length);
      expect(row.sha256).toBe(sha(storedBytes));
      expect(row.sha256).not.toBe(sha(bytes));
      expect(Number(row.size_bytes)).toBe(storedBytes.length);
      expect(stub.scans).toBe(scansBefore + 1);
      expect(stub.lastSize).toBe(storedBytes.length); // the scanner saw exactly what was stored
    }
  });

  it('a malformed image (bad PNG CRC, truncated JPEG) is rejected as unsafe and nothing is stored', async () => {
    const badCrc = Buffer.from(png());
    badCrc[badCrc.length - 20] ^= 0xff; // corrupt a byte inside the IDAT chunk
    const noEoi = jpeg().subarray(0, -2);
    for (const [bytes, name, mime] of [
      [badCrc, 'bad.png', 'image/png'],
      [noEoi, 'bad.jpg', 'image/jpeg'],
    ] as const) {
      const docsBefore = await docCount();
      const objsBefore = await objectCount();
      const r = await ingestDocument(deps(stub.port), input(bytes, name, mime));
      expect(r).toEqual({ ok: false, errorKey: 'file_unsafe_content' });
      expect(await docCount()).toBe(docsBefore);
      expect(await objectCount()).toBe(objsBefore);
      expect((await rejections()).at(-1)).toMatchObject({ reason: 'unsafe_content', sha256: sha(bytes) });
    }
  });

  it('a user-supplied file name never leaks into the storage path or the display name', async () => {
    const r = await ingestDocument(deps(stub.port), input(pdf(), '../../etc/passwd‮fdp.pdf', 'application/pdf'));
    expect(r.ok).toBe(true);
    const row = (await sql<{ storage_path: string; display_name: string }>('select storage_path, display_name from public.verification_documents where id = $1', [(r as { documentId: string }).documentId]))[0]!;
    expect(row.storage_path).not.toContain('..');
    expect(row.storage_path).toMatch(/^[0-9a-f-]{36}\/business_registration\/[0-9a-f-]{36}\.pdf$/);
    expect(row.display_name).not.toMatch(/[\\/‮]/);
  });
});

describe('upload pipeline: scanner outage quarantines instead of trusting', () => {
  it('scanner down: stored as pending, never served; the rescan then cleans it', async () => {
    const bytes = pdf();
    const r = await ingestDocument(deps(deadPort), input(bytes, 'later.pdf', 'application/pdf'));
    expect(r).toMatchObject({ ok: true, scanStatus: 'pending' });
    const id = (r as { documentId: string }).documentId;
    const row = (await sql<{ scan_status: string; scanned_at: string | null; storage_path: string }>('select scan_status, scanned_at, storage_path from public.verification_documents where id = $1', [id]))[0]!;
    expect(row.scan_status).toBe('pending');
    expect(row.scanned_at).toBeNull();
    expect(await objectExists(row.storage_path)).toBe(true);

    // not served to anyone, even the owner
    const denied = await owner.client.rpc('get_document_access', { p_doc: id });
    expect(denied.status).toBe(403);
    expect(denied.error?.message).toBe('document_not_available');
    // cannot be attached to a submission
    const submit = await owner.client.rpc('submit_claim', { p_org: orgId, p_type: 'business_registration', p_document_ids: [id], p_note: null });
    expect(submit.status).toBe(409);
    expect(submit.error?.message).toBe('documents_not_ready');

    // scanner still down during the first rescan: the document is stamped 'failed' (rotated back in the queue), still unusable
    const waiting = await rescanPending(rescanDeps(deadPort, orgId));
    expect(waiting.clean).toBe(0);
    expect(waiting.waiting).toBeGreaterThanOrEqual(1);
    const afterDown = (await sql<{ scan_status: string; scanned_at: string | null; scan_engine: string | null }>('select scan_status, scanned_at, scan_engine from public.verification_documents where id = $1', [id]))[0]!;
    expect(afterDown.scan_status).toBe('failed');
    expect(afterDown.scanned_at).not.toBeNull();
    const stillDenied = await owner.client.rpc('get_document_access', { p_doc: id });
    expect(stillDenied.status).toBe(403);
    expect(stillDenied.error?.message).toBe('document_not_available');
    const stillNotAttachable = await owner.client.rpc('submit_claim', { p_org: orgId, p_type: 'business_registration', p_document_ids: [id], p_note: null });
    expect(stillNotAttachable.error?.message).toBe('documents_not_ready');

    // scanner back: the failed document is retried, becomes clean and is then served
    const summary = await rescanPending(rescanDeps(stub.port, orgId));
    expect(summary.clean).toBeGreaterThanOrEqual(1);
    expect(summary.infected).toBe(0);
    expect((await sql<{ scan_status: string }>('select scan_status from public.verification_documents where id = $1', [id]))[0]!.scan_status).toBe('clean');
    const ok = await owner.client.rpc('get_document_access', { p_doc: id });
    expect(ok.error).toBeNull();
    expect(ok.data.storage_path).toBe(row.storage_path);
    const dl = await svc.storage.from(DOCS_BUCKET).download(ok.data.storage_path);
    expect(sha(Buffer.from(await dl.data!.arrayBuffer()))).toBe(sha(bytes));
  });

  it('a scanner that is NOT CONFIGURED stamps nothing and stops after the first document', async () => {
    const ownerN = await signIn(await createConfirmedUser('ncf'));
    const org = await createBusinessOrg(ownerN);
    const mk = (b: Buffer, name: string) => ({ ...input(b, name, 'application/pdf'), orgId: org, userId: ownerN.user.id });
    const ids: string[] = [];
    for (const n of ['one.pdf', 'two.pdf']) {
      const r = await ingestDocument(deps(deadPort), mk(pdf(), n));
      expect(r).toMatchObject({ ok: true, scanStatus: 'pending' });
      ids.push((r as { documentId: string }).documentId);
    }
    const notConfigured: RescanDeps = {
      ...rescanDeps(stub.port, org),
      scan: (bytes) => scanWithClamd(bytes, { host: undefined }), // CLAMD_HOST unset
    };
    const summary = await rescanPending(notConfigured);
    expect(summary.checked).toBe(1); // stops after the first
    expect(summary.clean + summary.infected).toBe(0);
    const rows = await sql<{ scan_status: string; scanned_at: string | null }>('select scan_status, scanned_at from public.verification_documents where id = any($1::uuid[])', [ids]);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toEqual({ scan_status: 'pending', scanned_at: null }); // nothing stamped
    const events = await sql('select 1 from public.verification_events where event = $1 and details ->> $2 = any($3::text[])', ['scan_result', 'document_id', ids]);
    expect(events).toHaveLength(0);
  });

  it('rescan finding malware: the document is marked infected, the object is deleted and access stays denied', async () => {
    const bytes = Buffer.from(`%PDF-1.4\n% ${EICAR}\n%%EOF\n`);
    const r = await ingestDocument(deps(deadPort), input(bytes, 'sneaky.pdf', 'application/pdf'));
    expect(r).toMatchObject({ ok: true, scanStatus: 'pending' }); // scanner was down, so it could not know
    const id = (r as { documentId: string }).documentId;
    const path = (await sql<{ storage_path: string }>('select storage_path from public.verification_documents where id = $1', [id]))[0]!.storage_path;
    expect(await objectExists(path)).toBe(true);

    const summary = await rescanPending(rescanDeps(stub.port, orgId));
    expect(summary.infected).toBe(1);
    expect((await sql<{ scan_status: string }>('select scan_status from public.verification_documents where id = $1', [id]))[0]!.scan_status).toBe('infected');
    expect(await objectExists(path)).toBe(false);
    const denied = await owner.client.rpc('get_document_access', { p_doc: id });
    expect(denied.status).toBe(403);
    // an infected verdict is final
    const relabel = await svc.rpc('service_set_scan_result', { p_doc: id, p_status: 'clean', p_engine: 'forged' });
    expect(relabel.status).toBe(409);
    expect(relabel.error?.message).toBe('already_scanned');
  });

  it('a document that was clean can later be flagged infected: marked, object deleted, access denied', async () => {
    const bytes = pdf();
    const r = await ingestDocument(deps(stub.port), input(bytes, 'was-clean.pdf', 'application/pdf'));
    expect(r).toMatchObject({ ok: true, scanStatus: 'clean' });
    const id = (r as { documentId: string }).documentId;
    const path = (await sql<{ storage_path: string }>('select storage_path from public.verification_documents where id = $1', [id]))[0]!.storage_path;
    expect((await owner.client.rpc('get_document_access', { p_doc: id })).error).toBeNull();

    // By design the current rescan job only lists pending / failed documents; re-scanning clean ones is a future job.
    const listed = ((await svc.rpc('service_list_unscanned_documents', { p_limit: 100 })).data ?? []) as { id: string }[];
    expect(listed.map((d) => d.id)).not.toContain(id);

    // Simulate that future job with the real rescanPending: list the clean document, scanner now knows a new signature.
    const future: RescanDeps = {
      ...rescanDeps(stub.port, orgId),
      list: async () => [{ id, storage_path: path, mime_type: 'application/pdf' }],
      scan: async () => ({ status: 'infected', engine: 'clamd', signature: 'Test.NewSignature' }),
    };
    const summary = await rescanPending(future);
    expect(summary).toMatchObject({ checked: 1, infected: 1, clean: 0 });
    expect((await sql<{ scan_status: string }>('select scan_status from public.verification_documents where id = $1', [id]))[0]!.scan_status).toBe('infected');
    expect(await objectExists(path)).toBe(false);
    const denied = await owner.client.rpc('get_document_access', { p_doc: id });
    expect(denied.status).toBe(403);
    expect(denied.error?.message).toBe('document_not_available');
    const ev = await sql<{ previous: string; scan_status: string }>(
      `select details ->> 'previous' as previous, details ->> 'scan_status' as scan_status from public.verification_events
        where event = 'scan_result' and details ->> 'document_id' = $1 order by id desc limit 1`,
      [id],
    );
    expect(ev[0]).toEqual({ previous: 'clean', scan_status: 'infected' });
    // every other change from a final state is still refused
    for (const status of ['clean', 'failed', 'infected']) {
      const r2 = await svc.rpc('service_set_scan_result', { p_doc: id, p_status: status, p_engine: 'forged' });
      expect(r2.status, status).toBe(409);
      expect(r2.error?.message).toBe('already_scanned');
    }
  });

  it('a clean document cannot be moved to failed or pending', async () => {
    const r = await ingestDocument(deps(stub.port), input(pdf(), 'stays-clean.pdf', 'application/pdf'));
    const id = (r as { documentId: string }).documentId;
    const toFailed = await svc.rpc('service_set_scan_result', { p_doc: id, p_status: 'failed', p_engine: 'x' });
    expect(toFailed.status).toBe(409);
    expect(toFailed.error?.message).toBe('already_scanned');
    const toPending = await svc.rpc('service_set_scan_result', { p_doc: id, p_status: 'pending', p_engine: 'x' });
    expect(toPending.status).toBe(422);
    expect((await sql<{ scan_status: string }>('select scan_status from public.verification_documents where id = $1', [id]))[0]!.scan_status).toBe('clean');
  });

  it('scanner down at upload, then clean, submitted, then flagged infected: the reviewer cannot approve (evidence_not_clean)', async () => {
    const ownerS = await signIn(await createConfirmedUser('scn'));
    const org = await createBusinessOrg(ownerS);
    const make = (b: Buffer, name: string) => ({ ...input(b, name, 'application/pdf'), orgId: org, userId: ownerS.user.id });
    const r = await ingestDocument(deps(deadPort), make(pdf(), 'quarantined.pdf'));
    expect(r).toMatchObject({ ok: true, scanStatus: 'pending' });
    const id = (r as { documentId: string }).documentId;

    // cannot be attached while quarantined
    const early = await ownerS.client.rpc('submit_claim', { p_org: org, p_type: 'business_registration', p_document_ids: [id], p_note: null });
    expect(early.error?.message).toBe('documents_not_ready');

    // scanner comes back: the rescan cleans it, the owner submits
    const summary = await rescanPending(rescanDeps(stub.port, org));
    expect(summary.clean).toBe(1);
    const sub = await ownerS.client.rpc('submit_claim', { p_org: org, p_type: 'business_registration', p_document_ids: [id], p_note: null });
    expect(sub.error).toBeNull();

    // later the scanner learns a new signature: the (future) re-scan flags the already-submitted document
    const path = (await sql<{ storage_path: string }>('select storage_path from public.verification_documents where id = $1', [id]))[0]!.storage_path;
    const future: RescanDeps = {
      ...rescanDeps(stub.port, org),
      list: async () => [{ id, storage_path: path, mime_type: 'application/pdf' }],
      scan: async () => ({ status: 'infected', engine: 'clamd', signature: 'Test.LateSignature' }),
    };
    expect(await rescanPending(future)).toMatchObject({ infected: 1 });
    expect(await objectExists(path)).toBe(false);

    // an uninvolved reviewer (aal2) cannot approve; the claim stays submitted; request_info still works
    const rev = await signIn(await createConfirmedUser('scr'));
    await addMember(await ensureMitraOrg(rev.user.id), rev.user.id, 'admin_review');
    await enrolAndVerifyTotp(rev.client);
    const claimId = sub.data.claim_id as string;
    const approve = await rev.client.rpc('decide_claim', { p_claim: claimId, p_decision: 'approve', p_reason: 'approving flagged evidence', p_expected_version: 1 });
    expect(approve.status).toBe(409);
    expect(approve.error?.message).toBe('evidence_not_clean');
    expect((await ownerS.client.from('verification_claims').select('status').eq('id', claimId)).data).toEqual([{ status: 'submitted' }]);
    expect((await rev.client.rpc('get_document_access', { p_doc: id })).error?.message).toBe('document_not_available');
    expect((await rev.client.rpc('decide_claim', { p_claim: claimId, p_decision: 'request_info', p_reason: 'a file was flagged by the scanner', p_expected_version: 1 })).error).toBeNull();
  });

  it('a rolled-back registration removes the stored object', async () => {
    const before = await objectCount();
    const d = deps(stub.port);
    const r = await ingestDocument(d, input(pdf(), 'x.pdf', 'application/pdf', { docType: 'address_proof' })); // wrong doc type for the claim
    expect(r.ok).toBe(false);
    expect(await objectCount()).toBe(before);
  });

  it('a user who cannot submit for the org cannot register documents (database re-check)', async () => {
    const stranger = await createConfirmedUser('str');
    const r = await ingestDocument(deps(stub.port), input(pdf(), 'x.pdf', 'application/pdf', { userId: stranger.id }));
    expect(r.ok).toBe(false);
  });
});

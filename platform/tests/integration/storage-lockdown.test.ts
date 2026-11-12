import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API_URL,
  DOCS_BUCKET,
  PUBLISHABLE_KEY,
  SERVICE_KEY,
  anonClient,
  cleanupUsers,
  createConfirmedUser,
  serviceClient,
  signIn,
  trackObject,
  type Signed,
} from './helpers';

// The verification-docs bucket is private and has NO storage policy for any API role: browsers (anon / authenticated JWTs)
// can neither list, read, write, delete nor sign anything. Only trusted server code (service role) can.

let user: Signed;
let objectPath: string;
const content = Buffer.from(`%PDF-1.4\n% lockdown ${randomBytes(6).toString('hex')}\n%%EOF\n`);
const svc = serviceClient();

beforeAll(async () => {
  user = await signIn(await createConfirmedUser('sto'));
  objectPath = `lockdown/${randomBytes(8).toString('hex')}.pdf`;
  const { error } = await svc.storage.from(DOCS_BUCKET).upload(objectPath, content, { contentType: 'application/pdf' });
  expect(error).toBeNull();
  trackObject(objectPath);
});
afterAll(cleanupUsers);

const headers = (token: string) => ({ apikey: PUBLISHABLE_KEY, authorization: `Bearer ${token}` });

describe('Storage lockdown: service role works (control)', () => {
  it('the service role can download and sign', async () => {
    const dl = await svc.storage.from(DOCS_BUCKET).download(objectPath);
    expect(dl.error).toBeNull();
    expect(Buffer.from(await dl.data!.arrayBuffer()).equals(content)).toBe(true);
    const signed = await svc.storage.from(DOCS_BUCKET).createSignedUrl(objectPath, 30);
    expect(signed.error).toBeNull();
  });

  it('the bucket itself enforces 10 MiB and the MIME allow-list even for the service role', async () => {
    const tooBig = await svc.storage.from(DOCS_BUCKET).upload(`lockdown/${randomBytes(6).toString('hex')}.pdf`, Buffer.alloc(10 * 1024 * 1024 + 1, 0x41), { contentType: 'application/pdf' });
    expect(tooBig.error).not.toBeNull();
    const html = await svc.storage.from(DOCS_BUCKET).upload(`lockdown/${randomBytes(6).toString('hex')}.html`, Buffer.from('<html></html>'), { contentType: 'text/html' });
    expect(html.error).not.toBeNull();
    const zip = await svc.storage.from(DOCS_BUCKET).upload(`lockdown/${randomBytes(6).toString('hex')}.zip`, Buffer.from('PK'), { contentType: 'application/zip' });
    expect(zip.error).not.toBeNull();
  }, 60_000);
});

describe('Storage lockdown: signed-in user JWT', () => {
  it('cannot list the bucket', async () => {
    const { data, error } = await user.client.storage.from(DOCS_BUCKET).list('lockdown');
    expect(error !== null || (data ?? []).length === 0).toBe(true);
    const root = await user.client.storage.from(DOCS_BUCKET).list('');
    expect(root.error !== null || (root.data ?? []).length === 0).toBe(true);
  });

  it('cannot download an existing object', async () => {
    const { data, error } = await user.client.storage.from(DOCS_BUCKET).download(objectPath);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    const raw = await fetch(`${API_URL}/storage/v1/object/authenticated/${DOCS_BUCKET}/${objectPath}`, { headers: headers(user.session.access_token) });
    expect(raw.status).toBeGreaterThanOrEqual(400);
    expect(await raw.text()).not.toContain('%PDF');
    const raw2 = await fetch(`${API_URL}/storage/v1/object/${DOCS_BUCKET}/${objectPath}`, { headers: headers(user.session.access_token) });
    expect(raw2.status).toBeGreaterThanOrEqual(400);
  });

  it('cannot upload', async () => {
    const path = `lockdown/user-${randomBytes(6).toString('hex')}.pdf`;
    const { data, error } = await user.client.storage.from(DOCS_BUCKET).upload(path, content, { contentType: 'application/pdf' });
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    // and nothing landed in the bucket
    const check = await svc.storage.from(DOCS_BUCKET).download(path);
    expect(check.error).not.toBeNull();
  });

  it('cannot overwrite, delete or move an existing object', async () => {
    const up = await user.client.storage.from(DOCS_BUCKET).upload(objectPath, Buffer.from('%PDF-1.4 overwritten'), { contentType: 'application/pdf', upsert: true });
    expect(up.error).not.toBeNull();
    await user.client.storage.from(DOCS_BUCKET).remove([objectPath]);
    await user.client.storage.from(DOCS_BUCKET).move(objectPath, `lockdown/moved-${randomBytes(4).toString('hex')}.pdf`);
    const still = await svc.storage.from(DOCS_BUCKET).download(objectPath);
    expect(still.error).toBeNull();
    expect(Buffer.from(await still.data!.arrayBuffer()).equals(content)).toBe(true);
  });

  it('cannot create a signed URL or a signed upload URL', async () => {
    const signed = await user.client.storage.from(DOCS_BUCKET).createSignedUrl(objectPath, 60);
    expect(signed.data).toBeNull();
    expect(signed.error).not.toBeNull();
    const many = await user.client.storage.from(DOCS_BUCKET).createSignedUrls([objectPath], 60);
    expect(many.error !== null || (many.data ?? []).every((d) => !d.signedUrl)).toBe(true);
    const upl = await user.client.storage.from(DOCS_BUCKET).createSignedUploadUrl(`lockdown/u-${randomBytes(4).toString('hex')}.pdf`);
    expect(upl.error).not.toBeNull();
  });

  it('cannot see the bucket as public, nor fetch objects through the public URL', async () => {
    const pub = await fetch(`${API_URL}/storage/v1/object/public/${DOCS_BUCKET}/${objectPath}`, { headers: headers(user.session.access_token) });
    expect(pub.status).toBeGreaterThanOrEqual(400);
    expect(await pub.text()).not.toContain('%PDF');
    const info = await fetch(`${API_URL}/storage/v1/object/info/${DOCS_BUCKET}/${objectPath}`, { headers: headers(user.session.access_token) });
    expect(info.status).toBeGreaterThanOrEqual(400);
  });

  it('cannot read or modify the bucket configuration', async () => {
    const bucket = await user.client.storage.getBucket(DOCS_BUCKET);
    expect(bucket.data?.public).not.toBe(true);
    const upd = await user.client.storage.updateBucket(DOCS_BUCKET, { public: true });
    expect(upd.error).not.toBeNull();
    const del = await user.client.storage.deleteBucket(DOCS_BUCKET);
    expect(del.error).not.toBeNull();
    const create = await user.client.storage.createBucket(`evil-${randomBytes(4).toString('hex')}`, { public: true });
    expect(create.error).not.toBeNull();
    const still = await svc.storage.getBucket(DOCS_BUCKET);
    expect(still.data?.public).toBe(false);
  });
});

describe('Storage lockdown: anonymous', () => {
  it('cannot list, download, upload or sign', async () => {
    const anon = anonClient();
    const list = await anon.storage.from(DOCS_BUCKET).list('lockdown');
    expect(list.error !== null || (list.data ?? []).length === 0).toBe(true);
    expect((await anon.storage.from(DOCS_BUCKET).download(objectPath)).error).not.toBeNull();
    expect((await anon.storage.from(DOCS_BUCKET).upload(`lockdown/anon-${randomBytes(4).toString('hex')}.pdf`, content, { contentType: 'application/pdf' })).error).not.toBeNull();
    expect((await anon.storage.from(DOCS_BUCKET).createSignedUrl(objectPath, 60)).error).not.toBeNull();
    const raw = await fetch(`${API_URL}/storage/v1/object/public/${DOCS_BUCKET}/${objectPath}`, { headers: { apikey: PUBLISHABLE_KEY } });
    expect(raw.status).toBeGreaterThanOrEqual(400);
    const noAuth = await fetch(`${API_URL}/storage/v1/object/${DOCS_BUCKET}/${objectPath}`);
    expect(noAuth.status).toBeGreaterThanOrEqual(400);
  });

  it('a made-up service key does not open the bucket', async () => {
    const fake = `sb_secret_${randomBytes(16).toString('hex')}`;
    const r = await fetch(`${API_URL}/storage/v1/object/${DOCS_BUCKET}/${objectPath}`, { headers: { apikey: fake, authorization: `Bearer ${fake}` } });
    expect(r.status).toBeGreaterThanOrEqual(400);
    // the real key is not a tautology either: it does work
    const real = await fetch(`${API_URL}/storage/v1/object/${DOCS_BUCKET}/${objectPath}`, { headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` } });
    expect(real.status).toBe(200);
  });
});

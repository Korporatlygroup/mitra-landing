import { randomBytes } from 'node:crypto';
import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { addMember, createOrgAs, createUser, signedClient, sql, uniq, type TestUser } from './db';
import { msg } from './i18n';
import { freshCode } from './totp';
import { addMitraMember, loginUi, startEnrolAndReadSecret, submitCode, type Locale } from './ui';

export type ClaimType = 'business_registration' | 'business_location' | 'representative_authority';
export const CLAIM_TYPES: ClaimType[] = ['business_registration', 'business_location', 'representative_authority'];

export interface UploadFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** A small, unique, harmless PDF (no active content). */
export function smallPdf(tag = uniq('doc')): UploadFile {
  const body = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% ${tag} ${randomBytes(8).toString('hex')}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`;
  return { name: `${tag}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(body, 'latin1') };
}

/** A PDF of exactly `size` bytes (plain filler, no risky tokens). */
export function pdfOfSize(size: number, name = 'big.pdf'): UploadFile {
  const head = Buffer.from('%PDF-1.4\n% filler\n', 'latin1');
  const tail = Buffer.from('\n%%EOF\n', 'latin1');
  const filler = Buffer.alloc(size - head.length - tail.length, 0x41);
  return { name, mimeType: 'application/pdf', buffer: Buffer.concat([head, filler, tail]) };
}

export const orgPath = (locale: Locale, orgId: string, tail = '') => `/${locale}/orgs/${orgId}/business${tail}`;

export async function createBusinessOwner(prefix = 'biz'): Promise<{ owner: TestUser; orgId: string; orgName: string }> {
  const owner = await createUser(`${prefix}-owner`, { name: `Owner ${uniq(prefix)}` });
  const orgName = `Shop ${uniq(prefix)}`;
  const orgId = await createOrgAs(owner, 'business', orgName);
  return { owner, orgId, orgName };
}

export interface Details {
  name?: string;
  category?: string;
  registered?: boolean;
  ssm?: string;
  businessType?: string;
  state?: string;
  district?: string;
  address?: string;
  postcode?: string;
  repName?: string;
  repRole?: string;
}

const T = (l: Locale, k: string, v?: Record<string, string>) => msg(l, k, v);
const main = (page: Page) => page.locator('main');

export async function gotoStep(page: Page, locale: Locale, orgId: string, step: number): Promise<void> {
  await page.goto(`${orgPath(locale, orgId, '/onboarding')}?step=${step}`);
}
const btn = (page: Page, locale: Locale, key: string) => main(page).getByRole('button', { name: T(locale, key), exact: true });

export async function fillStep1(page: Page, locale: Locale, d: Details): Promise<void> {
  if (d.name !== undefined) await page.locator('#business_name').fill(d.name);
  if (d.category !== undefined) await page.locator('#category_slug').selectOption(d.category);
  if (d.registered !== undefined) await page.locator(d.registered ? '#reg-yes' : '#reg-no').check();
}
export async function fillStep2(page: Page, d: Details): Promise<void> {
  if (d.ssm !== undefined) await page.locator('#ssm_number').fill(d.ssm);
  if (d.businessType !== undefined) await page.locator('#business_type').selectOption(d.businessType);
}
export async function fillStep3(page: Page, d: Details): Promise<void> {
  if (d.state !== undefined) await page.locator('#state').selectOption(d.state);
  if (d.district !== undefined) await page.locator('#district').fill(d.district);
  if (d.address !== undefined) await page.locator('#address_line').fill(d.address);
  if (d.postcode !== undefined) await page.locator('#postcode').fill(d.postcode);
}
export async function fillStep4(page: Page, d: Details): Promise<void> {
  if (d.repName !== undefined) await page.locator('#rep_name').fill(d.repName);
  if (d.repRole !== undefined) await page.locator('#rep_role').selectOption(d.repRole);
}

/** Steps 1 to 4 through the real forms, each with "Save and continue". Ends on step 5. */
export async function onboardUi(page: Page, locale: Locale, orgId: string, d: Details = {}): Promise<Required<Pick<Details, 'registered'>> & Details> {
  const full = {
    name: d.name ?? `Biz ${uniq('n')}`,
    category: d.category ?? 'retail-shop',
    registered: d.registered ?? true,
    ssm: d.ssm ?? '202001012345',
    businessType: d.businessType ?? 'sdn_bhd',
    state: d.state ?? 'Selangor',
    district: d.district ?? 'Petaling',
    address: d.address ?? '12 Jalan Contoh Rahsia',
    postcode: d.postcode ?? '47301',
    repName: d.repName ?? 'Siti Authorised',
    repRole: d.repRole ?? 'owner',
  };
  await gotoStep(page, locale, orgId, 1);
  await fillStep1(page, locale, full);
  await btn(page, locale, 'ob.next').click();
  if (full.registered) {
    await expect(page).toHaveURL(/step=2$/);
    await fillStep2(page, full);
    await btn(page, locale, 'ob.next').click();
  }
  await expect(page).toHaveURL(/step=3$/);
  await fillStep3(page, full);
  await btn(page, locale, 'ob.next').click();
  await expect(page).toHaveURL(/step=4$/);
  await fillStep4(page, full);
  await btn(page, locale, 'ob.next').click();
  await expect(page).toHaveURL(/step=5$/);
  return full;
}

/** The section (card) for one claim type on step 5 or the verification page. */
export function claimSection(page: Page, ct: ClaimType): Locator {
  return page.locator('section.card').filter({ has: page.locator(`#claim-${ct}`) });
}

/** Chooses a file in the claim's upload form and presses "Upload document". Returns the form's message locator. */
export async function uploadDoc(page: Page, locale: Locale, ct: ClaimType, file: UploadFile): Promise<Locator> {
  const section = claimSection(page, ct);
  const form = section.locator('form').filter({ has: page.locator(`#file-${ct}`) });
  // The previous upload re-renders the form (server revalidation); wait for that to settle, then make sure the
  // chosen file is really on the live input before pressing the button.
  await page.waitForLoadState('networkidle');
  for (let attempt = 0; attempt < 5; attempt++) {
    await section.locator(`#file-${ct}`).setInputFiles(file);
    const n = await section.locator(`#file-${ct}`).evaluate((el: HTMLInputElement) => el.files?.length ?? 0);
    if (n === 1) break;
    await page.waitForTimeout(200);
  }
  const resp = page.waitForResponse((r) => r.request().method() === 'POST');
  const submit = form.getByRole('button', { name: T(locale, 'ob.s5.upload'), exact: true });
  await submit.click();
  await resp;
  // React resets the form (clearing the file input) a moment after the action finishes: let that settle so the
  // next upload does not have its chosen file wiped.
  await expect(submit).toHaveAttribute('aria-busy', 'false');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  return form.locator('.form-message-slot');
}

/** Presses "Send for review" (or "Send again") for the claim, optionally with a note. */
export async function clickSend(page: Page, locale: Locale, ct: ClaimType, opts: { note?: string; resubmit?: boolean } = {}): Promise<void> {
  const section = claimSection(page, ct);
  if (opts.note !== undefined) await section.locator(`#note-${ct}`).fill(opts.note);
  await section.getByRole('button', { name: T(locale, opts.resubmit ? 'ver.resubmit' : 'ob.s5.submit'), exact: true }).click();
}

/** Upload one valid PDF for the claim (file: null skips it) and send it for review; ends on the verification page (?sent=1). */
export async function submitClaimUi(
  page: Page,
  locale: Locale,
  orgId: string,
  ct: ClaimType,
  opts: { file?: UploadFile | null; note?: string; resubmit?: boolean } = {},
): Promise<void> {
  await gotoStep(page, locale, orgId, 5);
  if (opts.file !== null) {
    const slot = await uploadDoc(page, locale, ct, opts.file ?? smallPdf());
    await expect(slot).toContainText(T(locale, 'documents.received'));
  }
  await clickSend(page, locale, ct, opts);
  await expect(page).toHaveURL(/\/business\/verification\?sent=1$/);
}

// ----------------------------------------------------------------------------------------------------------
// Database inspection (postgres, test checks only)
// ----------------------------------------------------------------------------------------------------------
export interface DocRow {
  id: string;
  claim_id: string;
  doc_type: string;
  display_name: string;
  scan_status: string;
  sha256: string;
  storage_path: string;
  removed_at: string | null;
}
export async function docsOf(orgId: string, ct?: ClaimType): Promise<DocRow[]> {
  return sql<DocRow>(
    `select d.id, d.claim_id, d.doc_type, d.display_name, d.scan_status, d.sha256, d.storage_path, d.removed_at
       from public.verification_documents d join public.verification_claims c on c.id = d.claim_id
      where d.org_id = $1 and ($2::text is null or c.claim_type::text = $2) order by d.created_at`,
    [orgId, ct ?? null],
  );
}
export async function claimOf(orgId: string, ct: ClaimType) {
  const r = await sql<{ id: string; status: string; version: number; decision_reason: string | null }>(
    `select id, status, version, decision_reason from public.verification_claims where org_id = $1 and claim_type = $2`,
    [orgId, ct],
  );
  return r[0] ?? null;
}
export async function eventsOf(claimId: string): Promise<{ event: string; actor_user_id: string | null; details: Record<string, unknown> }[]> {
  return sql(`select event, actor_user_id, details from public.verification_events where claim_id = $1 order by id`, [claimId]);
}
export async function auditCount(action: string, orgId: string): Promise<number> {
  return Number((await sql(`select count(*)::int as n from public.audit_log where action = $1 and org_id = $2`, [action, orgId]))[0]!.n);
}

// ----------------------------------------------------------------------------------------------------------
// Reviewers (MITRA administration), created by test setup; TOTP enrolment happens through the real UI.
// ----------------------------------------------------------------------------------------------------------
export interface Reviewer extends TestUser {
  secret: string | null;
}
export async function createReviewer(role: 'admin_review' | 'admin_ops' | 'admin_super' = 'admin_review', prefix = 'rev'): Promise<Reviewer> {
  const u = await createUser(`${prefix}-${role}`, { name: `Reviewer ${uniq(prefix)}` });
  await addMitraMember(u.id, role);
  return { ...u, secret: null };
}

/** Signs a reviewer in and gets to `path` at aal2: enrols on first use (UI), verifies afterwards. */
export async function reviewerGoto(page: Page, rv: Reviewer, path: string, opts: { login?: boolean } = {}): Promise<void> {
  if (opts.login !== false) await loginUi(page, rv, 'en');
  await page.goto(path);
  if (/\/mfa\/enrol/.test(page.url())) {
    rv.secret = await startEnrolAndReadSecret(page, path.startsWith('/ta/') ? 'ta' : 'en');
    await submitCode(page, freshCode(rv.secret));
  } else if (/\/mfa\/verify/.test(page.url())) {
    if (!rv.secret) throw new Error('reviewer has a factor but no secret');
    await submitCode(page, freshCode(rv.secret));
  }
  const pathname = path.split('?')[0]!;
  await expect(page).toHaveURL((u) => u.pathname === pathname);
}

/** An owner with an onboarded registered business whose business_registration claim has been sent for review (via the UI). */
export async function submittedBusiness(
  page: Page,
  opts: { locale?: Locale; prefix?: string; registered?: boolean; ct?: ClaimType; file?: UploadFile } = {},
): Promise<{ owner: TestUser; orgId: string; orgName: string; claimId: string; ct: ClaimType; file: UploadFile }> {
  const locale = opts.locale ?? 'en';
  const { owner, orgId, orgName } = await createBusinessOwner(opts.prefix ?? 'sub');
  await loginUi(page, owner, locale);
  await onboardUi(page, locale, orgId, { name: orgName, registered: opts.registered ?? true });
  const ct = opts.ct ?? 'business_registration';
  const file = opts.file ?? smallPdf(`sub-${ct}`);
  await submitClaimUi(page, locale, orgId, ct, { file });
  const claim = await claimOf(orgId, ct);
  return { owner, orgId, orgName, claimId: claim!.id, ct, file };
}

/** An access token at aal2 for a reviewer whose TOTP secret is known (for direct, UI-less calls). */
export async function aal2Token(rv: Reviewer): Promise<string> {
  if (!rv.secret) throw new Error('reviewer has no TOTP secret yet');
  const s = await signedClient(rv);
  const factor = (await s.client.auth.mfa.listFactors()).data!.totp[0]!;
  const ch = await s.client.auth.mfa.challenge({ factorId: factor.id });
  const ver = await s.client.auth.mfa.verify({ factorId: factor.id, challengeId: ch.data!.id, code: freshCode(rv.secret) });
  if (ver.error) throw new Error(`mfa verify failed: ${ver.error.message}`);
  return (await s.client.auth.getSession()).data.session!.access_token;
}

/** Reviewer decides a claim through the UI (starts the review when needed). Leaves the page on the claim detail. */
export async function decideAs(page: Page, rv: Reviewer, claimId: string, decision: 'approve' | 'reject' | 'request_info', reason: string, opts: { login?: boolean } = {}): Promise<void> {
  await reviewerGoto(page, rv, `/en/admin/verification/${claimId}`, opts);
  const start = page.getByRole('button', { name: msg('en', 'adminVer.startReview'), exact: true });
  if (await start.count()) {
    await start.click();
    await expect(page.getByRole('button', { name: msg('en', 'adminVer.startReview'), exact: true })).toHaveCount(0);
  }
  await page.locator({ approve: '#d-approve', reject: '#d-reject', request_info: '#d-info' }[decision]).check();
  await page.locator('#reason').fill(reason);
  await page.getByRole('button', { name: msg('en', 'adminVer.saveDecision'), exact: true }).click();
  await expect(page.locator('#reason')).toHaveCount(0);
}

/** An independent browser session for the reviewer at the same viewport as `like` (mobile emulation included). */
export async function freshReviewerContext(browser: Browser, like: Page): Promise<BrowserContext> {
  const { freshContext } = await import('./ui');
  return freshContext(browser, like);
}

export { addMember };

// ----------------------------------------------------------------------------------------------------------
// Image fixtures with embedded metadata (for the metadata-stripping checks)
// ----------------------------------------------------------------------------------------------------------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export const SECRETS = { exif: 'GPS-LAT-3.1390N-SECRET', xmp: 'XMP-CREATOR-SECRET', com: 'COMMENT-SECRET-TEXT', iptc: 'IPTC-CAPTION-SECRET', text: 'TEXT-CHUNK-SECRET', itxt: 'ITXT-CHUNK-SECRET', time: 'ZTXT-CHUNK-SECRET' };

const seg = (marker: number, payload: Buffer) => Buffer.concat([Buffer.from([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload]);

/** A structurally valid JPEG carrying EXIF, XMP, COM and APP13 segments. `truncated` cuts it before EOI (malformed). */
export function jpegWithMetadata(opts: { truncated?: boolean; name?: string } = {}): UploadFile {
  const parts = [
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from('JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00', 'latin1')),
    seg(0xe1, Buffer.from(`Exif\0\0${SECRETS.exif}`, 'latin1')),
    seg(0xe1, Buffer.from(`http://ns.adobe.com/xap/1.0/\0${SECRETS.xmp}`, 'latin1')),
    seg(0xfe, Buffer.from(SECRETS.com, 'latin1')),
    seg(0xed, Buffer.from(`Photoshop 3.0\0${SECRETS.iptc}`, 'latin1')),
    seg(0xdb, Buffer.alloc(65, 1)),
    seg(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0])),
    seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a]),
  ];
  if (!opts.truncated) parts.push(Buffer.from([0xff, 0xd9]));
  return { name: opts.name ?? 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.concat(parts) };
}

const pngChunk = (type: string, data: Buffer, badCrc = false) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE((crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])) ^ (badCrc ? 0xff : 0)) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
};

/** A structurally valid PNG carrying tEXt, iTXt, zTXt, eXIf and tIME chunks. `badCrc` corrupts a kept chunk (malformed). */
export function pngWithMetadata(opts: { badCrc?: boolean; name?: string } = {}): UploadFile {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const buf = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('tEXt', Buffer.from(`Comment\0${SECRETS.text}`, 'latin1')),
    pngChunk('iTXt', Buffer.from(`XML:com.adobe.xmp\0\0\0\0\0${SECRETS.itxt}`, 'latin1')),
    pngChunk('zTXt', Buffer.from(`Software\0\0${SECRETS.time}`, 'latin1')),
    pngChunk('eXIf', Buffer.from(SECRETS.exif, 'latin1')),
    pngChunk('tIME', Buffer.from([0x07, 0xea, 1, 2, 3, 4, 5])),
    pngChunk('IDAT', Buffer.from([0x08, 0x1d, 0x01, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0x00, 0x01]), opts.badCrc),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return { name: opts.name ?? 'scan.png', mimeType: 'image/png', buffer: buf };
}

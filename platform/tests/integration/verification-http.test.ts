import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  anonClient,
  cleanupUsers,
  createBusinessOrg,
  createConfirmedUser,
  currentAal,
  enrolAndVerifyTotp,
  ensureMitraOrg,
  registerDoc,
  resetBootstrapAfterTest,
  signIn,
  uniqEmail,
  type Signed,
} from './helpers';

// Phase 2 over the real PostgREST API with real JWTs: cross-organisation denial, role gates and the reviewer MFA flow.

let ownerA: Signed;
let ownerB: Signed;
let staffA: Signed;
let viewerA: Signed;
let reviewer: Signed;
let orgA: string;
let orgB: string;
let docB: string;
let claimB: string;

async function join(orgId: string, owner: Signed, who: Signed, role: string) {
  const inv = await owner.client.rpc('create_invitation', { p_org: orgId, p_email: who.user.email, p_role: role });
  expect(inv.error).toBeNull();
  expect((await who.client.rpc('accept_invitation', { p_token: inv.data.token })).error).toBeNull();
}

beforeAll(async () => {
  ownerA = await signIn(await createConfirmedUser('pa'));
  ownerB = await signIn(await createConfirmedUser('pb'));
  staffA = await signIn(await createConfirmedUser('ps'));
  viewerA = await signIn(await createConfirmedUser('pv'));
  reviewer = await signIn(await createConfirmedUser('prv'));
  orgA = await createBusinessOrg(ownerA);
  orgB = await createBusinessOrg(ownerB);
  await join(orgA, ownerA, staffA, 'staff');
  await join(orgA, ownerA, viewerA, 'viewer');
  docB = await registerDoc(orgB, ownerB.user.id);
  const s = await ownerB.client.rpc('submit_claim', { p_org: orgB, p_type: 'business_registration', p_document_ids: [docB], p_note: 'b' });
  expect(s.error).toBeNull();
  claimB = s.data.claim_id;
  const mitra = await ensureMitraOrg(reviewer.user.id);
  await addMember(mitra, reviewer.user.id, 'admin_review');
});
afterAll(async () => {
  await cleanupUsers();
  await resetBootstrapAfterTest();
});

describe('cross-organisation denial over HTTP', () => {
  it('org A sees none of org B across every Phase 2 table', async () => {
    for (const table of ['business_profiles', 'business_private', 'business_representatives', 'verification_claims', 'verification_documents', 'verification_events']) {
      const r = await ownerA.client.from(table).select('*').eq('org_id', orgB);
      expect(r.error, table).toBeNull();
      expect(r.data, table).toEqual([]);
    }
    const links = await ownerA.client.from('verification_claim_documents').select('*').eq('claim_id', claimB);
    expect(links.data).toEqual([]);
    const own = await ownerA.client.from('business_profiles').select('org_id');
    expect(own.data).toEqual([{ org_id: orgA }]);
  });

  it('org A cannot call any Phase 2 RPC against org B', async () => {
    const calls = await Promise.all([
      ownerA.client.rpc('save_business_profile', { p_org: orgB, p_data: { business_name: 'Hijacked Foods' } }),
      ownerA.client.rpc('save_representative', { p_org: orgB, p_name: 'Evil', p_role: 'owner', p_email: null, p_phone: null }),
      ownerA.client.rpc('submit_claim', { p_org: orgB, p_type: 'business_location', p_document_ids: [docB], p_note: null }),
      ownerA.client.rpc('withdraw_claim', { p_claim: claimB }),
      ownerA.client.rpc('remove_document', { p_doc: docB }),
      ownerA.client.rpc('start_review', { p_claim: claimB }),
      ownerA.client.rpc('decide_claim', { p_claim: claimB, p_decision: 'approve', p_reason: 'approving a rival', p_expected_version: 1 }),
    ]);
    for (const r of calls) expect(r.status).toBe(403);
    const access = await ownerA.client.rpc('get_document_access', { p_doc: docB });
    expect(access.status).toBe(404);
    const prof = await ownerB.client.from('business_profiles').select('business_name').eq('org_id', orgB);
    expect(prof.data).toEqual([{ business_name: 'Integration Foods' }]);
    const claim = await ownerB.client.from('verification_claims').select('status').eq('id', claimB);
    expect(claim.data).toEqual([{ status: 'submitted' }]);
  });

  it('no direct writes to any Phase 2 table with a user JWT', async () => {
    const c = ownerA.client;
    expect((await c.from('business_profiles').update({ business_name: 'x' }).eq('org_id', orgA)).error?.code).toBe('42501');
    expect((await c.from('business_profiles').insert({ org_id: orgA, business_name: 'x' })).error?.code).toBe('42501');
    expect((await c.from('verification_claims').update({ status: 'approved' }).eq('org_id', orgA)).error?.code).toBe('42501');
    expect((await c.from('verification_documents').update({ scan_status: 'clean' }).eq('org_id', orgA)).error?.code).toBe('42501');
    expect((await c.from('verification_documents').insert({ org_id: orgA, scan_status: 'clean' })).error?.code).toBe('42501');
    expect((await c.from('verification_events').delete().eq('org_id', orgA)).error?.code).toBe('42501');
    expect((await c.from('verification_events').insert({ org_id: orgA, event: 'approved' })).error?.code).toBe('42501');
    expect((await c.from('notifications').update({ read_at: null }).eq('user_id', ownerA.user.id)).error?.code).toBe('42501');
    expect((await c.from('business_categories').update({ active: false }).eq('slug', 'other')).error?.code).toBe('42501');
  });

  it('service-only functions are unreachable with user and anonymous keys', async () => {
    const args = {
      service_register_document: { p_org: orgA, p_user: ownerA.user.id, p_claim_type: 'business_registration', p_doc_type: 'ssm_certificate', p_display_name: 'x', p_mime: 'application/pdf', p_size: 1, p_sha256: 'a'.repeat(64), p_storage_path: 'forge/1', p_scan_status: 'clean', p_scan_engine: 'x' },
      service_set_scan_result: { p_doc: docB, p_status: 'clean', p_engine: 'x' },
      service_list_unscanned_documents: { p_limit: 5 },
      service_org_recipient_emails: { p_org: orgB },
      service_record_rejected_upload: { p_org: orgA, p_user: ownerA.user.id, p_claim_type: 'business_registration', p_reason: 'infected', p_sha256: null },
    } as const;
    for (const [fn, a] of Object.entries(args)) {
      expect((await ownerA.client.rpc(fn, a)).error?.code, `user ${fn}`).toBe('42501');
      expect((await anonClient().rpc(fn, a)).error?.code, `anon ${fn}`).toBe('42501');
    }
  });
});

describe('role gates over HTTP', () => {
  it('viewer: no sensitive data, no writes', async () => {
    for (const table of ['business_private', 'business_representatives', 'verification_claims', 'verification_documents', 'verification_events']) {
      expect((await viewerA.client.from(table).select('*')).data, table).toEqual([]);
    }
    expect((await viewerA.client.rpc('save_business_profile', { p_org: orgA, p_data: { description: 'x' } })).status).toBe(403);
    expect((await viewerA.client.rpc('submit_claim', { p_org: orgA, p_type: 'business_location', p_document_ids: [docB], p_note: null })).status).toBe(403);
  });

  it('staff: can edit the profile, cannot submit or see claims and documents', async () => {
    expect((await staffA.client.rpc('save_business_profile', { p_org: orgA, p_data: { description: 'edited by staff' } })).error).toBeNull();
    expect((await staffA.client.from('business_private').select('org_id')).data).toEqual([{ org_id: orgA }]);
    expect((await staffA.client.from('verification_claims').select('id')).data).toEqual([]);
    expect((await staffA.client.from('verification_documents').select('id')).data).toEqual([]);
    expect((await staffA.client.rpc('submit_claim', { p_org: orgA, p_type: 'business_location', p_document_ids: [docB], p_note: null })).status).toBe(403);
    expect((await staffA.client.rpc('get_document_access', { p_doc: docB })).status).toBe(404);
  });

  it('input validation errors come back as 422 with the machine key', async () => {
    const r = await ownerA.client.rpc('save_business_profile', { p_org: orgA, p_data: { postcode: '12' } });
    expect(r.status).toBe(422);
    expect(r.error?.message).toBe('invalid_postcode');
    const r2 = await ownerA.client.rpc('save_business_profile', { p_org: orgA, p_data: { ssm_number: 'nope' } });
    expect(r2.error?.message).toBe('invalid_ssm');
  });
});

describe('reviewer flow with real MFA', () => {
  it('at aal1 a reviewer sees and can do nothing; after TOTP verification they can review, access the document and decide', async () => {
    expect(await currentAal(reviewer.client)).toBe('aal1');
    expect((await reviewer.client.from('verification_claims').select('id')).data).toEqual([]);
    expect((await reviewer.client.rpc('start_review', { p_claim: claimB })).status).toBe(403);
    expect((await reviewer.client.rpc('get_document_access', { p_doc: docB })).status).toBe(404);
    expect((await reviewer.client.rpc('decide_claim', { p_claim: claimB, p_decision: 'approve', p_reason: 'looks good to me', p_expected_version: 1 })).status).toBe(403);

    await enrolAndVerifyTotp(reviewer.client);
    expect(await currentAal(reviewer.client)).toBe('aal2');

    const claims = await reviewer.client.from('verification_claims').select('id, status, snapshot').eq('id', claimB);
    expect(claims.data).toHaveLength(1);
    expect(claims.data![0]!.snapshot).toMatchObject({ business_name: 'Integration Foods', ssm_number: '202001012345' });
    // reviewers do not see private contact data or the representative record
    expect((await reviewer.client.from('business_private').select('org_id').eq('org_id', orgB)).data).toEqual([]);
    expect((await reviewer.client.from('business_representatives').select('org_id').eq('org_id', orgB)).data).toEqual([]);

    expect((await reviewer.client.rpc('start_review', { p_claim: claimB })).error).toBeNull();
    const access = await reviewer.client.rpc('get_document_access', { p_doc: docB });
    expect(access.error).toBeNull();
    expect(access.data.mime_type).toBe('application/pdf');

    const stale = await reviewer.client.rpc('decide_claim', { p_claim: claimB, p_decision: 'approve', p_reason: 'looks good to me', p_expected_version: 9 });
    expect(stale.status).toBe(409);
    expect(stale.error?.message).toBe('stale_version');
    const short = await reviewer.client.rpc('decide_claim', { p_claim: claimB, p_decision: 'approve', p_reason: 'ok', p_expected_version: 1 });
    expect(short.status).toBe(422);
    const done = await reviewer.client.rpc('decide_claim', { p_claim: claimB, p_decision: 'approve', p_reason: 'documents match the declared details', p_expected_version: 1 });
    expect(done.error).toBeNull();

    // the owner sees the outcome, the reason, the history and a notification
    const mine = await ownerB.client.from('verification_claims').select('status, decision_reason').eq('id', claimB);
    expect(mine.data).toEqual([{ status: 'approved', decision_reason: 'documents match the declared details' }]);
    const notes = await ownerB.client.from('notifications').select('kind, read_at').eq('entity_id', claimB);
    expect(notes.data).toEqual([{ kind: 'verification.approved', read_at: null }]);
    const noteId = (await ownerB.client.from('notifications').select('id').eq('entity_id', claimB)).data![0]!.id;
    expect((await ownerB.client.rpc('mark_notification_read', { p_id: noteId })).error).toBeNull();
    expect((await ownerB.client.from('notifications').select('read_at').eq('id', noteId)).data![0]!.read_at).not.toBeNull();
    const evs = await ownerB.client.from('verification_events').select('event').eq('claim_id', claimB).order('id');
    expect(evs.data!.map((e) => e.event)).toEqual(expect.arrayContaining(['submitted', 'review_started', 'document_viewed', 'approved']));
    // org A cannot read org B's notifications
    expect((await ownerA.client.from('notifications').select('id').eq('entity_id', claimB)).data).toEqual([]);
    void uniqEmail;
  });

  it('a reviewer who is also a member of the organisation is refused (conflict of interest)', async () => {
    const dual = await signIn(await createConfirmedUser('dual'));
    const mitra = await ensureMitraOrg(dual.user.id);
    await addMember(mitra, dual.user.id, 'admin_review');
    const org = await createBusinessOrg(dual);
    const doc = await registerDoc(org, dual.user.id);
    const s = await dual.client.rpc('submit_claim', { p_org: org, p_type: 'business_registration', p_document_ids: [doc], p_note: null });
    expect(s.error).toBeNull();
    await enrolAndVerifyTotp(dual.client);
    expect((await dual.client.rpc('start_review', { p_claim: s.data.claim_id })).error?.message).toBe('conflict_of_interest');
    expect((await dual.client.rpc('decide_claim', { p_claim: s.data.claim_id, p_decision: 'approve', p_reason: 'approving my own business', p_expected_version: 1 })).error?.message).toBe('conflict_of_interest');
  });
});

import { afterAll, describe, expect, it } from 'vitest';
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
  serviceClient,
  signIn,
  sql,
  type Signed,
} from './helpers';

// HTTP-level tests for the Phase 2 independent-review fixes (migration 9):
// H1 permanent conflict of interest, M1 evidence still clean, L1 summary, L2 reviewer visibility, L4 suspended org.

afterAll(async () => {
  await cleanupUsers();
  await resetBootstrapAfterTest();
});

async function join(orgId: string, owner: Signed, who: Signed, role: string) {
  const inv = await owner.client.rpc('create_invitation', { p_org: orgId, p_email: who.user.email, p_role: role });
  expect(inv.error).toBeNull();
  expect((await who.client.rpc('accept_invitation', { p_token: inv.data.token })).error).toBeNull();
}

async function reviewer(prefix: string): Promise<Signed> {
  const r = await signIn(await createConfirmedUser(prefix));
  const mitra = await ensureMitraOrg(r.user.id);
  await addMember(mitra, r.user.id, 'admin_review');
  return r;
}

async function submittedClaim(owner: Signed, org: string, docs: string[]): Promise<string> {
  const sub = await owner.client.rpc('submit_claim', { p_org: org, p_type: 'business_registration', p_document_ids: docs, p_note: null });
  expect(sub.error).toBeNull();
  return sub.data.claim_id as string;
}

describe('H1 over HTTP: conflict of interest is permanent', () => {
  it('a reviewer who owned an organisation, submitted a claim, added a second owner and left can no longer review it or open its documents', async () => {
    const dual = await reviewer('h1d');
    const successor = await signIn(await createConfirmedUser('h1s'));
    const org = await createBusinessOrg(dual);
    const doc = await registerDoc(org, dual.user.id);
    const claim = await submittedClaim(dual, org, [doc]);
    await join(org, dual, successor, 'owner');
    expect((await dual.client.rpc('remove_member', { p_org: org, p_user: dual.user.id })).error).toBeNull(); // leaves
    await enrolAndVerifyTotp(dual.client);
    expect(await currentAal(dual.client)).toBe('aal2');

    expect((await dual.client.rpc('start_review', { p_claim: claim })).error?.message).toBe('conflict_of_interest');
    const decide = await dual.client.rpc('decide_claim', { p_claim: claim, p_decision: 'approve', p_reason: 'approving what I submitted', p_expected_version: 1 });
    expect(decide.status).toBe(403);
    expect(decide.error?.message).toBe('conflict_of_interest');
    expect((await dual.client.rpc('get_document_access', { p_doc: doc })).status).toBe(404);
    expect((await successor.client.from('verification_claims').select('status').eq('id', claim)).data).toEqual([{ status: 'submitted' }]);
  });

  it('a reviewer who only submitted a claim (no membership row at all afterwards) is refused as well', async () => {
    const owner = await signIn(await createConfirmedUser('h1o'));
    const mgr = await reviewer('h1m');
    const org = await createBusinessOrg(owner);
    await join(org, owner, mgr, 'manager');
    const doc = await registerDoc(org, mgr.user.id);
    const claim = await submittedClaim(mgr, org, [doc]);
    await sql('delete from public.memberships where org_id = $1 and user_id = $2', [org, mgr.user.id]);
    await enrolAndVerifyTotp(mgr.client);
    expect((await mgr.client.rpc('start_review', { p_claim: claim })).error?.message).toBe('conflict_of_interest');
    expect((await mgr.client.rpc('decide_claim', { p_claim: claim, p_decision: 'reject', p_reason: 'rejecting what I submitted', p_expected_version: 1 })).error?.message).toBe('conflict_of_interest');
    expect((await mgr.client.rpc('get_document_access', { p_doc: doc })).status).toBe(404);
  });

  it('a reviewer who only edited the profile (updated_by) is refused', async () => {
    const owner = await signIn(await createConfirmedUser('h1p'));
    const editor = await reviewer('h1e');
    const org = await createBusinessOrg(owner);
    const doc = await registerDoc(org, owner.user.id);
    const claim = await submittedClaim(owner, org, [doc]);
    await join(org, owner, editor, 'manager');
    expect((await editor.client.rpc('save_business_profile', { p_org: org, p_data: { description: 'edited by a future reviewer' } })).error).toBeNull();
    await sql('delete from public.memberships where org_id = $1 and user_id = $2', [org, editor.user.id]);
    await enrolAndVerifyTotp(editor.client);
    expect((await editor.client.rpc('start_review', { p_claim: claim })).error?.message).toBe('conflict_of_interest');
  });

  it('an uninvolved reviewer is unaffected', async () => {
    const owner = await signIn(await createConfirmedUser('h1u'));
    const rev = await reviewer('h1r');
    const org = await createBusinessOrg(owner);
    const doc = await registerDoc(org, owner.user.id);
    const claim = await submittedClaim(owner, org, [doc]);
    await enrolAndVerifyTotp(rev.client);
    expect((await rev.client.rpc('start_review', { p_claim: claim })).error).toBeNull();
    expect((await rev.client.rpc('get_document_access', { p_doc: doc })).error).toBeNull();
    expect((await rev.client.rpc('decide_claim', { p_claim: claim, p_decision: 'approve', p_reason: 'uninvolved and satisfied', p_expected_version: 1 })).error).toBeNull();
  });
});

describe('M1 / L2 / L4 / L1 over HTTP', () => {
  it('M1: approve is refused (409 evidence_not_clean) after an attached document is flagged infected; request_info still works', async () => {
    const owner = await signIn(await createConfirmedUser('m1o'));
    const rev = await reviewer('m1r');
    const org = await createBusinessOrg(owner);
    const d1 = await registerDoc(org, owner.user.id);
    const d2 = await registerDoc(org, owner.user.id, { docType: 'ssm_form' });
    const claim = await submittedClaim(owner, org, [d1, d2]);
    await enrolAndVerifyTotp(rev.client);

    const flag = await serviceClient().rpc('service_set_scan_result', { p_doc: d2, p_status: 'infected', p_engine: 'later-signature' });
    expect(flag.error).toBeNull();

    const refused = await rev.client.rpc('decide_claim', { p_claim: claim, p_decision: 'approve', p_reason: 'approving despite the flag', p_expected_version: 1 });
    expect(refused.status).toBe(409);
    expect(refused.error?.message).toBe('evidence_not_clean');
    expect((await owner.client.from('verification_claims').select('status').eq('id', claim)).data).toEqual([{ status: 'submitted' }]);
    const ok = await rev.client.rpc('decide_claim', { p_claim: claim, p_decision: 'request_info', p_reason: 'one file failed the virus scan', p_expected_version: 1 });
    expect(ok.error).toBeNull();
  });

  it('L4: a suspended organisation cannot be reviewed (409 org_not_active) and nothing changes', async () => {
    const owner = await signIn(await createConfirmedUser('l4o'));
    const rev = await reviewer('l4r');
    const org = await createBusinessOrg(owner);
    const doc = await registerDoc(org, owner.user.id);
    const claim = await submittedClaim(owner, org, [doc]);
    await enrolAndVerifyTotp(rev.client);
    await sql(`update public.organisations set status = 'suspended' where id = $1`, [org]);
    const a = await rev.client.rpc('start_review', { p_claim: claim });
    expect(a.status).toBe(409);
    expect(a.error?.message).toBe('org_not_active');
    const b = await rev.client.rpc('decide_claim', { p_claim: claim, p_decision: 'reject', p_reason: 'rejecting a suspended org', p_expected_version: 1 });
    expect(b.error?.message).toBe('org_not_active');
    const rows = await sql<{ status: string; reviewer_id: string | null }>('select status, reviewer_id from public.verification_claims where id = $1', [claim]);
    expect(rows[0]).toEqual({ status: 'submitted', reviewer_id: null });
  });

  it('L2: a reviewer sees the profile and organisation only once a non-draft claim exists; members always see their own', async () => {
    const owner = await signIn(await createConfirmedUser('l2o'));
    const rev = await reviewer('l2r');
    const org = await createBusinessOrg(owner);
    const doc = await registerDoc(org, owner.user.id); // creates a DRAFT claim
    await enrolAndVerifyTotp(rev.client);
    expect((await rev.client.from('business_profiles').select('org_id').eq('org_id', org)).data).toEqual([]);
    expect((await rev.client.from('organisations').select('id').eq('id', org)).data).toEqual([]);
    expect((await owner.client.from('business_profiles').select('org_id').eq('org_id', org)).data).toEqual([{ org_id: org }]);
    await submittedClaim(owner, org, [doc]);
    expect((await rev.client.from('business_profiles').select('org_id').eq('org_id', org)).data).toEqual([{ org_id: org }]);
    expect((await rev.client.from('organisations').select('id').eq('id', org)).data).toEqual([{ id: org }]);
  });

  it('L1: every member role reads the verification summary; non-members and anon are denied; only three columns come back', async () => {
    const owner = await signIn(await createConfirmedUser('l1o'));
    const staff = await signIn(await createConfirmedUser('l1s'));
    const viewer = await signIn(await createConfirmedUser('l1v'));
    const stranger = await signIn(await createConfirmedUser('l1x'));
    const org = await createBusinessOrg(owner);
    await join(org, owner, staff, 'staff');
    await join(org, owner, viewer, 'viewer');
    const doc = await registerDoc(org, owner.user.id);
    expect((await owner.client.rpc('submit_claim', { p_org: org, p_type: 'business_registration', p_document_ids: [doc], p_note: 'private note' })).error).toBeNull();
    for (const who of [owner, staff, viewer]) {
      const r = await who.client.rpc('get_verification_summary', { p_org: org });
      expect(r.error).toBeNull();
      expect(r.data).toEqual([{ claim_type: 'business_registration', status: 'submitted', decided_at: null }]);
    }
    expect((await stranger.client.rpc('get_verification_summary', { p_org: org })).status).toBe(403);
    expect((await anonClient().rpc('get_verification_summary', { p_org: org })).error?.code).toBe('42501');
    expect((await viewer.client.from('verification_claims').select('owner_note').eq('org_id', org)).data).toEqual([]);
  });
});

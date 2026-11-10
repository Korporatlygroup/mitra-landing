import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  addMember,
  cleanupUsers,
  createBusinessOrg,
  createConfirmedUser,
  ensureMitraOrg,
  openUserTx,
  registerDoc,
  resetBootstrapAfterTest,
  signIn,
  sql,
  type Signed,
  type TestUser,
} from './helpers';

// Concurrency on the claim state machine. Each racer is its own connection + transaction acting as a different user
// (role authenticated + JWT claims). A acts first and keeps its transaction open; B starts meanwhile and must WAIT on the
// row lock (FOR UPDATE), then re-evaluate against what A committed.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let owner: Signed;
let rev1: TestUser;
let rev2: TestUser;
let orgId: string;

type Outcome = { ok: true } | { ok: false; code?: string; message?: string };

async function raceTx(
  a: { c: pg.Client; run: (c: pg.Client) => Promise<unknown> },
  b: { c: pg.Client; run: (c: pg.Client) => Promise<unknown> },
): Promise<{ bBlocked: boolean; rb: Outcome }> {
  await a.run(a.c); // A holds its locks, uncommitted
  let settled = false;
  const pb: Promise<Outcome> = b
    .run(b.c)
    .then((): Outcome => ({ ok: true }), (e: { code?: string; message?: string }): Outcome => ({ ok: false, code: e.code, message: e.message }))
    .finally(() => {
      settled = true;
    });
  await sleep(700);
  const bBlocked = !settled;
  await a.c.query('commit');
  const rb = await pb;
  await b.c.query(rb.ok ? 'commit' : 'rollback');
  return { bBlocked, rb };
}

async function submittedClaim(claimType: string, docType: string): Promise<{ claimId: string; docId: string }> {
  const docId = await registerDoc(orgId, owner.user.id, { claimType, docType });
  const s = await owner.client.rpc('submit_claim', { p_org: orgId, p_type: claimType, p_document_ids: [docId], p_note: null });
  expect(s.error).toBeNull();
  return { claimId: s.data.claim_id as string, docId };
}

beforeAll(async () => {
  owner = await signIn(await createConfirmedUser('rc'));
  rev1 = await createConfirmedUser('rv1');
  rev2 = await createConfirmedUser('rv2');
  orgId = await createBusinessOrg(owner);
  const mitra = await ensureMitraOrg(rev1.id);
  await addMember(mitra, rev1.id, 'admin_review');
  await addMember(mitra, rev2.id, 'admin_review');
});
afterAll(async () => {
  await cleanupUsers();
  await resetBootstrapAfterTest();
});

describe('two reviewers on the same claim', () => {
  it('deciding concurrently: exactly one decision wins, the other is refused', async () => {
    const { claimId } = await submittedClaim('business_registration', 'ssm_certificate');
    const c1 = await openUserTx(rev1.id, rev1.email, 'aal2');
    const c2 = await openUserTx(rev2.id, rev2.email, 'aal2');
    try {
      const { bBlocked, rb } = await raceTx(
        { c: c1, run: (c) => c.query(`select public.decide_claim($1, 'approve', 'reviewer one approves', 1)`, [claimId]) },
        { c: c2, run: (c) => c.query(`select public.decide_claim($1, 'reject', 'reviewer two rejects', 1)`, [claimId]) },
      );
      expect(bBlocked, 'the second reviewer must wait for the first transaction').toBe(true);
      expect(rb.ok).toBe(false);
      if (!rb.ok) {
        expect(rb.code).toBe('PT409');
        expect(rb.message).toBe('claim_not_reviewable');
      }
    } finally {
      await c1.end().catch(() => {});
      await c2.end().catch(() => {});
    }
    const claim = (await sql<{ status: string; decided_by: string; decision_reason: string }>('select status, decided_by, decision_reason from public.verification_claims where id = $1', [claimId]))[0]!;
    expect(claim.status).toBe('approved');
    expect(claim.decided_by).toBe(rev1.id);
    expect(claim.decision_reason).toBe('reviewer one approves');
    const events = await sql<{ event: string }>(`select event from public.verification_events where claim_id = $1 and event in ('approved','rejected','info_requested')`, [claimId]);
    expect(events.map((e) => e.event)).toEqual(['approved']);
    const notif = await sql<{ n: string }>(`select count(*)::text as n from public.notifications where entity_id = $1 and kind like 'verification.%'`, [claimId]);
    expect(Number(notif[0]!.n)).toBe(1); // only the owner (single member), only once
  });

  it('starting the review concurrently: exactly one reviewer is recorded', async () => {
    const { claimId } = await submittedClaim('business_location', 'address_proof');
    const c1 = await openUserTx(rev1.id, rev1.email, 'aal2');
    const c2 = await openUserTx(rev2.id, rev2.email, 'aal2');
    try {
      const { bBlocked, rb } = await raceTx(
        { c: c1, run: (c) => c.query('select public.start_review($1)', [claimId]) },
        { c: c2, run: (c) => c.query('select public.start_review($1)', [claimId]) },
      );
      expect(bBlocked).toBe(true);
      expect(rb.ok).toBe(false);
      if (!rb.ok) expect(rb.message).toBe('claim_not_reviewable');
    } finally {
      await c1.end().catch(() => {});
      await c2.end().catch(() => {});
    }
    const claim = (await sql<{ status: string; reviewer_id: string }>('select status, reviewer_id from public.verification_claims where id = $1', [claimId]))[0]!;
    expect(claim.status).toBe('in_review');
    expect(claim.reviewer_id).toBe(rev1.id);
    const started = await sql(`select 1 from public.verification_events where claim_id = $1 and event = 'review_started'`, [claimId]);
    expect(started).toHaveLength(1);
  });
});

describe('submit racing a decision', () => {
  it('a decision made against version 1 loses to a withdraw + resubmit (version 2): stale_version', async () => {
    const { claimId, docId } = await submittedClaim('representative_authority', 'authorisation_letter');
    const cOwner = await openUserTx(owner.user.id, owner.user.email, 'aal1');
    const cRev = await openUserTx(rev1.id, rev1.email, 'aal2');
    try {
      const { bBlocked, rb } = await raceTx(
        {
          c: cOwner,
          run: async (c) => {
            await c.query('select public.withdraw_claim($1)', [claimId]);
            await c.query(`select public.submit_claim($1, 'representative_authority', $2::uuid[], 'resubmitted in a race')`, [orgId, [docId]]);
          },
        },
        { c: cRev, run: (c) => c.query(`select public.decide_claim($1, 'approve', 'decided on the old version', 1)`, [claimId]) },
      );
      expect(bBlocked, "the decision must wait for the owner's transaction").toBe(true);
      expect(rb.ok).toBe(false);
      if (!rb.ok) {
        expect(rb.code).toBe('PT409');
        expect(rb.message).toBe('stale_version');
      }
    } finally {
      await cOwner.end().catch(() => {});
      await cRev.end().catch(() => {});
    }
    const claim = (await sql<{ status: string; version: number; decided_by: string | null }>('select status, version, decided_by from public.verification_claims where id = $1', [claimId]))[0]!;
    expect(claim).toMatchObject({ status: 'submitted', version: 2, decided_by: null });
    const decisions = await sql(`select 1 from public.verification_events where claim_id = $1 and event in ('approved','rejected','info_requested')`, [claimId]);
    expect(decisions).toHaveLength(0);
  });

  it('after the race the reviewer can decide the NEW version with the right expected_version', async () => {
    const claimId = (await sql<{ id: string }>(`select id from public.verification_claims where org_id = $1 and claim_type = 'representative_authority'`, [orgId]))[0]!.id;
    const c = await openUserTx(rev2.id, rev2.email, 'aal2');
    try {
      await c.query(`select public.decide_claim($1, 'approve', 'decided on version two', 2)`, [claimId]);
      await c.query('commit');
    } finally {
      await c.end().catch(() => {});
    }
    expect((await sql<{ status: string }>('select status from public.verification_claims where id = $1', [claimId]))[0]!.status).toBe('approved');
  });
});

describe('edit racing a decision', () => {
  it('an approved claim whose facts are edited afterwards becomes stale, with the approval kept in the history', async () => {
    const claimId = (await sql<{ id: string }>(`select id from public.verification_claims where org_id = $1 and claim_type = 'business_registration'`, [orgId]))[0]!.id;
    const edit = await owner.client.rpc('save_business_profile', { p_org: orgId, p_data: { business_name: 'Renamed After Approval Sdn' } });
    expect(edit.error).toBeNull();
    const claim = (await sql<{ status: string }>('select status from public.verification_claims where id = $1', [claimId]))[0]!;
    expect(claim.status).toBe('stale');
    const evs = await sql<{ event: string }>('select event from public.verification_events where claim_id = $1 order by id', [claimId]);
    expect(evs.map((e) => e.event)).toEqual(expect.arrayContaining(['submitted', 'approved', 'marked_stale']));
  });
});

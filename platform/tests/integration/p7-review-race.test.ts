import { afterAll, beforeAll, expect, it } from 'vitest';
import { createConfirmedUser, openUserTx, serviceClient, sql, type TestUser } from './helpers';

// Journey I (review side): two administrators on the same change, an administrator acting while the monitor submits a newer version.

let a: TestUser;
let b: TestUser;
let mitraOrg: string;
let createdMitra = false;
let sourceId: string;
let agencyId: string;

const cand = (amount: string) => ({
  name: 'Race Scheme', info_url: 'https://www.tekun.gov.my/race/', application_status: 'unknown', extraction_status: 'complete',
  funding_type: 'financing', amount_max: amount, currency: 'MYR', rules: [],
});
const submit = (key: string, amount: string) =>
  serviceClient().rpc('gov_submit_candidate', { p_source: sourceId, p_result: null, p_external_key: key, p_candidate: cand(amount) });
const pending = async (key: string) =>
  (await sql<{ id: string }>(`select id from public.gov_change_proposals where source_id = $1 and external_key = $2 and status = 'pending'`, [sourceId, key]))[0]?.id;

beforeAll(async () => {
  a = await createConfirmedUser('govraceA');
  b = await createConfirmedUser('govraceB');
  const existing = await sql<{ id: string }>(`select id from public.organisations where type = 'mitra'`);
  if (existing[0]) mitraOrg = existing[0].id;
  else {
    mitraOrg = (await sql<{ id: string }>(`insert into public.organisations(type,name) values ('mitra','Race MITRA') returning id`))[0]!.id;
    createdMitra = true;
  }
  await sql(`insert into public.memberships(org_id,user_id,role) values ($1,$2,'admin_super'), ($1,$3,'admin_content') on conflict do nothing`, [mitraOrg, a.id, b.id]);
  await sql(`update public.gov_settings set enabled = true where key = 'publishing_enabled'`);
  agencyId = (await sql<{ id: string }>(`insert into public.gov_agencies(code,name,domain) values ('RACE' || upper(substr(md5(random()::text),1,5)),'Race agency','tekun.gov.my') returning id`))[0]!.id;
  sourceId = (await sql<{ id: string }>(`insert into public.gov_sources(agency_id,name,source_type,adapter,allowed_hosts,approved_urls,enabled) values ($1,'Race source','website','tekun','{www.tekun.gov.my}','{https://www.tekun.gov.my/a/}',false) returning id`, [agencyId]))[0]!.id;
});

afterAll(async () => {
  await sql(`delete from public.gov_change_proposals where source_id = $1`, [sourceId]);
  await sql(`update public.gov_settings set enabled = false where key = 'publishing_enabled'`);
  await sql(`alter table public.gov_programme_events disable trigger gov_programme_events_no_change`);
  await sql(`delete from public.gov_programme_events where programme_id in (select id from public.gov_programmes where source_id = $1)`, [sourceId]);
  await sql(`alter table public.gov_programme_events enable trigger gov_programme_events_no_change`);
  await sql(`alter table public.gov_programme_versions disable trigger gov_versions_no_change`);
  try {
    await sql(`update public.gov_programmes set current_version_id = null where source_id = $1`, [sourceId]);
    await sql(`delete from public.gov_programme_versions where programme_id in (select id from public.gov_programmes where source_id = $1)`, [sourceId]);
  } finally {
    await sql(`alter table public.gov_programme_versions enable trigger gov_versions_no_change`);
  }
  await sql(`delete from public.gov_change_proposals where source_id = $1`, [sourceId]);
  await sql(`delete from public.gov_programmes where source_id = $1`, [sourceId]);
  await sql(`delete from public.gov_sources where id = $1`, [sourceId]);
  await sql(`delete from public.gov_agencies where id = $1`, [agencyId]);
  await sql(`delete from public.memberships where org_id = $1 and user_id = any($2)`, [mitraOrg, [a.id, b.id]]);
  if (createdMitra) await sql(`delete from public.organisations where id = $1 and not exists (select 1 from public.memberships where org_id = $1)`, [mitraOrg]);
});

it('two administrators approving the same change: one version, the second is told it was already decided', async () => {
  expect((await submit('race-1', '10000')).data).toBe('queued');
  const id = (await pending('race-1'))!;
  const t1 = await openUserTx(a.id, a.email, 'aal2');
  const t2 = await openUserTx(b.id, b.email, 'aal2');
  try {
    await t1.query(`select public.gov_decide_proposal($1, 'approve', 'first administrator approves')`, [id]);
    let settled = false;
    const second = t2
      .query(`select public.gov_decide_proposal($1, 'approve', 'second administrator approves')`, [id])
      .then(() => ({ ok: true as const }), (e: { code?: string; message?: string }) => ({ ok: false as const, code: e.code, message: e.message }))
      .finally(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 300));
    expect(settled, 'second decision waits on the proposal row').toBe(false);
    await t1.query('commit');
    expect(await second).toEqual({ ok: false, code: 'PT409', message: 'already_decided' });
  } finally {
    await t1.end();
    await t2.query('rollback').catch(() => undefined);
    await t2.end();
  }
  const versions = await sql<{ version_no: number; approved_by: string }>(`select v.version_no, v.approved_by from public.gov_programme_versions v join public.gov_programmes p on p.id = v.programme_id where p.source_id = $1 and p.external_key = 'race-1'`, [sourceId]);
  expect(versions).toHaveLength(1);
  expect(versions[0]!.approved_by).toBe(a.id);
});

it('approve and reject racing: exactly one decision is recorded', async () => {
  await submit('race-2', '20000');
  const id = (await pending('race-2'))!;
  const t1 = await openUserTx(a.id, a.email, 'aal2');
  const t2 = await openUserTx(b.id, b.email, 'aal2');
  try {
    await t1.query(`select public.gov_decide_proposal($1, 'reject', 'not convinced by the evidence')`, [id]);
    const second = t2.query(`select public.gov_decide_proposal($1, 'approve', 'looks right to me')`, [id]).then(() => 'ok', (e: { code?: string }) => e.code);
    await new Promise((r) => setTimeout(r, 300));
    await t1.query('commit');
    expect(await second).toBe('PT409');
  } finally {
    await t1.end();
    await t2.query('rollback').catch(() => undefined);
    await t2.end();
  }
  expect((await sql(`select 1 from public.gov_programmes where source_id = $1 and external_key = 'race-2'`, [sourceId])).length).toBe(0);
  expect((await sql<{ status: string }>(`select status from public.gov_change_proposals where id = $1`, [id]))[0]!.status).toBe('rejected');
});

it('the monitor submits a newer version while an administrator reviews: the old proposal can no longer be approved', async () => {
  await submit('race-3', '30000');
  const old = (await pending('race-3'))!;
  expect((await submit('race-3', '35000')).data).toBe('queued'); // monitor saw a change
  const t1 = await openUserTx(a.id, a.email, 'aal2');
  try {
    await expect(t1.query(`select public.gov_decide_proposal($1, 'approve', 'approving the old one')`, [old])).rejects.toMatchObject({ code: 'PT409', message: 'already_decided' });
  } finally {
    await t1.query('rollback').catch(() => undefined);
    await t1.end();
  }
  expect((await sql<{ status: string }>(`select status from public.gov_change_proposals where id = $1`, [old]))[0]!.status).toBe('superseded');
});

it('a proposal made against an older published version is refused as stale', async () => {
  await submit('race-4', '40000');
  const first = (await pending('race-4'))!;
  const t1 = await openUserTx(a.id, a.email, 'aal2');
  await t1.query(`select public.gov_decide_proposal($1, 'approve', 'first version approved')`, [first]);
  await t1.query('commit');
  await t1.end();
  await submit('race-4', '45000');
  const second = (await pending('race-4'))!;
  // Another path publishes a different version first (here: direct version bump by the database owner), so this proposal's base is stale.
  await sql(`alter table public.gov_programme_versions disable trigger gov_versions_no_change`);
  try {
    await sql(`insert into public.gov_programme_versions(programme_id,version_no,data,data_sha256,detection_method)
      select p.id, 2, '{}'::jsonb, repeat('b',64), 'manual' from public.gov_programmes p where p.source_id = $1 and p.external_key = 'race-4'`, [sourceId]);
    await sql(`update public.gov_programmes set current_version_id = (select id from public.gov_programme_versions where programme_id = gov_programmes.id and version_no = 2) where source_id = $1 and external_key = 'race-4'`, [sourceId]);
  } finally {
    await sql(`alter table public.gov_programme_versions enable trigger gov_versions_no_change`);
  }
  const t2 = await openUserTx(b.id, b.email, 'aal2');
  try {
    await expect(t2.query(`select public.gov_decide_proposal($1, 'approve', 'approving after another change')`, [second])).rejects.toMatchObject({ code: 'PT409', message: 'stale_proposal' });
  } finally {
    await t2.query('rollback').catch(() => undefined);
    await t2.end();
  }
});

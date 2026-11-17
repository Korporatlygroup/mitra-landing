import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runNotificationsOnce, type MailerLike } from '@/server/gov/notify';
import type { GovRpc } from '@/server/gov/worker';
import { createBusinessOrg, createConfirmedUser, serviceClient, signIn, sql, type Signed } from './helpers';

// Journey E: save → published terms change → exactly one notification; repeated worker runs add nothing.
let owner: Signed;
let orgId: string;
let progId: string;
let sourceId: string;

const svcRpc: GovRpc = async (name, args) => {
  const { data, error } = await serviceClient().rpc(name, args ?? {});
  return { data, error: error ? { code: error.code, message: error.message } : null };
};
const deps = (mailer: MailerLike | null) => ({ rpc: svcRpc, mailer, siteUrl: 'http://127.0.0.1:3000' });

beforeAll(async () => {
  await sql(`update public.gov_settings set enabled = true where key = 'notifications_enabled'`);
  owner = await signIn(await createConfirmedUser('govnotify'));
  orgId = await createBusinessOrg(owner);
  const agency = (await sql<{ id: string }>(`insert into public.gov_agencies(code,name,domain) values ('NTF' || upper(substr(md5(random()::text),1,6)),'Notify agency','tekun.gov.my') returning id`))[0]!.id;
  sourceId = (await sql<{ id: string }>(`insert into public.gov_sources(agency_id,name,source_type,adapter,allowed_hosts,approved_urls,enabled) values ($1,'Notify test','website','tekun','{www.tekun.gov.my}','{https://www.tekun.gov.my/a/}',false) returning id`, [agency]))[0]!.id;
  // A published programme version (setup as database owner; approvals have their own tests).
  const cand = { name: 'Notify Scheme', info_url: 'https://www.tekun.gov.my/n/', rules: [], extraction_status: 'complete' };
  progId = (await sql<{ id: string }>(`insert into public.gov_programmes(source_id,agency_id,external_key,slug,publication_state,verification_status,application_status,name,funding_type,last_checked_at,last_verified_at)
    values ($1,$2,'notify',$3,'published','verified','open','Notify Scheme','financing',now(),now()) returning id`, [sourceId, agency, `notify-${Date.now()}`]))[0]!.id;
  await sql(`insert into public.gov_programme_versions(programme_id,version_no,data,data_sha256,detection_method) values ($1,1,$2,repeat('a',64),'manual')`, [progId, JSON.stringify(cand)]);
  await sql(`update public.gov_programmes set current_version_id = (select id from public.gov_programme_versions where programme_id = $1) where id = $1`, [progId]);
  const saved = await owner.client.rpc('gov_save_programme', { p_org: orgId, p_programme: progId });
  expect(saved.error).toBeNull();
});

afterAll(async () => {
  await sql(`update public.gov_settings set enabled = false where key = 'notifications_enabled'`);
  // Append-only tables: the test cleans up as database owner by lifting the guard triggers for the delete only.
  await sql(`alter table public.gov_programme_events disable trigger gov_programme_events_no_change`);
  await sql(`alter table public.gov_programme_versions disable trigger gov_versions_no_change`);
  try {
    await sql(`update public.gov_programmes set current_version_id = null where id = $1`, [progId]);
    await sql(`delete from public.gov_programme_events where programme_id = $1`, [progId]);
    await sql(`delete from public.gov_programme_versions where programme_id = $1`, [progId]);
  } finally {
    await sql(`alter table public.gov_programme_events enable trigger gov_programme_events_no_change`);
    await sql(`alter table public.gov_programme_versions enable trigger gov_versions_no_change`);
  }
  await sql(`delete from public.gov_outbox where programme_id = $1`, [progId]);
  await sql(`delete from public.gov_saved where programme_id = $1`, [progId]);
  await sql(`delete from public.gov_programmes where id = $1`, [progId]);
  await sql(`delete from public.gov_sources where id = $1`, [sourceId]);
  // Only agencies nothing references: an agency left behind by an earlier aborted run may still own sources and must not fail this teardown.
  await sql(`delete from public.gov_agencies a where a.name = 'Notify agency' and not exists (select 1 from public.gov_sources s where s.agency_id = a.id)`);
});

const emit = (kind: string, version: number) => sql(`select private.gov_emit_events($1, $2, $3, '{amount_changed}')`, [progId, version, kind]);
const inApp = () => sql<{ id: string }>(`select id from public.notifications where user_id = $1 and kind like 'gov.%'`, [owner.user.id]);

describe('Journey E: notifications', () => {
  it('a verified change creates exactly one in-app notification, however often workers run', async () => {
    await emit('programme_updated', 2);
    await emit('programme_updated', 2); // duplicate event (retry): same event key
    const a = await runNotificationsOnce(deps(null));
    const b = await runNotificationsOnce(deps(null));
    const c = await runNotificationsOnce(deps(null));
    expect([a.emailJobs, b.emailJobs, c.emailJobs]).toEqual([0, 0, 0]);
    expect(await inApp()).toHaveLength(1);
    const rows = await sql(`select 1 from public.gov_outbox where programme_id = $1 and user_id = $2`, [progId, owner.user.id]);
    expect(rows).toHaveLength(1);
  });

  it('email: only "sent" after the provider accepts; failure retries; no mailer is reported, not hidden', async () => {
    await owner.client.rpc('gov_set_prefs', { p_data: { channel_email: true } });
    await emit('programme_updated', 3);
    // Mail provider down: nothing may be marked sent.
    const down: MailerLike = { send: async () => { throw new Error('smtp down'); } };
    const r1 = await runNotificationsOnce(deps(down));
    expect(r1).toMatchObject({ emailJobs: 1, emailsFailed: 1, emailsAccepted: 0 });
    expect((await sql(`select email_status from public.gov_outbox where programme_id = $1 and version_no = 3`, [progId]))[0]).toMatchObject({ email_status: 'pending' });
    // Not configured at all.
    const r2 = await runNotificationsOnce(deps(null));
    expect(r2.email_unavailable).toBe(true);
    // Recovered: delivered once, with a neutral subject and no business details.
    const sent: { to: string; subject: string; text: string }[] = [];
    const ok: MailerLike = { send: async (m) => { sent.push(m); } };
    const r3 = await runNotificationsOnce(deps(ok));
    expect(r3.emailsAccepted).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe('INOK: an update about business help');
    expect(sent[0]!.subject).not.toMatch(/Notify Scheme/);
    expect(sent[0]!.text).toMatch(/independent platform/);
    const r4 = await runNotificationsOnce(deps(ok));
    expect(r4.emailJobs).toBe(0);
    expect(sent).toHaveLength(1);
    expect((await sql(`select email_status from public.gov_outbox where programme_id = $1 and version_no = 3`, [progId]))[0]).toMatchObject({ email_status: 'sent' });
  });

  it('two overlapping workers deliver one email and one in-app notification (row locks, not luck)', async () => {
    await owner.client.rpc('gov_set_prefs', { p_data: { channel_email: true } });
    const before = (await inApp()).length;
    await emit('programme_updated', 5);
    const sent: { to: string }[] = [];
    // A slow provider keeps the first worker busy while the second one runs.
    const slow: MailerLike = { send: async (m) => { await new Promise((r) => setTimeout(r, 400)); sent.push(m); } };
    const runs = await Promise.all([runNotificationsOnce(deps(slow)), runNotificationsOnce(deps(slow)), runNotificationsOnce(deps(slow))]);
    expect(runs.reduce((n, r) => n + r.emailsAccepted, 0)).toBe(1);
    expect(sent).toHaveLength(1);
    expect((await inApp()).length - before).toBe(1);
    expect((await sql(`select email_status from public.gov_outbox where programme_id = $1 and version_no = 5`, [progId]))[0]).toMatchObject({ email_status: 'sent' });
  });

  it('unsubscribe stops email immediately', async () => {
    await owner.client.rpc('gov_set_prefs', { p_data: { channel_email: false } });
    await emit('programme_updated', 6);
    const sent: unknown[] = [];
    const r = await runNotificationsOnce(deps({ send: async (m) => { sent.push(m); } }));
    expect(r.emailJobs).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

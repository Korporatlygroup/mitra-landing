import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonClient, cleanupUsers, createConfirmedUser, resetBootstrapAfterTest, signIn, sql, uniq, type Signed } from './helpers';

// Migration 230: a programme can be bookmarked by any signed-in person, with no business. Own list only; published programmes only.
let a: Signed;
let b: Signed;
let pub = '';
let hidden = '';

async function programme(state: 'published' | 'hidden', tag: string): Promise<string> {
  const ag = (await sql<{ id: string }>(`insert into public.gov_agencies(code, name, domain) values ($1, 'Fixture', 'example.gov.my') returning id`, [`S${uniq('x').replace(/-/g, '').slice(0, 8).toUpperCase()}`]))[0]!.id;
  const so = (await sql<{ id: string }>(
    `insert into public.gov_sources(agency_id, name, source_type, adapter, allowed_hosts, approved_urls, enabled) values ($1, $2, 'manual', 'manual', '{example.gov.my}', '{}', false) returning id`,
    [ag, `src-${tag}`],
  ))[0]!.id;
  return (await sql<{ id: string }>(
    `insert into public.gov_programmes(source_id, agency_id, external_key, slug, publication_state, verification_status, name, funding_type, last_checked_at)
     values ($1, $2, $3, $4, $5, 'verified', $6, 'financing', now()) returning id`,
    [so, ag, `k-${tag}`, `s-${tag}`.slice(0, 50), state, `Prog ${tag}`],
  ))[0]!.id;
}

beforeAll(async () => {
  a = await signIn(await createConfirmedUser('sv-a'));
  b = await signIn(await createConfirmedUser('sv-b'));
  pub = await programme('published', uniq('p').replace(/-/g, ''));
  hidden = await programme('hidden', uniq('h').replace(/-/g, ''));
});
afterAll(async () => {
  await sql(`delete from public.gov_programmes where id in ($1, $2)`, [pub, hidden]);
  await cleanupUsers();
  await resetBootstrapAfterTest();
});

describe('account-level saved programmes', () => {
  it('saves without any organisation, twice is one row, and lists with the honest status', async () => {
    expect((await a.client.rpc('gov_save_programme_me', { p_programme: pub })).error).toBeNull();
    expect((await a.client.rpc('gov_save_programme_me', { p_programme: pub })).error).toBeNull();
    const l = await a.client.rpc('gov_list_saved_me');
    expect(l.error).toBeNull();
    expect((l.data as { programme_id: string }[]).map((r) => r.programme_id)).toEqual([pub]);
    expect(l.data[0].application_status).toBe('unknown');
  });

  it('a programme that is not published cannot be saved', async () => {
    expect((await a.client.rpc('gov_save_programme_me', { p_programme: hidden })).error?.message ?? '').toContain('not_found');
  });

  it('another person sees an empty list and cannot read or remove someone else\'s bookmark', async () => {
    const l = await b.client.rpc('gov_list_saved_me');
    expect(l.data).toEqual([]);
    const direct = await b.client.from('gov_saved_user').select('*');
    expect(direct.data ?? []).toEqual([]);
    await b.client.rpc('gov_unsave_programme_me', { p_programme: pub });
    expect(((await a.client.rpc('gov_list_saved_me')).data as unknown[]).length).toBe(1);
  });

  it('visitors are refused and nobody can write the table directly', async () => {
    expect((await anonClient().rpc('gov_save_programme_me', { p_programme: pub })).error).not.toBeNull();
    expect((await anonClient().rpc('gov_list_saved_me')).error).not.toBeNull();
    const ins = await a.client.from('gov_saved_user').insert({ user_id: a.user.id, programme_id: hidden });
    expect(ins.error).not.toBeNull();
  });

  it('removing works and the list is empty again', async () => {
    expect((await a.client.rpc('gov_unsave_programme_me', { p_programme: pub })).error).toBeNull();
    expect(((await a.client.rpc('gov_list_saved_me')).data as unknown[]).length).toBe(0);
  });
});

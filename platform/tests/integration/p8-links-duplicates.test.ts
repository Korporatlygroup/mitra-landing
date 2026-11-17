import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonClient, cleanupUsers, createBusinessOrg, createConfirmedUser, resetBootstrapAfterTest, signIn, sql, STD_PROFILE, uniq, type Signed } from './helpers';

// Migration 227: public links and hours on the listing draft/snapshot, duplicate-business flags, requests to join an existing business.

let owner: Signed;
let other: Signed;
let stranger: Signed;
let orgA: string;
let orgB: string;
let slug: string;

const DRAFT = {
  headline: 'Fresh catering for events',
  description: 'We cook and deliver catering for offices, weddings and community events across the Klang Valley.',
  show_phone: false,
  show_email: false,
  services: [{ name: 'Event catering', category_slug: 'food-beverage', nationwide: true, areas: [] }],
};

async function saveDraft(data: Record<string, unknown>) {
  const cur = await sql<{ draft_version: number }>('select draft_version from public.business_listings where org_id = $1', [orgA]);
  return owner.client.rpc('save_listing_draft', { p_org: orgA, p_data: data, p_expected_version: cur[0]?.draft_version ?? 0 });
}

beforeAll(async () => {
  owner = await signIn(await createConfirmedUser('lk-own'));
  other = await signIn(await createConfirmedUser('lk-oth'));
  stranger = await signIn(await createConfirmedUser('lk-str'));
  orgA = await createBusinessOrg(owner, `Kedai Katering ${uniq('a')} Sdn Bhd`);
  // Same registration number on purpose (STD_PROFILE): a legitimate second registration must succeed and only be flagged.
  orgB = await createBusinessOrg(other, `Lain Perniagaan ${uniq('b')}`);
});
afterAll(async () => {
  await cleanupUsers();
  await resetBootstrapAfterTest();
});

describe('public links and hours', () => {
  it('normalises valid links and keeps only what the owner entered', async () => {
    const r = await saveDraft({
      ...DRAFT,
      links: { whatsapp: '012-345 6789', website: 'Kedai-Katering.com.my/about', facebook: 'facebook.com/kedai.katering', instagram: '', youtube: null, google_maps: 'https://maps.app.goo.gl/abc123' },
      hours: 'Mon-Fri 9am-6pm',
    });
    expect(r.error).toBeNull();
    const row = await sql<{ draft: { links: Record<string, string>; hours: string } }>('select draft from public.business_listings where org_id = $1', [orgA]);
    expect(row[0]!.draft.links).toEqual({
      whatsapp: '+60123456789',
      website: 'https://kedai-katering.com.my/about',
      facebook: 'https://facebook.com/kedai.katering',
      google_maps: 'https://maps.app.goo.gl/abc123',
    });
    expect(row[0]!.draft.hours).toBe('Mon-Fri 9am-6pm');
  });

  it.each([
    ['javascript scheme', { website: 'javascript:alert(1)' }, 'invalid_url'],
    ['data scheme', { website: 'data:text/html,x' }, 'invalid_url'],
    ['credentials in the address', { website: 'https://user:pw@evil.example.com' }, 'invalid_url'],
    ['a social link on the wrong site', { facebook: 'https://evil.com/facebook.com' }, 'invalid_url_domain'],
    ['a look-alike host', { instagram: 'https://notinstagram.com/x' }, 'invalid_url_domain'],
    ['an internal address', { website: 'https://10.0.0.1/admin' }, 'invalid_url'],
    ['a markup character', { website: 'https://a.com/x"onload=1' }, 'invalid_url'],
    ['a non-map Google address', { google_maps: 'https://www.google.com/search?q=x' }, 'invalid_url_domain'],
    ['a bad WhatsApp number', { whatsapp: 'call me' }, 'invalid_whatsapp'],
    ['an unknown link type', { twitter: 'https://x.com/a' }, 'invalid_data'],
  ])('refuses %s', async (_n, links, key) => {
    const r = await saveDraft({ ...DRAFT, links });
    expect(r.error?.message ?? '').toContain(key);
  });

  it('publishes the reviewed snapshot; the public read shows links and hours but never an unpublished contact', async () => {
    const r = await saveDraft({
      ...DRAFT,
      public_phone: '+60 3 1111 2222',
      links: { whatsapp: '+60123456789', website: 'kedai-katering.com.my', tiktok: 'https://www.tiktok.com/@kedai' },
      hours: 'Daily 8am-8pm',
    });
    expect(r.error).toBeNull();
    const ver = (await sql<{ draft_version: number }>('select draft_version from public.business_listings where org_id = $1', [orgA]))[0]!.draft_version;
    expect((await owner.client.rpc('submit_listing', { p_org: orgA, p_expected_version: ver })).error).toBeNull();
    // Stand-in for the (MFA-protected) reviewer approval: the same private function review_listing calls.
    await sql(`update public.business_listings set review_status = 'approved' where org_id = $1`, [orgA]);
    await sql(`select private.apply_draft($1, $2)`, [orgA, owner.user.id]);
    slug = (await sql<{ slug: string }>('select slug from public.business_listings where org_id = $1', [orgA]))[0]!.slug;
    const g = await anonClient().rpc('get_listing', { p_slug: slug });
    expect(g.error).toBeNull();
    expect(g.data.links).toEqual({ whatsapp: '+60123456789', website: 'https://kedai-katering.com.my', tiktok: 'https://www.tiktok.com/@kedai' });
    expect(g.data.hours).toBe('Daily 8am-8pm');
    expect(g.data.phone).toBeNull(); // show_phone is false
    expect(JSON.stringify(g.data)).not.toContain('1111 2222');
    expect(JSON.stringify(g.data)).not.toContain('Jalan Satu'); // private address never public
  });

  it('editing the draft after publication does not change what the public sees', async () => {
    const r = await saveDraft({ ...DRAFT, links: { website: 'changed.example.com.my' } });
    expect(r.error).toBeNull();
    const g = await anonClient().rpc('get_listing', { p_slug: slug });
    expect(g.data.links.website).toBe('https://kedai-katering.com.my');
  });
});

describe('duplicate business flags', () => {
  it('a second registration with the same SSM number succeeds and is only flagged for review', async () => {
    const f = await sql<{ reason: string; status: string }>(
      'select reason, status from private.business_duplicate_flags where $1 in (org_id, other_org_id) and $2 in (org_id, other_org_id)',
      [orgA, orgB],
    );
    expect(f.map((x) => x.reason)).toContain('ssm');
    expect(f.every((x) => x.status === 'open')).toBe(true);
    // Nothing merged, nothing removed.
    const orgs = await sql<{ n: string }>('select count(*) n from public.organisations where id in ($1, $2) and status = $3', [orgA, orgB, 'active']);
    expect(orgs[0]!.n).toBe('2');
  });

  it('formatting differences in the SSM number or name still match; unrelated businesses do not', async () => {
    const r = await sql<{ s: string; n: string; short: string | null }>(
      `select private.norm_ssm(' 2020-01-012345 ') s, private.norm_business_name('Kedai  Katering, SDN. BHD.') n, private.norm_business_name('ABC Sdn Bhd') short`,
    );
    expect(r[0]).toEqual({ s: '202001012345', n: 'kedai katering', short: null });
  });

  it('ordinary users cannot read or decide flags', async () => {
    expect((await owner.client.rpc('list_duplicate_flags', { p_status: 'open' })).error?.message ?? '').toContain('forbidden');
    const flag = (await sql<{ id: string }>('select id from private.business_duplicate_flags limit 1'))[0]!.id;
    expect((await owner.client.rpc('resolve_duplicate_flag', { p_flag: flag, p_decision: 'confirm', p_note: 'looks the same' })).error?.message ?? '').toContain('forbidden');
    expect((await anonClient().rpc('list_duplicate_flags', { p_status: 'open' })).error).not.toBeNull();
  });

  it('the registrant is only told about PUBLISHED businesses, and only public facts', async () => {
    const r = await other.client.rpc('find_published_duplicates', { p_ssm: STD_PROFILE.ssm_number, p_name: 'whatever' });
    expect(r.error).toBeNull();
    const hit = (r.data as { slug: string; name: string; reason: string }[]).find((x) => x.slug === slug);
    expect(hit?.reason).toBe('ssm');
    expect(Object.keys(hit!).sort()).toEqual(['name', 'reason', 'slug']);
    // The owner of that business is not told about their own business.
    const own = await owner.client.rpc('find_published_duplicates', { p_ssm: STD_PROFILE.ssm_number, p_name: null });
    expect((own.data as { slug: string }[]).some((x) => x.slug === slug)).toBe(false);
    expect((await anonClient().rpc('find_published_duplicates', { p_ssm: '1', p_name: 'x' })).error).not.toBeNull();
  });
});

describe('request to join an existing business', () => {
  let requestId: string;

  it('a signed-in person with a confirmed email can ask; the owners are notified; nothing is granted', async () => {
    const r = await stranger.client.rpc('request_org_membership', { p_slug: slug, p_message: 'I run the kitchen there.' });
    expect(r.error).toBeNull();
    requestId = r.data as string;
    const m = await sql<{ n: string }>(`select count(*) n from public.memberships where org_id = $1 and user_id = $2`, [orgA, stranger.user.id]);
    expect(m[0]!.n).toBe('0');
    const n = await sql<{ n: string }>(`select count(*) n from public.notifications where user_id = $1 and kind = 'join.requested' and entity_id = $2`, [owner.user.id, requestId]);
    expect(n[0]!.n).toBe('1');
  });

  it('asking twice, asking as a member, or asking for an unpublished or unknown business is refused', async () => {
    expect((await stranger.client.rpc('request_org_membership', { p_slug: slug, p_message: null })).error?.message ?? '').toContain('request_pending');
    expect((await owner.client.rpc('request_org_membership', { p_slug: slug, p_message: null })).error?.message ?? '').toContain('already_member');
    expect((await stranger.client.rpc('request_org_membership', { p_slug: 'no-such-business', p_message: null })).error?.message ?? '').toContain('not_found');
    expect((await anonClient().rpc('request_org_membership', { p_slug: slug, p_message: null })).error).not.toBeNull();
  });

  it('only people who may invite members can read and resolve requests', async () => {
    const own = await owner.client.rpc('list_join_requests', { p_org: orgA });
    expect(own.error).toBeNull();
    expect((own.data as { id: string; requester_email: string }[]).map((x) => x.id)).toContain(requestId);
    expect((await stranger.client.rpc('list_join_requests', { p_org: orgA })).error?.message ?? '').toContain('forbidden');
    expect((await other.client.rpc('list_join_requests', { p_org: orgA })).error?.message ?? '').toContain('forbidden');
    expect((await other.client.rpc('resolve_join_request', { p_request: requestId, p_decision: 'declined' })).error?.message ?? '').toContain('forbidden');
    expect((await owner.client.rpc('resolve_join_request', { p_request: requestId, p_decision: 'invited' })).error).toBeNull();
    expect((await owner.client.rpc('resolve_join_request', { p_request: requestId, p_decision: 'declined' })).error?.message ?? '').toContain('already_decided');
  });

  it('the table is readable only for your own requests (or as someone who may invite members) and never writable by users', async () => {
    const read = await stranger.client.from('org_join_requests').select('user_id');
    expect(read.error).toBeNull();
    expect((read.data ?? []).every((r) => r.user_id === stranger.user.id)).toBe(true);
    const seen = await other.client.from('org_join_requests').select('id').eq('org_id', orgA);
    expect(seen.data ?? []).toHaveLength(0); // a member of another business sees nothing
    expect((await anonClient().from('org_join_requests').select('id')).error).not.toBeNull();
    const ins = await stranger.client.from('org_join_requests').insert({ org_id: orgA, user_id: stranger.user.id, requester_email: 'x@example.test' });
    expect(ins.error).not.toBeNull();
  });
});

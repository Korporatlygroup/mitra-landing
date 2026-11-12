import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonClient, cleanupUsers, createConfirmedUser, signIn, sql, uniq, type Signed } from './helpers';

// Phase 3 over the real PostgREST HTTP API. PTnnn errors become HTTP nnn; 42501 becomes 401 (anon) or 403.

let buyer: Signed;
let seller: Signed;
let stranger: Signed;
let buyerOrg: string;
let sellerOrg: string;
let requestId: string;
const tag = uniq('p3h').replace(/-/g, '');

beforeAll(async () => {
  buyer = await signIn(await createConfirmedUser('p3buy'));
  seller = await signIn(await createConfirmedUser('p3sel'));
  stranger = await signIn(await createConfirmedUser('p3str'));
  buyerOrg = (await buyer.client.rpc('create_org', { p_type: 'buyer', p_name: `Buyer ${tag}` })).data;
  sellerOrg = (await seller.client.rpc('create_org', { p_type: 'business', p_name: `Seller ${tag}` })).data;
  const prof = await seller.client.rpc('save_business_profile', {
    p_org: sellerOrg,
    p_data: { business_name: `Printer ${tag}`, category_slug: 'professional-services', registration_status: 'unregistered', state: 'Perak', district: 'Ipoh' },
  });
  expect(prof.error).toBeNull();
  const d = await buyer.client.rpc('save_request_draft', {
    p_org: buyerOrg,
    p_request: null,
    p_key: `key-${tag}`,
    p_data: { title: `Print 500 flyers ${tag}`, category_slug: 'professional-services', description: 'Full colour A5 flyers for a shop opening next month.', target_state: 'Perak', contact_email: 'buyer@example.test' },
    p_expected_version: 0,
  });
  expect(d.error).toBeNull();
  requestId = d.data.id;
});

afterAll(async () => {
  await sql(`delete from public.organisations where id = any($1::uuid[])`, [[buyerOrg, sellerOrg]]);
  await cleanupUsers();
});

describe('anonymous access', () => {
  it('can search and read published listings only through the two public functions', async () => {
    const anon = anonClient();
    const r = await anon.rpc('search_listings', { p_q: `no-such-${tag}`, p_category: null, p_state: null, p_limit: 5, p_offset: 0 });
    expect(r.error).toBeNull();
    expect(r.data.total).toBe(0);
    expect(Array.isArray(r.data.categories)).toBe(true);
    const missing = await anon.rpc('get_listing', { p_slug: 'does-not-exist-123' });
    expect(missing.error?.code).toBe('PT404');
  });

  it('cannot call anything else, and cannot read any Phase 3 table', async () => {
    const anon = anonClient();
    for (const [fn, args] of [
      ['save_listing_draft', { p_org: sellerOrg, p_data: {}, p_expected_version: 0 }],
      ['submit_request', { p_request: requestId, p_expected_version: 1 }],
      ['respond_to_invitation', { p_request: requestId, p_seller_org: sellerOrg, p_response: 'interested', p_note: null }],
      ['report_content', { p_type: 'listing', p_target: 'abc-def', p_reason: 'spam', p_note: null }],
      ['enquiry_parties', { p_enquiry: requestId }],
    ] as const) {
      const r = await anon.rpc(fn, args as Record<string, unknown>);
      expect(r.error, fn).not.toBeNull();
      expect([401, 403], fn).toContain(r.status);
    }
    for (const table of ['business_listings', 'buyer_requests', 'buyer_request_private', 'request_seller_matches', 'enquiries', 'content_reports', 'listing_events']) {
      const r = await anon.from(table).select('*').limit(1);
      expect(r.error, table).not.toBeNull();
      expect([401, 403], table).toContain(r.status);
    }
  });

  it('a hostile search string is treated as plain text', async () => {
    const anon = anonClient();
    for (const q of ["'; drop table public.business_listings; --", '%', '_', '\\', 'a'.repeat(200)]) {
      const r = await anon.rpc('search_listings', { p_q: q, p_category: null, p_state: null, p_limit: 5, p_offset: 0 });
      if (q.length > 80) expect(r.error?.code).toBe('PT422');
      else {
        expect(r.error).toBeNull();
        expect(r.data.total).toBe(0);
      }
    }
    expect((await anon.rpc('search_listings', { p_q: null, p_category: "x'; --", p_state: null, p_limit: 5, p_offset: 0 })).error?.code).toBe('PT422');
    expect((await anon.rpc('search_listings', { p_q: null, p_category: null, p_state: 'Atlantis', p_limit: 5, p_offset: 0 })).error?.code).toBe('PT422');
  });
});

describe('request privacy over HTTP', () => {
  it('a stranger and an uninvited seller cannot read, invite for, end or submit the buyer\'s request', async () => {
    for (const who of [stranger, seller]) {
      const rows = await who.client.from('buyer_requests').select('id').eq('id', requestId);
      expect(rows.data ?? []).toEqual([]);
      const contact = await who.client.from('buyer_request_private').select('contact_email').eq('request_id', requestId);
      expect(contact.data ?? []).toEqual([]);
      expect((await who.client.rpc('submit_request', { p_request: requestId, p_expected_version: 1 })).status).toBe(404);
      expect((await who.client.rpc('end_request', { p_request: requestId, p_status: 'withdrawn', p_reason: null })).status).toBe(404);
      expect((await who.client.rpc('list_request_matches', { p_request: requestId })).status).toBe(404);
    }
    const asSeller = await seller.client.rpc('get_request_for_seller', { p_request: requestId, p_seller_org: sellerOrg });
    expect(asSeller.status).toBe(404);
    const forged = await stranger.client.rpc('get_request_for_seller', { p_request: requestId, p_seller_org: sellerOrg });
    expect(forged.status).toBe(403);
  });

  it('the draft can be submitted by its owner only once, and stays retry-safe', async () => {
    const first = await buyer.client.rpc('submit_request', { p_request: requestId, p_expected_version: 1 });
    expect(first.error).toBeNull();
    expect(first.data.status).toBe('open');
    const again = await buyer.client.rpc('submit_request', { p_request: requestId, p_expected_version: 1 });
    expect(again.error).toBeNull();
    expect(again.data.status).toBe('open');
    const stale = await buyer.client.rpc('save_request_draft', { p_org: buyerOrg, p_request: requestId, p_key: null, p_data: { title: 'Changed after sending' }, p_expected_version: 2 });
    expect(stale.error?.code).toBe('PT409');
  });

  it('direct writes to the Phase 3 tables are refused for authenticated users', async () => {
    const w1 = await buyer.client.from('buyer_requests').update({ status: 'closed' }).eq('id', requestId);
    expect(w1.error).not.toBeNull();
    const w2 = await buyer.client.from('enquiries').insert({ buyer_org_id: buyerOrg, seller_org_id: sellerOrg, origin: 'listing', topic: 'forged', opened_by_org_id: buyerOrg, created_by: buyer.user.id });
    expect(w2.error).not.toBeNull();
    const w3 = await seller.client.from('business_listings').insert({ org_id: sellerOrg });
    expect(w3.error).not.toBeNull();
    const status = (await sql(`select status::text from public.buyer_requests where id = $1`, [requestId]))[0]!.status;
    expect(status).toBe('open');
  });
});

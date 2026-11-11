import { beforeAll, expect, it } from 'vitest';
import { createBusinessOrg, createConfirmedUser, openUserTx, signIn, sql, type Signed } from './helpers';

let buyer: Signed;
let seller: Signed;
let buyerOrg: string;
let sellerOrg: string;
let quoteId: string;

beforeAll(async () => {
  buyer = await signIn(await createConfirmedUser('p4racebuyer'));
  seller = await signIn(await createConfirmedUser('p4raceseller'));
  buyerOrg = (await buyer.client.rpc('create_org', { p_type: 'buyer', p_name: `Race buyer ${buyer.user.id.slice(0,8)}` })).data;
  sellerOrg = await createBusinessOrg(seller);
  const enquiryId = (await sql<{ id: string }>(
    `insert into public.enquiries(buyer_org_id,seller_org_id,origin,topic,opened_by_org_id,created_by)
     values($1,$2,'listing','Synthetic concurrent quotation',$1,$3) returning id`, [buyerOrg,sellerOrg,buyer.user.id],
  ))[0]!.id;
  const draft = { currency: 'MYR', scope: '100 synthetic items', tax_treatment: 'Tax included', delivery_timing: 'Within 30 days',
    valid_until: new Date(Date.now()+7*86_400_000).toISOString(), delivery_fee: '0.00', tax_amount: '0.00',
    lines: [{ description: 'Synthetic items', quantity: '100', unit: 'pieces', unit_price: '12.50' }] };
  const saved = await seller.client.rpc('save_quote_draft', { p_enquiry: enquiryId, p_draft: draft, p_expected_version: 0 });
  expect(saved.error).toBeNull();
  quoteId = saved.data;
});

it('serializes simultaneous sends so one immutable version wins', async () => {
  const a = await openUserTx(seller.user.id,seller.user.email);
  const b = await openUserTx(seller.user.id,seller.user.email);
  try {
    await a.query('select public.send_quote_version($1,0)', [quoteId]);
    let settled = false;
    const second = b.query('select public.send_quote_version($1,0)', [quoteId])
      .then(() => ({ ok: true as const }), (error: { code?: string }) => ({ ok: false as const, code: error.code }))
      .finally(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve,300));
    expect(settled, 'second send waits on the quotation row').toBe(false);
    await a.query('commit');
    const result = await second;
    expect(result).toEqual({ ok: false, code: 'PT409' });
    await b.query('rollback');
    const versions = await sql<{ count: string }>('select count(*)::text from public.quotation_versions where quotation_id=$1', [quoteId]);
    expect(Number(versions[0]!.count)).toBe(1);
  } finally {
    await a.end().catch(() => {});
    await b.end().catch(() => {});
  }
});

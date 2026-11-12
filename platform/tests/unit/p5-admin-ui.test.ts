import { describe, expect, it } from 'vitest';
import { countChanged, diffProductData, humanDuration, pageLinks, parseOffset, percent, tierLine, variantLine } from '@/components/admin-catalogue/helpers';
import { messagesFor } from '@/i18n/messages';
import { productDecisionSchema, supplierDecisionSchema } from '@/lib/schemas';
import { buildPartnerInviteEmail } from '@/server/partner-invite-email';
import type { ProductData } from '@/server/services/p5-types';

const base: ProductData = {
  sku: 'SKU-1',
  name: 'Brass lamp',
  description: 'A brass lamp.',
  category_slug: 'religious-items-puja',
  unit: 'piece',
  moq: 10,
  currency: 'INR',
  price_mode: 'tiers',
  tiers: [
    { min_qty: 10, max_qty: 99, unit_price: '250.00' },
    { min_qty: 100, max_qty: null, unit_price: '210.00' },
  ],
  variants: [{ sku: 'SKU-1-S', label: 'Small', attributes: { size: 'S' } }],
  specs: { weight: '1 kg', material: 'brass' },
  availability_status: 'available',
  availability_confirmed_on: '2026-10-01',
  price_confirmed_on: '2026-10-01',
};

describe('diffProductData', () => {
  it('reports no change for identical revisions', () => {
    const rows = diffProductData(base, structuredClone(base));
    expect(rows.length).toBeGreaterThan(0);
    expect(countChanged(rows)).toBe(0);
  });

  it('flags a changed price tier line, MOQ and text, and nothing else', () => {
    const next: ProductData = {
      ...structuredClone(base),
      moq: 20,
      description: 'A larger brass lamp.',
      tiers: [
        { min_qty: 20, max_qty: 99, unit_price: '260.00' },
        { min_qty: 100, max_qty: null, unit_price: '210.00' },
      ],
    };
    const rows = diffProductData(base, next);
    expect(rows.filter((r) => r.changed).map((r) => r.field)).toEqual(['description', 'moq', 'tiers']);
    const tiers = rows.find((r) => r.field === 'tiers')!;
    expect(tiers.before).toEqual(['10-99 @ 250.00', '100+ @ 210.00']);
    expect(tiers.after).toEqual(['20-99 @ 260.00', '100+ @ 210.00']);
  });

  it('treats a first submission (no live revision) as all new', () => {
    const rows = diffProductData(null, base);
    expect(rows.every((r) => r.changed && r.before.length === 0)).toBe(true);
    expect(rows.map((r) => r.field)).toContain('tiers');
  });

  it('detects added and removed variants and specs, ignoring key order', () => {
    const next: ProductData = { ...structuredClone(base), variants: [], specs: { material: 'brass', weight: '1 kg', colour: 'gold' } };
    const rows = diffProductData(base, next);
    const changed = rows.filter((r) => r.changed).map((r) => r.field);
    expect(changed).toEqual(['variants', 'specs']);
    expect(rows.find((r) => r.field === 'variants')!.after).toEqual([]);
    expect(rows.find((r) => r.field === 'specs')!.after).toEqual(['colour: gold', 'material: brass', 'weight: 1 kg']);
  });

  it('skips fields that are empty on both sides', () => {
    const rows = diffProductData({ name: 'A' }, { name: 'B' });
    expect(rows.map((r) => r.field)).toEqual(['name']);
  });

  it('formats tier and variant lines', () => {
    expect(tierLine({ min_qty: 1, max_qty: 9, unit_price: '5.00', variant_sku: 'X' })).toBe('1-9 @ 5.00 [X]');
    expect(variantLine({ sku: 'A', label: 'Red', attributes: { b: '2', a: '1' }, moq: 5 })).toBe('A - Red (a: 1, b: 2) / MOQ 5');
  });
});

describe('number helpers', () => {
  it('humanDuration picks a readable unit', () => {
    expect(humanDuration(10)).toEqual({ unit: 'minutes', value: 1 });
    expect(humanDuration(5400)).toEqual({ unit: 'hours', value: 2 });
    expect(humanDuration(3 * 86400)).toEqual({ unit: 'days', value: 3 });
  });

  it('percent never shows a partial rate as 0 or 100', () => {
    expect(percent(0)).toBe(0);
    expect(percent(1)).toBe(100);
    expect(percent(0.8333)).toBe(83);
    expect(percent(0.001)).toBe(1);
    expect(percent(0.999)).toBe(99);
  });

  it('pageLinks and parseOffset', () => {
    expect(pageLinks(0, 0)).toEqual({ prev: null, next: null, from: 0, to: 0 });
    expect(pageLinks(0, 60)).toEqual({ prev: null, next: 25, from: 1, to: 25 });
    expect(pageLinks(50, 60)).toEqual({ prev: 25, next: null, from: 51, to: 60 });
    expect(parseOffset('25')).toBe(25);
    expect(parseOffset('-3')).toBe(0);
    expect(parseOffset('abc')).toBe(0);
    expect(parseOffset(undefined)).toBe(0);
  });
});

describe('admin decision schemas (shared with the forms)', () => {
  const uuid = '3f2b8c1e-5a7d-4e0b-9c1a-2d4f6a8b0c1e';
  it('approving a supplier needs 1 to 6 distinct checks and no reason', () => {
    const ok = supplierDecisionSchema.safeParse({ locale: 'en', supplierId: uuid, decision: 'approve', checks: ['contact_reachable'], expectedVersion: '2' });
    expect(ok.success).toBe(true);
    expect(supplierDecisionSchema.safeParse({ locale: 'en', supplierId: uuid, decision: 'approve', checks: [], expectedVersion: '2' }).success).toBe(false);
    expect(supplierDecisionSchema.safeParse({ locale: 'en', supplierId: uuid, decision: 'approve', checks: ['contact_reachable', 'contact_reachable'], expectedVersion: '2' }).success).toBe(false);
  });
  it('reject and request-info need a reason of at least 5 characters', () => {
    for (const decision of ['reject', 'request_info']) {
      expect(supplierDecisionSchema.safeParse({ locale: 'en', supplierId: uuid, decision, reason: 'no', expectedVersion: '1' }).success).toBe(false);
      expect(supplierDecisionSchema.safeParse({ locale: 'en', supplierId: uuid, decision, reason: 'Missing registration document', expectedVersion: '1' }).success).toBe(true);
    }
    expect(productDecisionSchema.safeParse({ locale: 'en', productId: uuid, decision: 'reject', reason: '', expectedVersion: '1' }).success).toBe(false);
    expect(productDecisionSchema.safeParse({ locale: 'en', productId: uuid, decision: 'approve', expectedVersion: '1' }).success).toBe(true);
  });
});

describe('partner owner invitation email', () => {
  const token = 'a'.repeat(64);
  it('links to the partner invitation page and is trilingual', () => {
    const m = buildPartnerInviteEmail({ to: 'owner@example.test', orgName: 'Chennai Traders', siteUrl: 'http://127.0.0.1:3503', locale: 'en', token });
    expect(m.text).toContain(`http://127.0.0.1:3503/en/invite/partner/${token}`);
    expect(m.subject).not.toContain(token);
    expect(m.text).toContain('Chennai Traders');
    expect(m.text).toMatch(/[஀-௿]/);
  });
  it('refuses a recipient with header characters', () => {
    expect(() => buildPartnerInviteEmail({ to: 'a@example.test\nBcc: x@example.test', orgName: 'X', siteUrl: 'http://127.0.0.1:3503', locale: 'en', token })).toThrow();
  });
});

describe('p5admin messages', () => {
  const flat = (o: unknown, p = ''): string[] =>
    typeof o === 'object' && o !== null ? Object.entries(o).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p];
  it('every key used by the screens exists in all three languages', () => {
    const en = flat((messagesFor('en') as Record<string, unknown>).p5admin).sort();
    for (const l of ['ta', 'ms'] as const) {
      expect(flat((messagesFor(l) as Record<string, unknown>).p5admin).sort()).toEqual(en);
    }
    expect(en.length).toBeGreaterThan(250);
  });
  it('has a success message for every action outcome', () => {
    const m = (messagesFor('en') as { p5admin: { messages: Record<string, string> } }).p5admin.messages;
    for (const k of ['partnerProvisioned', 'partnerResent', 'partnerApproved', 'partnerSuspended', 'supplierApproved', 'supplierRejected', 'supplierInfoRequested', 'supplierSuspended', 'supplierReinstated', 'productApproved', 'productRejected', 'productChangesRequested', 'productSuspended', 'productReinstated', 'reportDismissed', 'reportActioned']) {
      expect(m[k], k).toBeTruthy();
    }
  });
});

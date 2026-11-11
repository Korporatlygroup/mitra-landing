import { describe, expect, it } from 'vitest';
import { evaluateSupplierMatch, rankSupplierMatches, type MatchCandidate, type MatchNeed } from '@/lib/p6-matching';

const asOf = '2026-11-11';
const need: MatchNeed = {
  categorySlug: 'packaging', quantity: '1000.000', unit: 'pieces', requiredBy: '2027-01-01',
  destinationCountry: 'MY', specificationTerms: ['food-safe', 'recyclable'],
  requiredCertificates: ['ISO 22000'],
};
const candidate: MatchCandidate = {
  supplierId: 'supplier-a', productId: 'product-a', supplierStatus: 'approved',
  partnerStatus: 'approved', partnerOrgActive: true, productStatus: 'published',
  categorySlug: 'packaging', unit: 'pieces', moq: '1000', leadTimeMinDays: 21, leadTimeMaxDays: 28,
  availability: 'made_to_order', availabilityConfirmedOn: '2026-10-30',
  specificationTerms: ['food-safe', 'recyclable'], exportCountries: ['MY'],
  evidencedCertificates: null,
};

describe('Phase 6 deterministic supplier matching', () => {
  it('filters approvals and visibility before ranking', () => {
    const result = evaluateSupplierMatch(need, { ...candidate, supplierStatus: 'other', productStatus: 'other' }, asOf);
    expect(result.eligible).toBe(false);
    expect(result.exclusions).toEqual(['supplier_not_approved', 'product_not_published']);
    expect(result.score).toBeNull();
  });

  it('compares decimal quantities exactly and excludes below-MOQ requests', () => {
    expect(evaluateSupplierMatch({ ...need, quantity: '999.999' }, candidate, asOf).exclusions).toContain('below_moq');
    expect(evaluateSupplierMatch(need, candidate, asOf).eligible).toBe(true);
    expect(() => evaluateSupplierMatch({ ...need, quantity: '1,000' }, candidate, asOf)).toThrow('invalid_quantity');
  });

  it('treats undeclared export and certificate evidence as unknown', () => {
    const result = evaluateSupplierMatch(need, { ...candidate, exportCountries: null }, asOf);
    expect(result.eligible).toBe(true);
    expect(result.unknown).toContain('export_capability');
    expect(result.unknown).toContain('certifications');
    expect(result.score).toBeNull();
    expect(result.evidenceCoverage).toBeLessThan(100);
    expect(result.reasons.join(' ')).not.toMatch(/guaranteed|trusted|verified/i);
  });

  it('excludes a declared unsupported destination and incompatible lead time', () => {
    const result = evaluateSupplierMatch(need, { ...candidate, exportCountries: ['SG'], leadTimeMinDays: 90 }, asOf);
    expect(result.exclusions).toEqual(['destination_not_supported', 'lead_time_incompatible']);
  });

  it('does not produce a numeric score from only one comparable factor', () => {
    const result = evaluateSupplierMatch(
      { categorySlug: 'packaging', quantity: '1', unit: 'pieces' },
      { ...candidate, moq: null, availabilityConfirmedOn: null, specificationTerms: [], exportCountries: null }, asOf);
    expect(result.eligible).toBe(true);
    expect(result.score).toBeNull();
    expect(result.unknown).toContain('moq');
  });

  it('reports stale availability and exact specification matches', () => {
    const result = evaluateSupplierMatch(need, {
      ...candidate, availabilityConfirmedOn: '2026-01-01', specificationTerms: ['food-safe'],
      evidencedCertificates: ['ISO 22000'],
    }, asOf);
    expect(result.eligible).toBe(true);
    expect(result.score).toBeLessThan(100);
    expect(result.reasons).toContain('1 of 2 requested specification terms matched exactly');
  });

  it('never compares MOQ across unlike units', () => {
    const result = evaluateSupplierMatch(need, { ...candidate, unit: 'kg' }, asOf);
    expect(result.exclusions).toContain('unit_mismatch');
    expect(result.score).toBeNull();
    expect(result.reasons).not.toContain('Declared minimum order quantity is compatible');
  });

  it('excludes unknown units without crediting a numeric MOQ', () => {
    const result = evaluateSupplierMatch(need, { ...candidate, unit: null }, asOf);
    expect(result.eligible).toBe(false);
    expect(result.exclusions).toContain('unit_unknown');
    expect(result.unknown).toContain('moq');
    expect(result.reasons).not.toContain('Declared minimum order quantity is compatible');
  });

  it('does not credit a date without an availability declaration', () => {
    const result = evaluateSupplierMatch(need, { ...candidate, availability: null }, asOf);
    expect(result.unknown).toContain('availability_recency');
    expect(result.reasons).not.toContain('Availability was declared within 90 days');
  });

  it('rejects impossible calendar dates as evidence for lead-time fit', () => {
    const result = evaluateSupplierMatch({ ...need, requiredBy: '2027-02-30' }, candidate, asOf);
    expect(result.unknown).toContain('lead_time');
    expect(result.score).toBeNull();
  });

  it('does not promise a deadline inside the declared lead-time range', () => {
    const result = evaluateSupplierMatch(
      { ...need, requiredBy: '2026-12-11' },
      { ...candidate, leadTimeMinDays: 21, leadTimeMaxDays: 90 }, asOf);
    expect(result.unknown).toContain('lead_time');
    expect(result.score).toBeNull();
    expect(result.reasons).not.toContain('Declared lead-time range fits the requested date');
  });

  it('orders eligible matches first with deterministic tie breaks', () => {
    const good = evaluateSupplierMatch(need, candidate, asOf);
    const second = evaluateSupplierMatch(need, { ...candidate, supplierId: 'supplier-b' }, asOf);
    const excluded = evaluateSupplierMatch(need, { ...candidate, supplierId: 'supplier-c', productStatus: 'other' }, asOf);
    expect(rankSupplierMatches([excluded, second, good]).map((r) => r.supplierId)).toEqual([
      'supplier-a', 'supplier-b', 'supplier-c',
    ]);
  });
});

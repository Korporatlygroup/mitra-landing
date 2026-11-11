/** Deterministic Phase 6 matching kernel. It reads only caller-supplied, authorized snapshots.
 * Database visibility and approval checks must be repeated by the eventual SQL/RPC adapter. */

export interface MatchNeed {
  categorySlug: string;
  quantity: string;
  requiredBy?: string | null; // ISO date
  destinationCountry?: string | null;
  specificationTerms?: string[];
  requiredCertificates?: string[];
}

export interface MatchCandidate {
  supplierId: string;
  productId: string;
  supplierStatus: 'approved' | 'other';
  partnerStatus: 'approved' | 'other';
  partnerOrgActive: boolean;
  productStatus: 'published' | 'other';
  categorySlug: string;
  moq: string | null;
  leadTimeMinDays: number | null;
  availability: 'available' | 'made_to_order' | 'limited' | 'unavailable' | null;
  availabilityConfirmedOn: string | null;
  specificationTerms: string[];
  exportCountries: string[] | null;
  /** Product-specific certificate evidence, absent in Phase 5 v0.2. Do not infer from review_checks. */
  evidencedCertificates: string[] | null;
}

export type Exclusion = 'supplier_not_approved' | 'partner_not_approved' | 'partner_inactive' |
  'product_not_published' | 'category_mismatch' | 'below_moq' | 'unavailable' |
  'destination_not_supported' | 'lead_time_incompatible';
export type Unknown = 'moq' | 'lead_time' | 'availability_recency' | 'specifications' |
  'export_capability' | 'certifications';

export interface MatchResult {
  supplierId: string;
  productId: string;
  eligible: boolean;
  exclusions: Exclusion[];
  unknown: Unknown[];
  reasons: string[];
  /** Suitability from comparable declared fields; null when evidence is too sparse. */
  score: number | null;
  matchedFactors: number;
}

export interface MatchWeights {
  category: number;
  moq: number;
  leadTime: number;
  availabilityRecency: number;
  specifications: number;
  exportCapability: number;
  certificates: number;
}

export const DEFAULT_MATCH_WEIGHTS: Readonly<MatchWeights> = Object.freeze({
  category: 25, moq: 15, leadTime: 20, availabilityRecency: 10,
  specifications: 10, exportCapability: 10, certificates: 10,
});

/** Exact decimal quantity comparison, never Number() or floating-point arithmetic. */
function quantityMilli(value: string): bigint | null {
  const match = /^(0|[1-9]\d{0,10})(?:\.(\d{1,3}))?$/.exec(value);
  if (!match) return null;
  return BigInt(match[1]!) * 1000n + BigInt((match[2] ?? '').padEnd(3, '0'));
}

function terms(values: string[]): Set<string> {
  return new Set(values.map((v) => v.normalize('NFKC').trim().toLocaleLowerCase('en'))
    .filter((v) => /^[\p{L}\p{N}][\p{L}\p{N} ._/-]{0,79}$/u.test(v)));
}

function wholeDays(from: string, to: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const a = Date.parse(from + 'T00:00:00Z'), b = Date.parse(to + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((b - a) / 86_400_000);
}

export function evaluateSupplierMatch(
  need: MatchNeed, candidate: MatchCandidate, asOf: string,
  weights: Readonly<MatchWeights> = DEFAULT_MATCH_WEIGHTS,
): MatchResult {
  const exclusions: Exclusion[] = [], unknown: Unknown[] = [], reasons: string[] = [];
  const requestedQty = quantityMilli(need.quantity);
  if (requestedQty === null || requestedQty <= 0n) throw new Error('invalid_quantity');
  if (candidate.supplierStatus !== 'approved') exclusions.push('supplier_not_approved');
  if (candidate.partnerStatus !== 'approved') exclusions.push('partner_not_approved');
  if (!candidate.partnerOrgActive) exclusions.push('partner_inactive');
  if (candidate.productStatus !== 'published') exclusions.push('product_not_published');
  if (candidate.categorySlug !== need.categorySlug) exclusions.push('category_mismatch');
  if (candidate.availability === 'unavailable') exclusions.push('unavailable');

  const moq = candidate.moq === null ? null : quantityMilli(candidate.moq);
  if (moq === null) unknown.push('moq');
  else if (requestedQty < moq) exclusions.push('below_moq');
  else reasons.push('Declared minimum order quantity is compatible');

  const destination = need.destinationCountry?.trim().toUpperCase();
  if (destination) {
    if (candidate.exportCountries === null) unknown.push('export_capability');
    else if (!candidate.exportCountries.map((c) => c.toUpperCase()).includes(destination)) exclusions.push('destination_not_supported');
    else reasons.push('Declared destination is supported');
  }
  const days = need.requiredBy ? wholeDays(asOf, need.requiredBy) : null;
  if (need.requiredBy) {
    if (days === null || candidate.leadTimeMinDays === null) unknown.push('lead_time');
    else if (candidate.leadTimeMinDays > days) exclusions.push('lead_time_incompatible');
    else reasons.push('Declared minimum lead time fits the requested date');
  }

  if (exclusions.length) return {
    supplierId: candidate.supplierId, productId: candidate.productId, eligible: false,
    exclusions, unknown, reasons, score: null, matchedFactors: 0,
  };

  let earned = weights.category, possible = weights.category, matchedFactors = 1;
  reasons.unshift('Published product category matches');
  if (moq !== null) { possible += weights.moq; earned += weights.moq; matchedFactors++; }
  if (need.requiredBy && days !== null && candidate.leadTimeMinDays !== null) {
    possible += weights.leadTime; earned += weights.leadTime; matchedFactors++;
  }
  if (destination && candidate.exportCountries !== null) {
    possible += weights.exportCapability; earned += weights.exportCapability; matchedFactors++;
  }
  if (candidate.availabilityConfirmedOn === null || wholeDays(candidate.availabilityConfirmedOn, asOf) === null) {
    unknown.push('availability_recency');
  } else {
    possible += weights.availabilityRecency;
    const age = wholeDays(candidate.availabilityConfirmedOn, asOf)!;
    if (age <= 90 && age >= 0) {
      earned += weights.availabilityRecency;
      reasons.push('Availability was declared within 90 days');
    } else reasons.push('Availability declaration is older than 90 days');
    matchedFactors++;
  }
  const requestedTerms = terms(need.specificationTerms ?? []);
  if (requestedTerms.size) {
    const declared = terms(candidate.specificationTerms);
    if (!declared.size) unknown.push('specifications');
    else {
      possible += weights.specifications;
      const common = [...requestedTerms].filter((term) => declared.has(term)).length;
      earned += weights.specifications * common / requestedTerms.size;
      reasons.push(`${common} of ${requestedTerms.size} requested specification terms matched exactly`);
      matchedFactors++;
    }
  }
  const certificates = terms(need.requiredCertificates ?? []);
  if (certificates.size) {
    if (candidate.evidencedCertificates === null) unknown.push('certifications');
    else {
      possible += weights.certificates;
      const evidence = terms(candidate.evidencedCertificates);
      const common = [...certificates].filter((term) => evidence.has(term)).length;
      earned += weights.certificates * common / certificates.size;
      reasons.push(`${common} of ${certificates.size} requested certificates have product evidence`);
      matchedFactors++;
    }
  }
  return {
    supplierId: candidate.supplierId, productId: candidate.productId, eligible: true,
    exclusions, unknown, reasons, matchedFactors,
    score: matchedFactors >= 3 && possible > 0 ? Math.round(100 * earned / possible) : null,
  };
}

export function rankSupplierMatches(results: MatchResult[]): MatchResult[] {
  return [...results].sort((a, b) =>
    Number(b.eligible) - Number(a.eligible) ||
    (b.score ?? -1) - (a.score ?? -1) ||
    b.matchedFactors - a.matchedFactors ||
    a.supplierId.localeCompare(b.supplierId) ||
    a.productId.localeCompare(b.productId));
}

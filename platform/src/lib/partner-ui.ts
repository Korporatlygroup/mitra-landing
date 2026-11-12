import { parseDecimal } from '@/server/import/decimal';
import type { ImportJobStatus, ProductStatus, SupplierDetail, SupplierStatus } from '@/server/services/p5-types';

/**
 * Pure helpers for the partner screens (no React, no I/O): status rules, the supplier "what is missing" checklist, live price-tier
 * validation and import error key handling. Unit tested in tests/unit/p5-partner-ui.test.ts.
 */

// ------------------------------------------------------------------------------------------------ statuses

/** Tone of a status chip (text always carries the meaning; the tone only reinforces it). */
export function statusTone(status: string): 'approved' | 'needs_info' | 'rejected' | 'neutral' {
  if (['approved', 'published', 'committed'].includes(status)) return 'approved';
  if (['more_info_needed', 'changes_requested', 'clarification_requested', 'previewed', 'pending'].includes(status)) return 'needs_info';
  if (['rejected', 'suspended', 'failed'].includes(status)) return 'rejected';
  return 'neutral';
}

/** A supplier can be edited unless it is waiting for review or paused. An approved supplier stays live while the revision is reviewed. */
export const supplierEditable = (s: SupplierStatus, underReview: boolean): boolean =>
  (['draft', 'more_info_needed', 'rejected'] as SupplierStatus[]).includes(s) || (s === 'approved' && !underReview);

/** True while a submitted version of the supplier is being reviewed (also for an approved supplier with a revision). */
export const supplierUnderReview = (d: { status: SupplierStatus; draft_submitted_version: number | null }): boolean =>
  d.status === 'awaiting_review' || (d.status === 'approved' && d.draft_submitted_version != null);

/** Products: draft and changes_requested/rejected are editable; submitted (under review) and suspended are not. Published/approved/unpublished
 * products are edited as a new draft, the live copy stays. */
export const productEditable = (s: ProductStatus, pendingRevisionStatus?: string | null): boolean => {
  if (s === 'submitted' || s === 'suspended') return false;
  if (pendingRevisionStatus === 'submitted') return false;
  return true;
};

export const IMPORT_FINAL: ImportJobStatus[] = ['committed', 'failed', 'cancelled'];

// ------------------------------------------------------------------------------------------------ supplier checklist

export type SupplierMissing = 'name' | 'country' | 'category' | 'description' | 'contact' | 'document';

/** What a supplier still lacks before it can be sent for review (mirrors submit_supplier; the database is the authority). */
export function supplierMissing(d: Pick<SupplierDetail, 'draft' | 'private' | 'documents'>): SupplierMissing[] {
  const out: SupplierMissing[] = [];
  const dr = d.draft ?? {};
  if (!dr.name || dr.name.trim().length < 2) out.push('name');
  if (!dr.country) out.push('country');
  if (!dr.main_category) out.push('category');
  if (!dr.description || dr.description.trim().length < 20) out.push('description');
  const p = d.private;
  const cd = { name: p?.contact_name ?? dr.contact_name, email: p?.contact_email ?? dr.contact_email, phone: p?.contact_phone ?? dr.contact_phone };
  if (!cd.name || !(cd.email || cd.phone)) out.push('contact');
  if (!(d.documents ?? []).some((x) => x.scan_status === 'clean')) out.push('document');
  return out;
}

// ------------------------------------------------------------------------------------------------ price tiers (live validation)

export interface TierRow {
  variant_sku: string;
  min_qty: string;
  max_qty: string;
  unit_price: string;
}
export interface TierProblem {
  /** Index in the rows array. */
  row: number;
  /** A key under `errors.*`. */
  key: 'invalid_tier_qty' | 'invalid_price' | 'tier_not_ascending' | 'tier_overlap' | 'tier_gap' | 'tier_last_not_open' | 'tier_does_not_cover_moq';
}

const whole = (s: string): number | null => (/^\d{1,10}$/.test(s.trim()) && Number(s) >= 1 ? Number(s) : null);

export const isMoney = (s: string): boolean => {
  const r = parseDecimal(s.trim(), { maxScale: 2, maxIntDigits: 11, fixedScale: true });
  return r.ok && r.scaled > BigInt(0);
};

/**
 * Same rules as the database: quantities are whole numbers >= 1, tiers (per option) ascending, contiguous (no gap, no overlap), the last one
 * open ended, and the first one starts at or below the minimum order. Returns one problem per offending row (first problem wins).
 */
export function validateTiers(rows: TierRow[], moq: number | null): TierProblem[] {
  const problems: TierProblem[] = [];
  const seen = new Set<number>();
  const add = (row: number, key: TierProblem['key']) => {
    if (!seen.has(row)) {
      seen.add(row);
      problems.push({ row, key });
    }
  };
  const groups = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const g = r.variant_sku.trim();
    groups.set(g, [...(groups.get(g) ?? []), i]);
  });
  rows.forEach((r, i) => {
    if (whole(r.min_qty) === null || (r.max_qty.trim() !== '' && whole(r.max_qty) === null)) add(i, 'invalid_tier_qty');
    else if (!isMoney(r.unit_price)) add(i, 'invalid_price');
  });
  for (const idx of groups.values()) {
    let prev: { min: number; max: number | null } | null = null;
    idx.forEach((i, n) => {
      const min = whole(rows[i]!.min_qty);
      const maxRaw = rows[i]!.max_qty.trim();
      const max = maxRaw === '' ? null : whole(maxRaw);
      if (min === null || (maxRaw !== '' && max === null)) {
        prev = null;
        return;
      }
      if (max !== null && max < min) add(i, 'tier_overlap');
      if (n === 0 && moq !== null && min > moq) add(i, 'tier_does_not_cover_moq');
      if (prev) {
        if (prev.max === null) add(i, 'tier_last_not_open');
        else if (min < prev.min) add(i, 'tier_not_ascending');
        else if (min <= prev.max) add(i, 'tier_overlap');
        else if (min > prev.max + 1) add(i, 'tier_gap');
      }
      if (n === idx.length - 1 && max !== null) add(i, 'tier_last_not_open');
      prev = { min, max };
    });
  }
  return problems.sort((a, b) => a.row - b.row);
}

// ------------------------------------------------------------------------------------------------ import error keys

/** Splits "key:detail" (database) or "field:key" (client-flagged) strings. Returns the key and a short detail for display. */
export function splitErrorKey(raw: string): { key: string; detail: string | null } {
  const i = raw.indexOf(':');
  if (i < 0) return { key: raw, detail: null };
  const head = raw.slice(0, i);
  const tail = raw.slice(i + 1);
  return { key: head, detail: tail.length <= 60 ? tail : tail.slice(0, 60) };
}

/** Whole numbers shown with a thin grouping only for display; never used for arithmetic on money. */
export const nonEmpty = (v: string | null | undefined): v is string => typeof v === 'string' && v.trim() !== '';

/** Today as YYYY-MM-DD in UTC (a confirmation date cannot be in the future, so default fields use today). */
export const todayIso = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

// ------------------------------------------------------------------------------------------------ product form -> draft data

/** Keys the product form always sends: a blank value there means "remove it" (the shared schemas drop blanks, which would leave the old value). */
const CLEARABLE = ['name', 'description', 'category_slug', 'unit', 'moq', 'currency', 'price_mode', 'unit_price', 'lead_time_min_days', 'lead_time_max_days', 'availability_status', 'availability_confirmed_on', 'price_confirmed_on', 'packaging', 'specs', 'tiers'];

/** Adds an empty-string value for form fields that were sent blank (so an edit can remove a value) and removes fields that do not apply to the chosen price option. */
export function clearedBlanks(raw: Record<string, string>, data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data };
  for (const k of CLEARABLE) if (k in raw && raw[k]!.trim() === '' && out[k] === undefined) out[k] = '';
  if (raw.price_mode && raw.price_mode !== 'tiers') out.tiers = '';
  if (raw.price_mode && raw.price_mode !== 'fixed') out.unit_price = '';
  return out;
}

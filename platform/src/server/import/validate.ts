import { parseDecimal, type DecimalOk } from './decimal';
import type { Params, RowErrorKey, RowIssue, Warning } from './errors';
import { LIMITS } from './limits';
import { parseCatalogueFile, type CatalogueFormat, type ParsedCatalogue, type RawChildRow, type RawRow } from './parse';
import {
  CURRENCIES,
  DATE_FLOOR,
  LEAD_TIME_RANGE,
  NUMBER_RULES,
  TEXT_RULES,
  matchAvailability,
  matchCategory,
  matchPriceMode,
  matchStatus,
  matchUnit,
  type DecimalRule,
  type PriceMode,
  type TextRule,
} from './rules';
import { cleanText, startsWithFormulaChar } from './text';

export interface ValidateOptions {
  /** The selected supplier's code. Rows carrying any other code are rejected (unknown_supplier). */
  supplierCode: string;
  /** Clock for the date checks; pass a fixed value in tests. */
  now?: Date;
}

// ---- output model: `data` is exactly the draft shape the SQL validator (validate_product_data) accepts ----

export interface VariantData {
  sku: string;
  label: string;
  attributes?: Record<string, string>;
  moq?: string;
}
export interface TierData {
  min_qty: string;
  max_qty?: string;
  unit_price: string;
  /** omitted = the whole product */
  variant_sku?: string;
}
/**
 * Normalised product draft. Key names follow the SQL draft model; empty optional keys are omitted
 * (the SQL treats a present but empty `tiers` as a tier input). When a value failed validation the
 * trimmed original text is kept so the SQL validator reports its own error for it.
 */
export interface DraftData {
  sku: string;
  name: string;
  description: string;
  category_slug: string;
  unit: string;
  moq: string;
  currency: string;
  price_mode?: PriceMode;
  unit_price?: string;
  tiers?: TierData[];
  variants?: VariantData[];
  lead_time_min_days?: string;
  lead_time_max_days?: string;
  availability_status?: string;
  availability_confirmed_on?: string;
  price_confirmed_on?: string;
  specs?: Record<string, string>;
  packaging?: string;
}

export type RowStatus = 'valid' | 'invalid' | 'duplicate';
export interface RowResult {
  rowNumber: number;
  sku: string;
  ok: boolean;
  status: RowStatus;
  errors: RowIssue[];
  data: DraftData;
  /** The sheet's status column: draft or submit (null if blank/invalid). Not part of the SQL draft; importing never publishes. */
  requestedStatus: 'draft' | 'submit' | null;
  /** original cells by canonical column (for the error report; never sent to the database) */
  raw: Record<string, string>;
}
export interface FileIssue {
  sheet: string;
  rowNumber: number;
  sku: string;
  field: string;
  key: RowErrorKey;
}
export interface ImportResult {
  fileName: string;
  format: CatalogueFormat;
  supplierCode: string;
  columns: string[];
  rows: RowResult[];
  totals: { rows: number; valid: number; invalid: number; duplicates: number };
  warnings: Warning[];
  /** Issues not attached to a product row (e.g. Variants/PriceTiers rows with an unknown sku). The app must not stage a file that has any. */
  fileErrors: FileIssue[];
}

// ---- issue collector -------------------------------------------------------------------------

class Collector {
  constructor(
    readonly list: RowIssue[] = [],
    private readonly extra: Params = {},
  ) {}
  add(field: string, key: RowErrorKey, params: Params = {}): void {
    const merged = { ...params, ...this.extra };
    this.list.push(Object.keys(merged).length ? { field, key, params: merged } : { field, key });
  }
  has(field: string): boolean {
    return this.list.some((i) => i.field === field);
  }
  /** Same issue list, with extra params (sheet, row) merged into every issue. */
  child(extra: Params): Collector {
    return new Collector(this.list, { ...this.extra, ...extra });
  }
}

// ---- field readers (the table in rules.ts supplies the limits) ----------------------------------

function readText(c: Collector, field: string, raw: string | undefined, rule: TextRule): string {
  const value = raw ?? '';
  const cleaned = cleanText(value, rule.multiline ?? false);
  if (startsWithFormulaChar(value) || startsWithFormulaChar(cleaned)) {
    c.add(field, 'formula_injection');
    return cleaned;
  }
  if (cleaned === '') {
    if (rule.required) c.add(field, 'required');
    return '';
  }
  if (rule.min !== undefined && cleaned.length < rule.min) c.add(field, 'too_short', { min: rule.min });
  else if (cleaned.length > rule.max) c.add(field, 'too_long', { max: rule.max });
  else if (rule.pattern && !rule.pattern.test(cleaned)) c.add(field, 'invalid_format');
  return cleaned;
}

interface Dec {
  ok: DecimalOk | null;
  /** trimmed original text ('' if blank) */
  text: string;
}
/** Reads a decimal. Blank gives no error (caller decides); an invalid value records the error and keeps the text. */
function readDecimal(c: Collector, field: string, raw: string | undefined, rule: DecimalRule): Dec {
  const text = cleanText(raw ?? '');
  if (text === '') return { ok: null, text };
  const r = parseDecimal(text, { maxScale: rule.scale, maxIntDigits: rule.intDigits, fixedScale: rule.fixedScale });
  if (!r.ok) {
    c.add(field, r.key, r.params);
    return { ok: null, text };
  }
  return { ok: r, text };
}

interface PairLimits {
  maxPairs: number;
  maxKey: number;
  maxValue: number;
}
const SPEC_LIMITS: PairLimits = { maxPairs: LIMITS.maxSpecPairs, maxKey: LIMITS.maxSpecKeyLength, maxValue: LIMITS.maxSpecValueLength };
const ATTR_LIMITS: PairLimits = { maxPairs: LIMITS.maxAttrPairs, maxKey: LIMITS.maxAttrKeyLength, maxValue: LIMITS.maxAttrValueLength };

/** 'key: value; key: value' (newlines also separate pairs). Returns undefined on error or when empty. */
function parsePairs(c: Collector, field: string, cleaned: string, limits: PairLimits): Record<string, string> | undefined {
  if (cleaned === '') return undefined;
  const out: Record<string, string> = {};
  const seen = new Set<string>();
  const pieces = cleaned.split(/;|\n/).map((p) => p.trim()).filter((p) => p !== '');
  if (pieces.length > limits.maxPairs) {
    c.add(field, 'specs_too_many', { max: limits.maxPairs });
    return undefined;
  }
  for (const piece of pieces) {
    const idx = piece.indexOf(':');
    const key = idx > 0 ? piece.slice(0, idx).trim() : '';
    const value = idx > 0 ? piece.slice(idx + 1).trim() : '';
    if (key === '' || value === '') {
      c.add(field, 'specs_invalid');
      return undefined;
    }
    if (key.length > limits.maxKey) {
      c.add(field, 'too_long', { max: limits.maxKey, part: 'key' });
      return undefined;
    }
    if (value.length > limits.maxValue) {
      c.add(field, 'too_long', { max: limits.maxValue, part: 'value' });
      return undefined;
    }
    const lower = key.toLowerCase();
    if (seen.has(lower)) {
      c.add(field, 'specs_duplicate_key', { key });
      return undefined;
    }
    seen.add(lower);
    out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

/** ISO yyyy-mm-dd or dd/mm/yyyy (day first). Returns the ISO date or null. */
export function parseDateInput(s: string): string | null {
  let y: number, m: number, d: number;
  let mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (mt) [y, m, d] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else if ((mt = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) [d, m, y] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}

/** A date column: ISO or dd/mm/yyyy, in [DATE_FLOOR, today]. Returns the ISO date; on error returns the original text. */
function readDate(c: Collector, field: string, raw: string | undefined, now: Date): string {
  const text = cleanText(raw ?? '');
  if (text === '') return '';
  const iso = parseDateInput(text);
  if (!iso) {
    c.add(field, 'date_invalid');
    return text;
  }
  const today = now.toISOString().slice(0, 10);
  if (iso > today) c.add(field, 'date_in_future');
  else if (iso < DATE_FLOOR) c.add(field, 'date_out_of_range', { min: DATE_FLOOR, max: today });
  return iso;
}

// ---- variants and tiers ------------------------------------------------------------------------

interface VariantIn {
  fields: { label: string; sku: string; attributes: string; moq: string };
  raw: { label?: string; sku?: string; attributes?: string; moq?: string };
  extra: Params;
}
interface TierIn {
  fields: { min: string; max: string; price: string; variant: string; currency: string };
  raw: { min?: string; max?: string; price?: string; variant?: string; currency?: string };
  extra: Params;
}
interface TierRead {
  /** the tier as it will be sent (raw text kept where a value failed) */
  data: TierData;
  /** present only when min and max parsed, for the sequence checks */
  min: bigint | null;
  max: bigint | null;
  variantKey: string;
  minField: string;
  maxField: string;
  extra: Params;
}

const blank = (s: string | undefined) => (s ?? '').trim() === '';

function readVariant(c: Collector, v: VariantIn): VariantData | null {
  const r = v.raw;
  if ([r.label, r.sku, r.attributes, r.moq].every(blank)) return null;
  const cc = c.child(v.extra);
  let label = '';
  if (blank(r.label)) cc.add(v.fields.label, 'variant_incomplete');
  else label = readText(cc, v.fields.label, r.label, TEXT_RULES.variant_label);
  const sku = readText(cc, v.fields.sku, r.sku, TEXT_RULES.variant_sku);
  const attrText = readText(cc, v.fields.attributes, r.attributes, TEXT_RULES.variant_attributes);
  const attributes = cc.has(v.fields.attributes) ? undefined : parsePairs(cc, v.fields.attributes, attrText, ATTR_LIMITS);
  const moq = readDecimal(cc, v.fields.moq, r.moq, NUMBER_RULES.moq);
  if (moq.ok && moq.ok.scaled <= 0n) cc.add(v.fields.moq, 'moq_not_positive');
  const out: VariantData = { sku, label };
  if (attributes) out.attributes = attributes;
  if (moq.ok) out.moq = moq.ok.text;
  else if (moq.text) out.moq = moq.text;
  return out;
}

function readTier(c: Collector, t: TierIn, currency: string | null): TierRead | null {
  const r = t.raw;
  if ([r.min, r.max, r.price, r.variant].every(blank) && blank(r.currency)) return null;
  const cc = c.child(t.extra);
  const qty = (field: string, raw: string | undefined): { value: bigint | null; text: string } => {
    const d = readDecimal(cc, field, raw, NUMBER_RULES.qty);
    if (!d.ok) return { value: null, text: d.text };
    if (d.ok.scaled % 1000n !== 0n) {
      cc.add(field, 'tier_qty_not_integer');
      return { value: null, text: d.text };
    }
    return { value: d.ok.scaled / 1000n, text: String(d.ok.scaled / 1000n) };
  };
  const min = qty(t.fields.min, r.min);
  const max = qty(t.fields.max, r.max);
  const price = readDecimal(cc, t.fields.price, r.price, NUMBER_RULES.price);
  if (blank(r.min)) cc.add(t.fields.min, 'tier_incomplete');
  if (blank(r.price)) cc.add(t.fields.price, 'tier_incomplete');
  if (price.ok && price.ok.scaled <= 0n) cc.add(t.fields.price, 'price_not_positive');
  if (min.value !== null && min.value < 1n) cc.add(t.fields.min, 'tier_min_invalid');
  if (max.value !== null && max.value < 1n) cc.add(t.fields.max, 'tier_min_invalid');
  if (min.value !== null && max.value !== null && max.value < min.value) cc.add(t.fields.max, 'tier_range_invalid');
  let variantSku = '';
  if (!blank(r.variant)) variantSku = readText(cc, t.fields.variant, r.variant, TEXT_RULES.variant_sku);
  if (!blank(r.currency)) {
    const cur = cleanText(r.currency ?? '').toUpperCase();
    if (currency && cur !== currency) cc.add(t.fields.currency, 'tier_currency_mismatch');
  }
  const data: TierData = { min_qty: min.text, unit_price: price.ok ? price.ok.text : price.text };
  if (max.text) data.max_qty = max.text;
  if (variantSku) data.variant_sku = variantSku;
  return { data, min: min.value, max: max.value, variantKey: variantSku.toUpperCase(), minField: t.fields.min, maxField: t.fields.max, extra: t.extra };
}

/** Per variant group, in file order: ascending, no overlap, no gap (next min = previous max + 1), last tier open-ended. */
function checkTierSequence(c: Collector, tiers: TierRead[]): void {
  const groups = new Map<string, TierRead[]>();
  for (const t of tiers) groups.set(t.variantKey, [...(groups.get(t.variantKey) ?? []), t]);
  for (const group of groups.values()) {
    let prev: TierRead | null = null;
    for (const t of group) {
      if (prev && prev.min !== null && t.min !== null) {
        const cc = c.child(t.extra);
        if (t.min <= prev.min) cc.add(t.minField, 'tier_not_ascending');
        else if (prev.max === null) c.child(prev.extra).add(prev.minField, 'tier_open_ended_not_last');
        else if (t.min <= prev.max) cc.add(t.minField, 'tier_overlap');
        else if (t.min > prev.max + 1n) cc.add(t.minField, 'tier_gap');
      }
      prev = t;
    }
    const last = group[group.length - 1];
    if (last.max !== null) c.child(last.extra).add(last.maxField, 'tier_last_not_open');
  }
}

// ---- one product row ---------------------------------------------------------------------------

function validateRow(
  row: RawRow,
  children: { variants: RawChildRow[]; tiers: RawChildRow[] },
  opts: ValidateOptions,
  now: Date,
): { data: DraftData; errors: RowIssue[]; requestedStatus: 'draft' | 'submit' | null } {
  const c = new Collector();
  const cell = (k: string) => row.cells[k];

  const supplierCode = readText(c, 'supplier_code', cell('supplier_code'), TEXT_RULES.supplier_code);
  if (supplierCode && !c.has('supplier_code') && supplierCode.toUpperCase() !== opts.supplierCode.trim().toUpperCase()) c.add('supplier_code', 'unknown_supplier');
  const sku = readText(c, 'sku', cell('sku'), TEXT_RULES.sku);
  const name = readText(c, 'name', cell('name'), TEXT_RULES.name);

  let category = readText(c, 'category', cell('category'), TEXT_RULES.category);
  if (category && !c.has('category')) {
    const slug = matchCategory(category);
    if (slug) category = slug;
    else c.add('category', 'category_invalid');
  }
  const description = readText(c, 'description', cell('description'), TEXT_RULES.description);

  let unit = readText(c, 'unit', cell('unit'), TEXT_RULES.unit);
  if (unit && !c.has('unit')) {
    const u = matchUnit(unit);
    if (u) unit = u;
    else c.add('unit', 'unit_invalid');
  }

  const moq = readDecimal(c, 'moq', cell('moq'), NUMBER_RULES.moq);
  if (blank(cell('moq'))) c.add('moq', 'required');
  else if (moq.ok && moq.ok.scaled <= 0n) c.add('moq', 'moq_not_positive');

  const currency = cleanText(cell('currency') ?? '').toUpperCase();
  const currencyOk = (CURRENCIES as readonly string[]).includes(currency);
  if (currency === '') c.add('currency', 'required');
  else if (!currencyOk) c.add('currency', 'currency_invalid');

  // variants (wide columns, then Variants sheet rows) ---------------------------------------------
  const variantIns: VariantIn[] = [];
  for (let n = 1; n <= LIMITS.maxWideVariants; n++) {
    variantIns.push({
      fields: { label: `variant${n}_label`, sku: `variant${n}_sku`, attributes: `variant${n}_attributes`, moq: `variant${n}_moq` },
      raw: { label: cell(`variant${n}_label`), sku: cell(`variant${n}_sku`), attributes: cell(`variant${n}_attributes`), moq: cell(`variant${n}_moq`) },
      extra: {},
    });
  }
  for (const vr of children.variants) {
    variantIns.push({
      fields: { label: 'label', sku: 'variant_sku', attributes: 'attributes', moq: 'moq' },
      raw: { label: vr.cells.label, sku: vr.cells.variant_sku, attributes: vr.cells.attributes, moq: vr.cells.moq },
      extra: { sheet: vr.sheet, row: vr.rowNumber },
    });
  }
  const variants: VariantData[] = [];
  const seenVariantSkus = new Set<string>();
  for (const vin of variantIns) {
    const v = readVariant(c, vin);
    if (!v) continue;
    if (v.sku) {
      if (seenVariantSkus.has(v.sku.toUpperCase())) c.child(vin.extra).add(vin.fields.sku, 'duplicate_variant', { label: v.sku });
      seenVariantSkus.add(v.sku.toUpperCase());
    }
    variants.push(v);
  }
  if (variants.length > LIMITS.maxVariants) c.add('variant1_label', 'too_many_variants', { max: LIMITS.maxVariants });

  // tiers (wide columns, then PriceTiers sheet rows) ----------------------------------------------
  const tierIns: TierIn[] = [];
  for (let n = 1; n <= LIMITS.maxWideTiers; n++) {
    tierIns.push({
      fields: { min: `tier${n}_min`, max: `tier${n}_max`, price: `tier${n}_price`, variant: '', currency: '' },
      raw: { min: cell(`tier${n}_min`), max: cell(`tier${n}_max`), price: cell(`tier${n}_price`) },
      extra: {},
    });
  }
  for (const tr of children.tiers) {
    tierIns.push({
      fields: { min: 'min_qty', max: 'max_qty', price: 'unit_price', variant: 'variant_sku', currency: 'currency' },
      raw: { min: tr.cells.min_qty, max: tr.cells.max_qty, price: tr.cells.unit_price, variant: tr.cells.variant_sku, currency: tr.cells.currency },
      extra: { sheet: tr.sheet, row: tr.rowNumber },
    });
  }
  const tiers: TierRead[] = [];
  for (const tin of tierIns) {
    const t = readTier(c, tin, currencyOk ? currency : null);
    if (t) tiers.push(t);
  }
  if (tiers.length > LIMITS.maxTiers) c.add('tier1_min', 'too_many_tiers', { max: LIMITS.maxTiers });
  for (const t of tiers) {
    if (t.data.variant_sku && !seenVariantSkus.has(t.data.variant_sku.toUpperCase())) c.child(t.extra).add('variant_sku', 'unknown_variant');
  }
  checkTierSequence(c, tiers);

  // price and mode (SQL: tiers and unit_price are mutually exclusive; request allows neither) ------------
  const hasPriceInput = !blank(cell('price'));
  const hasTierInput = tiers.length > 0;
  const price = hasPriceInput ? readDecimal(c, 'price', cell('price'), NUMBER_RULES.price) : { ok: null, text: '' };
  if (price.ok && price.ok.scaled <= 0n) c.add('price', 'price_not_positive');
  const modeRaw = cleanText(cell('price_mode') ?? '');
  let mode: PriceMode | null = null;
  if (modeRaw !== '') {
    mode = matchPriceMode(modeRaw);
    if (!mode) c.add('price_mode', 'price_mode_invalid');
    else if (mode === 'request' && (hasPriceInput || hasTierInput)) c.add(hasPriceInput ? 'price' : 'tier1_min', 'price_mode_conflict');
    else if (mode === 'fixed' && hasTierInput) c.add('price_mode', 'price_mode_conflict');
    else if (mode === 'tiers' && hasPriceInput) c.add('price', 'price_mode_conflict');
    if (mode === 'fixed' && !hasPriceInput) c.add('price', 'price_required');
    if (mode === 'tiers' && !hasTierInput) c.add('price', 'price_required');
  } else if (hasTierInput && hasPriceInput) {
    mode = 'tiers';
    c.add('price', 'price_mode_conflict');
  } else if (hasTierInput) mode = 'tiers';
  else if (hasPriceInput) mode = 'fixed';
  else c.add('price', 'price_required');

  const packaging = readText(c, 'packaging', cell('packaging'), TEXT_RULES.packaging);
  const specText = readText(c, 'specifications', cell('specifications'), TEXT_RULES.specifications);
  const specs = c.has('specifications') ? undefined : parsePairs(c, 'specifications', specText, SPEC_LIMITS);

  // lead time (lead_time_days = minimum; lead_time_max_days optional, defaults to the same) ------------------
  const lead = (field: string, required: boolean): { n: number | null; text: string } => {
    const text = cleanText(cell(field) ?? '');
    if (text === '') {
      if (required) c.add(field, 'required');
      return { n: null, text };
    }
    if (!/^\d{1,9}$/.test(text)) {
      c.add(field, 'integer_invalid');
      return { n: null, text };
    }
    const n = Number(text);
    if (n < LEAD_TIME_RANGE.min || n > LEAD_TIME_RANGE.max) {
      c.add(field, 'out_of_range', { min: LEAD_TIME_RANGE.min, max: LEAD_TIME_RANGE.max });
      return { n: null, text };
    }
    return { n, text: String(n) };
  };
  const leadMin = lead('lead_time_days', true);
  const leadMax = lead('lead_time_max_days', false);
  if (leadMin.n !== null && leadMax.n !== null && leadMax.n < leadMin.n) c.add('lead_time_max_days', 'lead_time_order');

  // availability and price dates (confirmed-on dates: ISO or dd/mm/yyyy, not in the future) -----------------------
  if (blank(cell('availability_date'))) c.add('availability_date', 'required');
  const availabilityOn = readDate(c, 'availability_date', cell('availability_date'), now);
  const priceOn = readDate(c, 'price_confirmed_on', cell('price_confirmed_on'), now);
  let availabilityStatus = readText(c, 'availability_status', cell('availability_status'), { required: false, max: 30 });
  if (availabilityStatus && !c.has('availability_status')) {
    const a = matchAvailability(availabilityStatus);
    if (a) availabilityStatus = a;
    else c.add('availability_status', 'availability_invalid');
  }

  // sheet status: draft or submit (never publish) --------------------------------------------------------------
  const statusText = readText(c, 'status', cell('status'), { required: true, max: 30 });
  let requestedStatus: 'draft' | 'submit' | null = null;
  if (statusText && !c.has('status')) {
    requestedStatus = matchStatus(statusText);
    if (!requestedStatus) c.add('status', 'status_invalid');
  }

  const data: DraftData = { sku, name, description, category_slug: category, unit, moq: moq.ok ? moq.ok.text : moq.text, currency };
  if (mode) data.price_mode = mode;
  if (hasPriceInput && mode !== 'request') data.unit_price = price.ok ? price.ok.text : price.text;
  if (tiers.length) data.tiers = tiers.map((t) => t.data);
  if (variants.length) data.variants = variants;
  if (leadMin.text) data.lead_time_min_days = leadMin.text;
  const maxText = leadMax.text || leadMin.text;
  if (maxText) data.lead_time_max_days = maxText;
  if (availabilityStatus) data.availability_status = availabilityStatus;
  if (availabilityOn) data.availability_confirmed_on = availabilityOn;
  if (priceOn) data.price_confirmed_on = priceOn;
  if (specs) data.specs = specs;
  if (packaging) data.packaging = packaging;
  return { data, errors: c.list, requestedStatus };
}

// ---- whole file ----------------------------------------------------------------------------------------

export function validateCatalogue(parsed: ParsedCatalogue, opts: ValidateOptions): ImportResult {
  const now = opts.now ?? new Date();
  const skuOf = (r: RawRow) => cleanText(r.cells.sku ?? '').toUpperCase();

  // first product row per sku (children attach to it)
  const firstRowOf = new Map<string, number>();
  parsed.rows.forEach((r, i) => {
    const k = skuOf(r);
    if (k !== '' && !firstRowOf.has(k)) firstRowOf.set(k, i);
  });

  const variantsFor = new Map<number, RawChildRow[]>();
  const tiersFor = new Map<number, RawChildRow[]>();
  const fileErrors: FileIssue[] = [];
  const attach = (list: RawChildRow[], into: Map<number, RawChildRow[]>) => {
    for (const ch of list) {
      const k = cleanText(ch.cells.sku ?? '').toUpperCase();
      const idx = k === '' ? undefined : firstRowOf.get(k);
      if (idx === undefined) {
        fileErrors.push({ sheet: ch.sheet, rowNumber: ch.rowNumber, sku: cleanText(ch.cells.sku ?? '').slice(0, 40), field: 'sku', key: k === '' ? 'required' : 'orphan_child_row' });
        continue;
      }
      into.set(idx, [...(into.get(idx) ?? []), ch]);
    }
  };
  attach(parsed.variantRows, variantsFor);
  attach(parsed.tierRows, tiersFor);

  const seen = new Map<string, number>();
  const rows: RowResult[] = parsed.rows.map((r, i) => {
    const { data, errors, requestedStatus } = validateRow(r, { variants: variantsFor.get(i) ?? [], tiers: tiersFor.get(i) ?? [] }, opts, now);
    let status: RowStatus = 'valid';
    const k = skuOf(r);
    if (k !== '') {
      const first = seen.get(k);
      if (first === undefined) seen.set(k, r.rowNumber);
      else {
        errors.push({ field: 'sku', key: 'duplicate_sku', params: { firstRow: first } });
        status = 'duplicate';
      }
    }
    if (errors.length && status !== 'duplicate') status = 'invalid';
    return { rowNumber: r.rowNumber, sku: data.sku, ok: errors.length === 0, status, errors, data, requestedStatus, raw: r.cells };
  });

  const totals = {
    rows: rows.length,
    valid: rows.filter((r) => r.status === 'valid').length,
    invalid: rows.filter((r) => r.status === 'invalid').length,
    duplicates: rows.filter((r) => r.status === 'duplicate').length,
  };
  return { fileName: parsed.fileName, format: parsed.format, supplierCode: opts.supplierCode.trim(), columns: parsed.columns, rows, totals, warnings: parsed.warnings, fileErrors };
}

/** Parse and validate in one step. Throws ImportError for refused files. */
export function importCatalogueFile(buffer: Uint8Array | ArrayBuffer, fileName: string, opts: ValidateOptions): ImportResult {
  return validateCatalogue(parseCatalogueFile(buffer, fileName), opts);
}

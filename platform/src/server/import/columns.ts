import { LIMITS } from './limits';
import type { Warning } from './errors';

/**
 * Column conventions (see also the column table in the report / docs).
 *
 * Products sheet (xlsx) or the CSV file: one row per product.
 *   required: supplier_code, sku, name, category, description, unit, moq, currency, price*, specifications,
 *             lead_time_days, availability_date, status          (*price may be blank when price_mode is "request" or tiers are given)
 *   optional: price_mode (fixed | tiers | request), packaging, lead_time_max_days, availability_status, price_confirmed_on
 *   optional wide columns (CSV and xlsx): variant1_label, variant1_sku, variant1_attributes, variant1_moq ... variant5_*
 *                                         tier1_min, tier1_max, tier1_price ... tier5_*   (product-level price tiers)
 * XLSX only, optional sheets (one row per variant / tier, keyed by sku):
 *   Variants:   sku, variant_sku, label, attributes, moq
 *   PriceTiers: sku, variant_sku (blank = whole product), min_qty, max_qty, unit_price, currency (optional)
 * Extra sheets (e.g. "Instructions") are ignored with a warning only if they are not "Instructions".
 */

export const PRODUCT_REQUIRED = [
  'supplier_code',
  'sku',
  'name',
  'category',
  'description',
  'unit',
  'moq',
  'currency',
  'price',
  'specifications',
  'lead_time_days',
  'availability_date',
  'status',
] as const;
export const PRODUCT_OPTIONAL = ['price_mode', 'packaging', 'lead_time_max_days', 'availability_status', 'price_confirmed_on'] as const;

export const VARIANT_FIELDS = ['label', 'sku', 'attributes', 'moq'] as const;
export const TIER_FIELDS = ['min', 'max', 'price'] as const;

export const SHEET_PRODUCTS = 'Products';
export const SHEET_VARIANTS = 'Variants';
export const SHEET_TIERS = 'PriceTiers';
export const SHEET_INSTRUCTIONS = 'Instructions';

export const VARIANT_SHEET_COLUMNS = ['sku', 'variant_sku', 'label', 'attributes', 'moq'] as const;
export const VARIANT_SHEET_REQUIRED = ['sku', 'label'] as const;
export const TIER_SHEET_COLUMNS = ['sku', 'variant_sku', 'min_qty', 'max_qty', 'unit_price', 'currency'] as const;
export const TIER_SHEET_REQUIRED = ['sku', 'min_qty', 'unit_price'] as const;

/** Columns that appear in downloaded error reports; accepted silently on re-upload. */
const SILENT = new Set(['rownumber', 'errors']);

export function compactHeader(h: string): string {
  return h.normalize('NFC').replace(/^\uFEFF/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const SYNONYMS: Record<string, string[]> = {
  supplier_code: ['suppliercode', 'supplier', 'suppliercodeid', 'vendorcode', 'vendor'],
  sku: ['sku', 'productsku', 'itemcode', 'productcode', 'itemsku', 'stockkeepingunit'],
  name: ['name', 'productname', 'title', 'producttitle', 'itemname'],
  category: ['category', 'productcategory'],
  description: ['description', 'productdescription', 'desc', 'details'],
  unit: ['unit', 'uom', 'unitofmeasure', 'unitofmeasurement', 'sellingunit'],
  moq: ['moq', 'minimumorderquantity', 'minorderqty', 'minimumorderqty', 'minorderquantity', 'minimumorder', 'minqty'],
  currency: ['currency', 'curr', 'ccy'],
  price: ['price', 'unitprice', 'baseprice', 'priceperunit', 'rate'],
  specifications: ['specifications', 'specification', 'specs', 'spec'],
  lead_time_days: ['leadtimedays', 'leadtime', 'leadtimeindays', 'leaddays', 'leadtimeday'],
  availability_date: ['availabilitydate', 'availabilityconfirmedon', 'availabilityasof', 'availabilityconfirmeddate'],
  status: ['status', 'productstatus'],
  price_mode: ['pricemode', 'pricingmode', 'pricingtype', 'pricetype'],
  packaging: ['packaging', 'packing', 'packagingdetails'],
  lead_time_max_days: ['leadtimemaxdays', 'maxleadtime', 'leadtimemax', 'maxleaddays'],
  availability_status: ['availabilitystatus', 'stockstatus'],
  price_confirmed_on: ['priceconfirmedon', 'priceasof', 'pricedate', 'priceconfirmeddate'],
};

const VARIANT_SYN: Record<(typeof VARIANT_FIELDS)[number], string[]> = {
  label: ['label', 'name'],
  sku: ['sku'],
  attributes: ['attributes', 'attribute', 'specs'],
  moq: ['moq'],
};
const TIER_SYN: Record<(typeof TIER_FIELDS)[number], string[]> = {
  min: ['min', 'minqty', 'minquantity', 'from', 'fromqty'],
  max: ['max', 'maxqty', 'maxquantity', 'to', 'toqty', 'upto'],
  price: ['price', 'unitprice'],
};

export function wideVariantColumns(): string[] {
  const out: string[] = [];
  for (let n = 1; n <= LIMITS.maxWideVariants; n++) for (const f of VARIANT_FIELDS) out.push(`variant${n}_${f}`);
  return out;
}
export function wideTierColumns(): string[] {
  const out: string[] = [];
  for (let n = 1; n <= LIMITS.maxWideTiers; n++) for (const f of TIER_FIELDS) out.push(`tier${n}_${f}`);
  return out;
}

/** Ordered canonical column list for the Products sheet / CSV (also the template header). */
export const PRODUCT_COLUMNS: string[] = [...PRODUCT_REQUIRED, ...PRODUCT_OPTIONAL, ...wideVariantColumns(), ...wideTierColumns()];

function buildProductSynonyms(): Map<string, string> {
  const m = new Map<string, string>();
  const add = (syn: string, canon: string) => {
    if (!m.has(syn)) m.set(syn, canon);
  };
  for (const [canon, list] of Object.entries(SYNONYMS)) {
    add(compactHeader(canon), canon);
    list.forEach((s) => add(s, canon));
  }
  for (let n = 1; n <= LIMITS.maxWideVariants; n++) {
    for (const f of VARIANT_FIELDS) {
      const canon = `variant${n}_${f}`;
      add(compactHeader(canon), canon);
      for (const s of VARIANT_SYN[f]) {
        add(`variant${n}${s}`, canon);
        add(`variant${s}${n}`, canon);
      }
    }
  }
  for (let n = 1; n <= LIMITS.maxWideTiers; n++) {
    for (const f of TIER_FIELDS) {
      const canon = `tier${n}_${f}`;
      add(compactHeader(canon), canon);
      for (const s of TIER_SYN[f]) {
        add(`tier${n}${s}`, canon);
        add(`tier${s}${n}`, canon);
        add(`pricetier${n}${s}`, canon);
      }
    }
  }
  return m;
}

const VARIANT_SHEET_SYN: Record<string, string[]> = {
  sku: ['sku', 'productsku'],
  variant_sku: ['variantsku', 'varsku'],
  label: ['label', 'variantlabel', 'variantname', 'name', 'variant'],
  attributes: ['attributes', 'attribute', 'specs', 'specifications'],
  moq: ['moq', 'minimumorderquantity', 'minorderqty'],
};
const TIER_SHEET_SYN: Record<string, string[]> = {
  sku: ['sku', 'productsku'],
  variant_sku: ['variantsku', 'varsku'],
  min_qty: ['minqty', 'min', 'minquantity', 'from', 'fromqty'],
  max_qty: ['maxqty', 'max', 'maxquantity', 'to', 'toqty', 'upto'],
  unit_price: ['unitprice', 'price'],
  currency: ['currency', 'curr', 'ccy'],
};

function fromRecord(rec: Record<string, string[]>): Map<string, string> {
  const m = new Map<string, string>();
  for (const [canon, list] of Object.entries(rec)) {
    m.set(compactHeader(canon), canon);
    for (const s of list) if (!m.has(s)) m.set(s, canon);
  }
  return m;
}

export interface SheetSpec {
  synonyms: Map<string, string>;
  required: readonly string[];
}
export const PRODUCT_SPEC: SheetSpec = { synonyms: buildProductSynonyms(), required: PRODUCT_REQUIRED };
export const VARIANT_SPEC: SheetSpec = { synonyms: fromRecord(VARIANT_SHEET_SYN), required: VARIANT_SHEET_REQUIRED };
export const TIER_SPEC: SheetSpec = { synonyms: fromRecord(TIER_SHEET_SYN), required: TIER_SHEET_REQUIRED };

export interface HeaderMapping {
  /** canonical name per header cell index (null = ignored) */
  columns: (string | null)[];
  /** canonical columns present, in file order */
  present: string[];
  missing: string[];
  warnings: Warning[];
}

export function mapHeaders(headers: string[], spec: SheetSpec, sheet?: string): HeaderMapping {
  const columns: (string | null)[] = [];
  const seen = new Set<string>();
  const warnings: Warning[] = [];
  const present: string[] = [];
  headers.forEach((raw, index) => {
    const compact = compactHeader(raw);
    if (compact === '') {
      columns.push(null);
      return;
    }
    const canon = spec.synonyms.get(compact);
    if (!canon) {
      columns.push(null);
      if (!SILENT.has(compact)) warnings.push({ key: 'unknown_column', params: { column: raw.trim().slice(0, 80), index: index + 1, ...(sheet ? { sheet } : {}) } });
      return;
    }
    if (seen.has(canon)) {
      columns.push(null);
      warnings.push({ key: 'duplicate_column', params: { column: canon, ...(sheet ? { sheet } : {}) } });
      return;
    }
    seen.add(canon);
    columns.push(canon);
    present.push(canon);
  });
  const missing = spec.required.filter((c) => !seen.has(c));
  return { columns, present, missing, warnings };
}

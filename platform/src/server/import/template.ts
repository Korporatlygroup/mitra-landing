import { PRODUCT_REQUIRED, PRODUCT_OPTIONAL, SHEET_INSTRUCTIONS, SHEET_PRODUCTS, SHEET_TIERS, SHEET_VARIANTS, TIER_SHEET_COLUMNS, VARIANT_SHEET_COLUMNS } from './columns';
import { toCsv } from './text';
import { writeXlsx, type XlsxCell } from './xlsx-write';
import { CATEGORY_SLUGS, UNITS } from './rules';

/** Header of the template: required + optional columns, 2 variants and 3 tiers (up to 5 of each are accepted). */
export const TEMPLATE_HEADER: string[] = [
  ...PRODUCT_REQUIRED,
  ...PRODUCT_OPTIONAL,
  'variant1_label',
  'variant1_sku',
  'variant1_attributes',
  'variant1_moq',
  'variant2_label',
  'variant2_sku',
  'variant2_attributes',
  'variant2_moq',
  'tier1_min',
  'tier1_max',
  'tier1_price',
  'tier2_min',
  'tier2_max',
  'tier2_price',
  'tier3_min',
  'tier3_max',
  'tier3_price',
];

/** Obviously synthetic example. Its supplier_code can never match a real supplier, so uploading it unchanged is rejected. */
function exampleRow(now: Date): string[] {
  const d = now.toISOString().slice(0, 10);
  const values: Record<string, string> = {
    supplier_code: 'EXAMPLE-DELETE-ME',
    sku: 'EXAMPLE-001',
    name: 'EXAMPLE product (delete this row)',
    category: 'textiles-apparel',
    description: 'Synthetic example row for illustration only. Replace it with your own product or delete it before uploading.',
    unit: 'piece',
    moq: '100',
    currency: 'INR',
    price: '',
    specifications: 'Material: cotton; Colour: assorted; Size: free size',
    lead_time_days: '21',
    availability_date: d,
    status: 'draft',
    price_mode: 'tiers',
    packaging: '10 pieces per polybag',
    lead_time_max_days: '28',
    availability_status: 'made_to_order',
    price_confirmed_on: d,
    variant1_label: 'Blue',
    variant1_sku: 'EXAMPLE-001-BLU',
    variant2_label: 'Red',
    variant2_sku: 'EXAMPLE-001-RED',
    tier1_min: '100',
    tier1_max: '499',
    tier1_price: '250.50',
    tier2_min: '500',
    tier2_max: '999',
    tier2_price: '240',
    tier3_min: '1000',
    tier3_price: '230',
  };
  return TEMPLATE_HEADER.map((h) => values[h] ?? '');
}

export function buildTemplateCsv(opts: { now?: Date } = {}): string {
  return toCsv([TEMPLATE_HEADER, exampleRow(opts.now ?? new Date())]);
}

const INSTRUCTIONS: string[] = [
  'How to fill in this catalogue file',
  '',
  'Fill in the Products sheet: one row per product. Keep the header row (row 1) exactly as it is.',
  'The row marked EXAMPLE is only an illustration. Delete it or replace it with your own product.',
  'Type your own supplier code in the supplier_code column. Rows with any other code are rejected.',
  'Required columns: supplier_code, sku, name, category, description, unit, moq, currency, price, specifications, lead_time_days, availability_date, status.',
  'Optional columns: price_mode, packaging, lead_time_max_days, availability_status, price_confirmed_on, variant1_* to variant5_* and tier1_* to tier5_*.',
  '',
  'sku: your own product code, letters, numbers, dot, dash or underscore, up to 40 characters. Each sku can appear only once.',
  'name: 2 to 160 characters. description: up to 2000 characters.',
  `category: one of ${CATEGORY_SLUGS.join(', ')}.`,
  `unit: for example ${UNITS.slice(0, 8).join(', ')}.`,
  'moq: minimum order quantity, a number above zero (up to 3 decimals).',
  'currency: INR, MYR or USD. Prices are never converted.',
  'price: a plain number above zero with up to 2 decimals, for example 250 or 1250.50. Do not use 1,50 or 1e3. Leave blank when price_mode is request or when you give price tiers (never both a price and tiers).',
  'price_mode: fixed (one price), tiers (price depends on quantity) or request (price on request). If blank it is worked out from price and tiers.',
  'specifications: pairs written as key: value; key: value (for example Material: cotton; Size: 10 cm). At most 20 pairs.',
  'lead_time_days: whole number of days, 0 to 365 (the shortest lead time; add lead_time_max_days for a range).',
  'availability_date: the date you confirmed the availability, yyyy-mm-dd (2026-12-01) or dd/mm/yyyy (01/12/2026). It cannot be in the future.',
  'availability_status: available, made_to_order, limited or unavailable (optional here, needed before a product can be submitted for review).',
  'status: draft or submit. Importing never publishes a product; MITRA review and your own publish step come later.',
  '',
  'Price tiers: tier1_min, tier1_max, tier1_price and so on, whole quantities. Each minimum is the previous maximum plus 1 (no gaps, no overlap) and the last tier has an empty max.',
  'Variants: variant1_label, variant1_sku (required for each variant), variant1_attributes, variant1_moq and so on.',
  'You can instead use the Variants and PriceTiers sheets (one row per variant or tier, linked by sku).',
  '',
  'Important: do not use formulas. Paste values only. Cells that start with = + - or @ are rejected in text columns.',
  'Limits: file up to 5 MB, 2000 product rows, 60 columns, 5000 characters per cell.',
];

export function buildTemplateXlsx(opts: { now?: Date } = {}): Uint8Array {
  const products: XlsxCell[][] = [TEMPLATE_HEADER, exampleRow(opts.now ?? new Date())];
  const variants: XlsxCell[][] = [[...VARIANT_SHEET_COLUMNS], ['EXAMPLE-001', 'EXAMPLE-001-GRN', 'Green', 'Size: large', '200']];
  const tiers: XlsxCell[][] = [[...TIER_SHEET_COLUMNS], ['EXAMPLE-001', '', '100', '499', '250.50', 'INR']];
  return writeXlsx([
    { name: SHEET_INSTRUCTIONS, rows: INSTRUCTIONS.map((l) => [l]), widths: [140] },
    { name: SHEET_PRODUCTS, rows: products, widths: TEMPLATE_HEADER.map((h) => Math.max(14, h.length + 2)) },
    { name: SHEET_VARIANTS, rows: variants, widths: [16, 18, 16, 24, 10] },
    { name: SHEET_TIERS, rows: tiers, widths: [16, 18, 12, 12, 12, 10] },
  ]);
}

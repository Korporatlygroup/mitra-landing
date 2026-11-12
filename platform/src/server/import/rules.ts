import { compactHeader } from './columns';

/**
 * The validation table. Every limit and vocabulary used by the row validator lives here so it can be
 * kept in sync with the SQL validator (the authority, written in the p5_import migration).
 */

export const CATEGORY_SLUGS = [
  'textiles-apparel',
  'food-groceries',
  'spices-condiments',
  'jewellery-accessories',
  'home-kitchen',
  'religious-items-puja',
  'cosmetics-personal-care',
  'stationery-books',
  'hardware-tools',
  'electronics-accessories',
  'packaging',
  'other',
] as const;
export type CategorySlug = (typeof CATEGORY_SLUGS)[number];

/** English labels used for tolerant matching only (the UI translates names via messages pcat.<slug>). */
const CATEGORY_LABELS: Record<CategorySlug, string[]> = {
  'textiles-apparel': ['Textiles & Apparel', 'Textiles', 'Apparel', 'Clothing', 'Garments', 'Textile'],
  'food-groceries': ['Food & Groceries', 'Food', 'Groceries', 'Grocery'],
  'spices-condiments': ['Spices & Condiments', 'Spices', 'Condiments', 'Spice'],
  'jewellery-accessories': ['Jewellery & Accessories', 'Jewelry & Accessories', 'Jewellery', 'Jewelry'],
  'home-kitchen': ['Home & Kitchen', 'Home and Kitchen', 'Kitchen', 'Homeware'],
  'religious-items-puja': ['Religious Items / Puja', 'Religious Items', 'Puja', 'Pooja', 'Religious'],
  'cosmetics-personal-care': ['Cosmetics & Personal Care', 'Cosmetics', 'Personal Care', 'Beauty'],
  'stationery-books': ['Stationery & Books', 'Stationery', 'Books'],
  'hardware-tools': ['Hardware & Tools', 'Hardware', 'Tools'],
  'electronics-accessories': ['Electronics & Accessories', 'Electronics'],
  packaging: ['Packaging', 'Packing materials'],
  other: ['Other', 'Others', 'Miscellaneous'],
};

function buildCategoryIndex(): Map<string, CategorySlug> {
  const m = new Map<string, CategorySlug>();
  for (const slug of CATEGORY_SLUGS) {
    m.set(compactHeader(slug), slug);
    for (const label of CATEGORY_LABELS[slug]) {
      m.set(compactHeader(label), slug);
      m.set(compactHeader(label.replaceAll('&', ' and ')), slug);
    }
  }
  return m;
}
const CATEGORY_INDEX = buildCategoryIndex();
export const matchCategory = (raw: string): CategorySlug | null => CATEGORY_INDEX.get(compactHeader(raw)) ?? null;

export const CURRENCIES = ['INR', 'MYR', 'USD'] as const;
export const PRODUCT_STATUSES = ['draft', 'submit'] as const;
export const PRICE_MODES = ['fixed', 'tiers', 'request'] as const;
export type PriceMode = (typeof PRICE_MODES)[number];

const UNIT_SYNONYMS: Record<string, string[]> = {
  piece: ['pieces', 'pc', 'pcs', 'unit', 'units', 'each', 'nos', 'no', 'number'],
  kg: ['kilogram', 'kilograms', 'kgs', 'kilo'],
  g: ['gram', 'grams', 'gm', 'gms'],
  tonne: ['tonnes', 'ton', 'tons', 'mt', 'metrictonne'],
  litre: ['litres', 'liter', 'liters', 'l', 'ltr'],
  ml: ['millilitre', 'milliliter', 'millilitres'],
  metre: ['metres', 'meter', 'meters', 'm', 'mtr'],
  box: ['boxes'],
  carton: ['cartons', 'ctn'],
  pack: ['packs', 'packet', 'packets', 'pkt'],
  set: ['sets'],
  dozen: ['dozens', 'doz'],
  pair: ['pairs', 'pr'],
  roll: ['rolls'],
  bag: ['bags'],
  bottle: ['bottles', 'btl'],
  sqm: ['sqmetre', 'squaremetre', 'squaremeter', 'sqmtr'],
};
export const UNITS = Object.keys(UNIT_SYNONYMS);
const UNIT_INDEX = (() => {
  const m = new Map<string, string>();
  for (const [u, syn] of Object.entries(UNIT_SYNONYMS)) {
    m.set(compactHeader(u), u);
    syn.forEach((s) => m.set(compactHeader(s), u));
  }
  return m;
})();
export const matchUnit = (raw: string): string | null => UNIT_INDEX.get(compactHeader(raw)) ?? null;

const STATUS_INDEX = new Map<string, (typeof PRODUCT_STATUSES)[number]>([
  ['draft', 'draft'],
  ['submit', 'submit'],
  ['submitted', 'submit'],
  ['submitforreview', 'submit'],
]);
export const matchStatus = (raw: string) => STATUS_INDEX.get(compactHeader(raw)) ?? null;

const PRICE_MODE_INDEX = new Map<string, PriceMode>([
  ['fixed', 'fixed'],
  ['fixedprice', 'fixed'],
  ['tiers', 'tiers'],
  ['tier', 'tiers'],
  ['tiered', 'tiers'],
  ['pricetiers', 'tiers'],
  ['request', 'request'],
  ['onrequest', 'request'],
  ['pricerequest', 'request'],
  ['requestquote', 'request'],
  ['quote', 'request'],
]);
export const matchPriceMode = (raw: string) => PRICE_MODE_INDEX.get(compactHeader(raw)) ?? null;

export interface TextRule {
  required: boolean;
  min?: number;
  max: number;
  pattern?: RegExp;
  multiline?: boolean;
}

/** Text limits (characters after trimming/normalising). */
export const TEXT_RULES = {
  supplier_code: { required: true, max: 40 },
  sku: { required: true, min: 1, max: 40, pattern: /^[A-Za-z0-9][A-Za-z0-9._/-]*$/ }, // SQL: ^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$
  name: { required: true, min: 2, max: 160 }, // SQL: char_length 2..160
  description: { required: true, max: 2000, multiline: true }, // SQL: <= 2000 (required by this file format)
  category: { required: true, max: 80 },
  unit: { required: true, max: 30 },
  packaging: { required: false, max: 300 },
  specifications: { required: true, max: 2000, multiline: true },
  variant_label: { required: true, min: 1, max: 80 },
  variant_sku: { required: true, min: 1, max: 40, pattern: /^[A-Za-z0-9][A-Za-z0-9._/-]*$/ }, // SQL: variant sku is required
  variant_attributes: { required: false, max: 1000, multiline: true },
} as const satisfies Record<string, TextRule>;

export interface DecimalRule {
  scale: number;
  intDigits: number;
  fixedScale?: boolean;
}
/** moq and quantities: up to 3 decimals; price: up to 2 decimals, numeric(14,2). */
export const NUMBER_RULES = {
  moq: { scale: 3, intDigits: 11 }, // SQL: ^[0-9]{1,11}(\.[0-9]{1,3})?$ and > 0
  qty: { scale: 3, intDigits: 9 }, // tier quantities: whole numbers >= 1 (SQL: ^[0-9]{1,9}(\.0+)?$)
  price: { scale: 2, intDigits: 11, fixedScale: true }, // SQL valid_money: ^[0-9]{1,11}(\.[0-9]{1,2})?$ and > 0
} as const satisfies Record<string, DecimalRule>;

export const LEAD_TIME_RANGE = { min: 0, max: 365 } as const;
/** Dates (availability_date -> availability_confirmed_on, price_confirmed_on) must be in [DATE_FLOOR, today]. SQL: not in the future. */
export const DATE_FLOOR = '2020-01-01';

export const AVAILABILITY_STATUSES = ['available', 'made_to_order', 'limited', 'unavailable'] as const;
const AVAILABILITY_INDEX = new Map<string, (typeof AVAILABILITY_STATUSES)[number]>([
  ['available', 'available'],
  ['instock', 'available'],
  ['madetoorder', 'made_to_order'],
  ['maketoorder', 'made_to_order'],
  ['mto', 'made_to_order'],
  ['limited', 'limited'],
  ['limitedstock', 'limited'],
  ['unavailable', 'unavailable'],
  ['outofstock', 'unavailable'],
]);
export const matchAvailability = (raw: string) => AVAILABILITY_INDEX.get(compactHeader(raw)) ?? null;

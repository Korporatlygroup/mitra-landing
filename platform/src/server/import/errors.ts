/**
 * Typed error and message keys for the catalogue import engine.
 * The engine never produces English text: the UI translates these keys (with their params).
 */

/** File-level failures: thrown as ImportError by parseCatalogueFile (nothing is staged). */
export const FILE_ERROR_KEYS = [
  'import_unsupported_file', // wrong extension, wrong magic bytes, macro/legacy/ods file, dangerous parts, NUL bytes in csv
  'import_too_large', // compressed size, zip expansion, or entry count over the limit
  'import_too_many_rows',
  'import_too_many_columns',
  'import_cell_too_long',
  'import_malformed', // corrupt zip/xml/csv, DOCTYPE/entities, truncated archive
  'import_bad_encoding', // csv is not valid UTF-8
  'import_formula_not_allowed', // an xlsx cell contains a formula (params: sheet, cells[], count)
  'import_empty', // no bytes, or no data rows after the header
  'import_missing_columns', // params: columns[] (canonical names)
  'import_missing_sheet', // params: sheet
] as const;
export type FileErrorKey = (typeof FILE_ERROR_KEYS)[number];

/** Row-level validation errors (field = canonical column name). Params are listed per key in rules.ts. */
export const ROW_ERROR_KEYS = [
  'required', // empty required value
  'too_short', // params: min
  'too_long', // params: max
  'invalid_format', // sku pattern etc.
  'formula_injection', // text cell starts with = + - @ tab or CR
  'unknown_supplier', // supplier_code differs from the selected supplier
  'category_invalid',
  'unit_invalid',
  'currency_invalid',
  'status_invalid', // only draft/submit
  'price_mode_invalid',
  'price_required', // no price, no tiers, price_mode not request
  'price_mode_conflict', // e.g. price_mode=request with a price, fixed with tiers
  'decimal_invalid', // not a plain decimal (abc, 1e3, 1.2.3, ...)
  'decimal_ambiguous', // 1,50  1,250  1.250,50: locale ambiguity, ask for plain digits
  'decimal_negative',
  'decimal_too_many_places', // params: max
  'decimal_too_large', // params: max (integer digits)
  'moq_not_positive',
  'price_not_positive', // SQL valid_money: price must be > 0
  'integer_invalid',
  'out_of_range', // params: min, max
  'lead_time_order', // lead_time_max_days < lead_time_days
  'availability_invalid', // availability_status not in available|made_to_order|limited|unavailable
  'date_invalid', // not ISO yyyy-mm-dd or dd/mm/yyyy, or not a real calendar date
  'date_out_of_range', // params: min, max
  'date_in_future', // *_confirmed_on cannot be after today (SQL future_date)
  'specs_invalid', // not 'key: value; key: value'
  'specs_too_many', // params: max
  'specs_duplicate_key', // params: key
  'duplicate_sku', // params: firstRow
  'duplicate_variant', // params: label
  'too_many_variants', // params: max
  'too_many_tiers', // params: max
  'variant_incomplete', // variant details filled but no label
  'tier_incomplete', // tier needs min and price
  'tier_min_invalid', // min < 1
  'tier_range_invalid', // max < min
  'tier_not_ascending',
  'tier_overlap',
  'tier_gap', // next tier min must be previous max + 1 (SQL tier_gap)
  'tier_last_not_open', // last tier must have an empty max (SQL tier_last_not_open)
  'tier_qty_not_integer', // tier quantities are whole numbers (SQL)
  'tier_open_ended_not_last',
  'tier_currency_mismatch',
  'orphan_child_row', // Variants/PriceTiers row whose sku is not in Products (reported in fileErrors)
  'unknown_variant', // PriceTiers variant_sku not defined for that product
] as const;
export type RowErrorKey = (typeof ROW_ERROR_KEYS)[number];

/** Non-blocking notes. */
export const WARNING_KEYS = [
  'unknown_column', // params: column, index
  'duplicate_column', // params: column
  'sheet_ignored', // params: sheet (not a documented sheet)
  'sheet_hidden_ignored', // params: sheet
] as const;
export type WarningKey = (typeof WARNING_KEYS)[number];

export type ParamValue = string | number | boolean | null | string[] | number[];
export type Params = Record<string, ParamValue>;

export class ImportError extends Error {
  readonly key: FileErrorKey;
  readonly params: Params;
  constructor(key: FileErrorKey, params: Params = {}) {
    super(key);
    this.name = 'ImportError';
    this.key = key;
    this.params = params;
  }
}

export interface RowIssue {
  field: string;
  key: RowErrorKey;
  params?: Params;
}
export interface Warning {
  key: WarningKey;
  params?: Params;
}

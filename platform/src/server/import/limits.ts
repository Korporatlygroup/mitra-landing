/** Hard limits for catalogue imports. All are enforced before or during parsing. */
export const LIMITS = {
  maxCompressedBytes: 5 * 1024 * 1024, // upload size (csv and xlsx)
  maxUncompressedBytes: 50 * 1024 * 1024, // xlsx: total inflated bytes across all entries
  maxZipEntries: 100,
  maxRows: 2000, // data rows in Products (header excluded)
  maxChildRows: 10000, // data rows in Variants / PriceTiers sheets
  maxRowIndex: 20000, // highest spreadsheet row number read (guards sparse sheets)
  maxColumns: 60,
  maxCellLength: 5000,
  maxVariants: 50, // mirrors SQL validate_product_data
  maxWideVariants: 5,
  maxTiers: 60, // total tiers per product (SQL)
  maxWideTiers: 5,
  maxSpecPairs: 20, // SQL: specs <= 20 keys
  maxSpecKeyLength: 40,
  maxSpecValueLength: 200,
  maxAttrPairs: 10, // SQL: variant attributes <= 10 keys
  maxAttrKeyLength: 40,
  maxAttrValueLength: 100,
} as const;

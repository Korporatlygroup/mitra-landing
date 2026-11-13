/**
 * Catalogue import engine: pure TypeScript, no database, no network, no Next.js.
 * Used by the server action: parse -> validate -> stage rows through the RPC (canonicalRowsForRpc).
 */
export { LIMITS } from './limits';
export { FILE_ERROR_KEYS, ROW_ERROR_KEYS, WARNING_KEYS, ImportError } from './errors';
export type { FileErrorKey, RowErrorKey, WarningKey, RowIssue, Warning, Params } from './errors';
export { parseCatalogueFile } from './parse';
export type { ParsedCatalogue, RawRow, RawChildRow, CatalogueFormat } from './parse';
export { validateCatalogue, importCatalogueFile, parseDateInput } from './validate';
export type { ImportResult, RowResult, RowStatus, FileIssue, ValidateOptions, DraftData, VariantData, TierData } from './validate';
export { fileSha256, canonicalRowsForRpc, buildErrorReportCsv } from './output';
export type { RpcRow, RpcOptions, IssueFormatter } from './output';
export { buildTemplateCsv, buildTemplateXlsx, TEMPLATE_HEADER } from './template';
export { safeCell, cleanText, toCsv } from './text';
export { parseDecimal } from './decimal';
export { CATEGORY_SLUGS, CURRENCIES, UNITS, PRODUCT_STATUSES, PRICE_MODES, AVAILABILITY_STATUSES } from './rules';
export { PRODUCT_REQUIRED, PRODUCT_OPTIONAL, PRODUCT_COLUMNS } from './columns';

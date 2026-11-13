import type { Currency, SupplierReviewCheck } from '@/server/services/p5-types';

/**
 * Display helpers for the Phase 5 screens. Pure. Money stays a decimal string: it is formatted for display only and never summed
 * or multiplied as a float.
 */

/** Translator for the `p5common` namespace, e.g. `useTranslations('p5common')` or `await getTranslations({ locale, namespace: 'p5common' })`. */
export type P5Translator = (key: string, values?: Record<string, string | number>) => string;

const LOCALE_TAGS: Record<string, string> = { en: 'en-MY', ta: 'ta-MY', ms: 'ms-MY' };
export const intlLocale = (locale: string) => LOCALE_TAGS[locale] ?? 'en-MY';

export function formatDate(iso: string, locale: string): string {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'long', timeZone: 'UTC' }).format(d);
}

/** "RM 12.50"-style display of a decimal string or number. Falls back to "<amount> <currency>" when Intl cannot format it. */
export function formatMoney(amount: string | number, currency: Currency, locale: string): string {
  try {
    return new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      (typeof amount === 'number' ? amount : String(amount)) as number,
    );
  } catch {
    return `${amount} ${currency}`;
  }
}

/**
 * The verification wording: what MITRA checked and when. Only ever "MITRA reviewed documents ... on <date>. What was checked: ...",
 * built from the stored checks and review date. Never "trusted" and never anything about an authority.
 */
export function reviewedSummary(t: P5Translator, review: { checks: readonly SupplierReviewCheck[] | null; reviewed_at: string | null } | null | undefined, locale: string): string {
  if (!review || !review.reviewed_at || !review.checks || review.checks.length === 0) return t('verification.notReviewed');
  const labels = review.checks.map((c) => t(`verification.checks.${c}`));
  const checks = new Intl.ListFormat(intlLocale(locale), { style: 'long', type: 'conjunction' }).format(labels);
  return t('verification.reviewedOn', { date: formatDate(review.reviewed_at, locale), checks });
}

/** "5 to 10 days", "7 days" or null when no lead time is given. */
export function leadTimeLabel(t: P5Translator, min: number | null | undefined, max: number | null | undefined): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null && min !== max) return t('labels.leadTimeRange', { min, max });
  return t('labels.leadTimeSingle', { days: (min ?? max) as number });
}

/**
 * How a programme is shown to the public. Derived only from facts the database already holds (publication state, verification,
 * the agency's stated status, the confirmed closing date and the freshness of the last check). An expired deadline is never
 * shown as active, and an unconfirmed or stale record is never shown as open.
 */

export type DisplayStatus = 'open' | 'upcoming' | 'dates_not_confirmed' | 'under_review' | 'stale' | 'closed' | 'archived';

export interface StatusInput {
  publication_state?: string | null;
  verification_status: string;
  application_status: string;
  closes_on?: string | null;
  is_stale: boolean;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export function displayStatus(p: StatusInput, today: Date = new Date()): DisplayStatus {
  if (p.publication_state === 'archived' || p.verification_status === 'archived') return 'archived';
  if (p.closes_on && p.closes_on < dayKey(today)) return 'closed';
  if (p.application_status === 'closed') return 'closed';
  if (['discovered', 'extracted', 'pending_review'].includes(p.verification_status)) return 'under_review';
  if (p.verification_status === 'unconfirmed' || p.is_stale) return 'stale';
  if (p.application_status === 'open') return 'open';
  if (p.application_status === 'upcoming') return 'upcoming';
  return 'dates_not_confirmed';
}

export const DISPLAY_STATUS_TONE: Record<DisplayStatus, 'green' | 'blue' | 'gray' | 'gold' | 'coral'> = {
  open: 'green', upcoming: 'blue', dates_not_confirmed: 'gray', under_review: 'gold', stale: 'coral', closed: 'gray', archived: 'gray',
};

export const CATEGORIES = ['grants_funding', 'business_financing', 'training', 'advisory', 'entrepreneurship', 'digital', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

const FROM_FUNDING: Record<string, Category> = { grant: 'grants_funding', subsidy: 'grants_funding', financing: 'business_financing', training: 'training', other: 'other' };

/** The stored category, or one derived from the funding type when an editor has not set it. */
export function categoryOf(p: { category?: string | null; funding_type?: string | null }): Category {
  if (p.category && (CATEGORIES as readonly string[]).includes(p.category)) return p.category as Category;
  return (p.funding_type && FROM_FUNDING[p.funding_type]) || 'other';
}

/** Days from today to a date (YYYY-MM-DD), or null when unknown or already past. */
export function daysUntil(date: string | null | undefined, today: Date = new Date()): number | null {
  if (!date) return null;
  const ms = Date.parse(date) - Date.parse(dayKey(today));
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 86_400_000) : null;
}

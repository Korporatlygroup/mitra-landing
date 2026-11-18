/** One way to show a date and time to people in Malaysia: Malaysia time (MYT, UTC+8), in the page language, always labelled.
 * Admin and audit screens keep UTC on purpose (technical records); everything else a person reads uses this. */
export const DISPLAY_TIME_ZONE = 'Asia/Kuala_Lumpur';

export function formatMyt(value: Date | string | number, locale: string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return `${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: DISPLAY_TIME_ZONE }).format(d)} MYT`;
}

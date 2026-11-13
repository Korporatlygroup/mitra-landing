import ms from '../../messages/ms.json';

/** Display name of a business category. English and Tamil come from the database; Bahasa Melayu from messages (by slug). */
export function catName(locale: string, c: { slug?: string; name_en: string; name_ta: string }): string {
  if (locale === 'ta') return c.name_ta;
  if (locale === 'ms') {
    const names = ms.categories as Record<string, string>;
    return (c.slug && names[c.slug]) || c.name_en;
  }
  return c.name_en;
}

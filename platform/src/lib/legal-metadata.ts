import type { Metadata } from 'next';
import { getLegalContent } from '@/content/legal';
import { LEGAL_STATUS, type LegalSlug } from '@/lib/legal';

/** Page title from the document; drafts are never indexed by search engines. */
export function legalMetadata(locale: string, slug: LegalSlug): Metadata {
  const { doc } = getLegalContent(locale, slug);
  return { title: doc.title, description: doc.intro.slice(0, 160), robots: LEGAL_STATUS === 'draft' ? { index: false, follow: false } : undefined };
}

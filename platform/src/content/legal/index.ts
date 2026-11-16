import type { LegalDocument, LegalSlug } from '@/lib/legal';
import { complaints as complaintsEn } from './en/complaints';
import { cookies as cookiesEn } from './en/cookies';
import { governmentDisclaimer as govEn } from './en/government-disclaimer';
import { marketplacePolicy as marketEn } from './en/marketplace-policy';
import { privacy as privacyEn } from './en/privacy';
import { terms as termsEn } from './en/terms';
import { complaints as complaintsMs } from './ms/complaints';
import { cookies as cookiesMs } from './ms/cookies';
import { governmentDisclaimer as govMs } from './ms/government-disclaimer';
import { marketplacePolicy as marketMs } from './ms/marketplace-policy';
import { privacy as privacyMs } from './ms/privacy';
import { terms as termsMs } from './ms/terms';

export const LEGAL_CONTENT: Record<'en' | 'ms', Record<LegalSlug, LegalDocument>> = {
  en: { privacy: privacyEn, terms: termsEn, 'marketplace-policy': marketEn, cookies: cookiesEn, 'government-disclaimer': govEn, complaints: complaintsEn },
  ms: { privacy: privacyMs, terms: termsMs, 'marketplace-policy': marketMs, cookies: cookiesMs, 'government-disclaimer': govMs, complaints: complaintsMs },
};

/** Tamil has no reviewed translation yet: the English text is shown with a notice (`translated: false`). */
export function getLegalContent(locale: string, slug: LegalSlug): { doc: LegalDocument; translated: boolean } {
  if (locale === 'ms') return { doc: LEGAL_CONTENT.ms[slug], translated: true };
  return { doc: LEGAL_CONTENT.en[slug], translated: locale === 'en' };
}

'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link, usePathname } from '@/i18n/navigation';

/** EN | தமிழ் toggle. Keeps the current page and query string; the current language is marked with aria-current. */
export default function LocaleSwitcher() {
  const t = useTranslations('common');
  const locale = useLocale();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const href = search ? `${pathname}?${search}` : pathname;

  const item = (l: 'en' | 'ta', short: string, full: string) => (
    <Link
      href={href}
      locale={l}
      lang={l}
      hrefLang={l}
      aria-current={locale === l ? 'true' : undefined}
      aria-label={full}
      className={locale === l ? 'lang lang-active' : 'lang'}
    >
      {short}
    </Link>
  );

  return (
    <nav aria-label={t('languageLabel')} className="lang-switch">
      {item('en', t('langEn'), t('langEnFull'))}
      <span aria-hidden="true">|</span>
      {item('ta', t('langTa'), t('langTaFull'))}
    </nav>
  );
}

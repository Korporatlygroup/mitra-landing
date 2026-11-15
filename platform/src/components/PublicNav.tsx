'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';

/** Centred top-bar pills. The active one is ink with white text (aria-current="page"). */
export default function PublicNav() {
  const t = useTranslations();
  const path = usePathname();
  const items = [
    { href: '/directory', label: t('nav.find') },
    { href: '/catalogue', label: t('p5common.nav.catalogue') },
    { href: '/business-help', label: t('gov.nav.help') },
    { href: '/news', label: t('news.nav') },
  ];
  return (
    <nav aria-label={t('common.mainNav')} className="pub-nav">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className="nl" aria-current={path === i.href || path.startsWith(`${i.href}/`) ? 'page' : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

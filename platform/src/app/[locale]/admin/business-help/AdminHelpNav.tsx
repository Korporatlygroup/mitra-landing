import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

type Current = 'home' | 'sources' | 'pageChanges' | 'newProgramme';

/** Sub-navigation of the business-help administration. Links are hints; the database decides who may do what on each page. */
export default async function AdminHelpNav({ locale, current, canReview }: { locale: string; current: Current; canReview: boolean }) {
  const t = await getTranslations({ locale, namespace: 'gov.admin.nav' });
  const items: { key: Current; href: string; show: boolean }[] = [
    { key: 'home', href: '/admin/business-help', show: true },
    { key: 'sources', href: '/admin/business-help/sources', show: true },
    { key: 'pageChanges', href: '/admin/business-help/page-changes', show: true },
    { key: 'newProgramme', href: '/admin/business-help/programmes/new', show: canReview },
  ];
  return (
    <nav aria-label={t('label')} className="link-row">
      {items
        .filter((i) => i.show)
        .map((i) => (
          <Link key={i.key} href={i.href} locale={locale} className={i.key === current ? 'btn btn-primary' : 'btn btn-secondary'} aria-current={i.key === current ? 'page' : undefined}>
            {t(i.key)}
          </Link>
        ))}
    </nav>
  );
}

import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { CatalogueAdminContext } from '@/server/catalogue-admin-context';

export type CatalogueSection = 'home' | 'partners' | 'suppliers' | 'products' | 'reports' | 'imports';

/** Sub-navigation of the catalogue admin area. Shows only the screens the signed-in person may use. */
export default async function CatalogueAdminNav({ locale, ctx, current }: { locale: string; ctx: CatalogueAdminContext; current: CatalogueSection }) {
  const t = await getTranslations({ locale, namespace: 'p5admin.nav' });
  const items: { key: CatalogueSection; href: string; show: boolean }[] = [
    { key: 'home', href: '/admin/catalogue', show: true },
    { key: 'partners', href: '/admin/catalogue/partners', show: ctx.canManagePartners },
    { key: 'suppliers', href: '/admin/catalogue/suppliers', show: ctx.canReviewSuppliers },
    { key: 'products', href: '/admin/catalogue/products', show: ctx.canReviewProducts },
    { key: 'reports', href: '/admin/catalogue/reports', show: ctx.canModerate },
    { key: 'imports', href: '/admin/catalogue/imports', show: ctx.canStats },
  ];
  return (
    <nav aria-label={t('label')} className="adm-nav">
      {items
        .filter((i) => i.show)
        .map((i) => (
          <Link key={i.key} href={i.href} locale={locale} aria-current={i.key === current ? 'page' : undefined}>
            {t(i.key)}
          </Link>
        ))}
    </nav>
  );
}

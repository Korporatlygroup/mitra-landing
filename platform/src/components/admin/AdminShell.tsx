import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { signOutAction } from '@/app/[locale]/account/actions';
import Icon from '@/components/ui/Icon';
import Logo from '@/components/ui/Logo';
import { Link } from '@/i18n/navigation';
import { listListingQueue } from '@/server/services/directory';
import { adminListProducts } from '@/server/services/biz-products';
import { listMyMemberships } from '@/server/services/orgs';
import { getOptionalUser } from '@/server/session';
import { queueCounts } from '@/server/services/verification';
import AdminNav, { type AdminGroup } from './AdminNav';

/** Console shell for MITRA staff: dark menu with queue counts, then the page. Non-staff see the page as it is (it answers with its own refusal). */
export default async function AdminShell({ locale, children }: { locale: string; children: ReactNode }) {
  const { supabase, user } = await getOptionalUser();
  if (!supabase || !user) return <>{children}</>;
  const memberships = await listMyMemberships(supabase, user.id);
  if (!memberships.some((m) => m.org.type === 'mitra')) return <>{children}</>;
  const t = await getTranslations({ locale });

  const [verif, listings, products] = await Promise.all([queueCounts(supabase).catch(() => ({}) as Record<string, number>), listListingQueue(supabase, 'pending').catch(() => []), adminListProducts(supabase, 'in_review')]);
  const waiting = (verif.submitted ?? 0) + (verif.in_review ?? 0);
  const a = (k: string) => t(`adm.${k}`);

  const groups: AdminGroup[] = [
    {
      key: 'top',
      label: null,
      items: [
        { key: 'overview', href: '/admin', label: a('overview'), icon: 'home', match: [], exact: true },
        { key: 'appHome', href: '/', label: a('appHome'), icon: 'back', match: [], exact: true },
      ],
    },
    {
      key: 'review',
      label: a('gReview'),
      items: [
        { key: 'verification', href: '/admin/verification', label: a('verification'), icon: 'shield', match: ['/admin/verification'], count: waiting || undefined },
        { key: 'listings', href: '/admin/listings', label: a('listings'), icon: 'store', match: ['/admin/listings'], count: listings.length || undefined },
        { key: 'products', href: '/admin/products', label: a('products'), icon: 'box', match: ['/admin/products'], count: products.ok && products.data.length ? products.data.length : undefined },
        { key: 'reviews', href: '/admin/reviews', label: a('reviewsReports'), icon: 'flag', match: ['/admin/reviews', '/admin/reports'] },
      ],
    },
    {
      key: 'catalogue',
      label: a('gCatalogue'),
      // One entry point: the catalogue section has its own tab bar (CatalogueAdminNav) for partners/suppliers/products/reports/imports,
      // so repeating those here would duplicate every link on every catalogue page.
      items: [
        { key: 'cat', href: '/admin/catalogue', label: t('p5admin.nav.catalogue'), icon: 'layers', match: ['/admin/catalogue'] },
      ],
    },
    {
      key: 'content',
      label: a('gContent'),
      items: [
        { key: 'programmes', href: '/admin/business-help', label: a('programmes'), icon: 'target', match: ['/admin/business-help'] },
        { key: 'news', href: '/admin/news', label: a('news'), icon: 'news', match: ['/admin/news'] },
      ],
    },
    {
      key: 'system',
      label: a('gSystem'),
      items: [
        { key: 'users', href: '/admin/users', label: a('users'), icon: 'users', match: ['/admin/users'] },
        { key: 'audit', href: '/admin/audit', label: a('audit'), icon: 'list', match: ['/admin/audit'] },
        { key: 'privacy', href: '/admin/privacy-requests', label: a('privacyRequests'), icon: 'shield', match: ['/admin/privacy-requests'] },
        { key: 'public', href: '/', label: a('publicSite'), icon: 'globe', match: [], exact: true },
      ],
    },
  ];

  return (
    <div className="adm-shell">
      <aside className="ad-side" aria-label={a('label')}>
        <div className="ad-brand">
          <Logo locale={locale} inverted href="/admin" label={a('brand')} />
          <span>
            <strong>{a('brand')}</strong>
            <small>{a('sub')}</small>
          </span>
        </div>
        <AdminNav groups={groups} label={a('label')} />
        <div className="ad-signout">
          <form action={signOutAction}>
            <input type="hidden" name="locale" value={locale} />
            <button type="submit" className="al">
              <Icon name="logout" size={20} />
              <span>{t('nav.signOut')}</span>
            </button>
          </form>
          <Link href="/account" className="al">
            <Icon name="settings" size={20} />
            <span>{t('nav.account')}</span>
          </Link>
        </div>
      </aside>
      <div className="ad-main">{children}</div>
    </div>
  );
}

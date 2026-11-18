import { getTranslations } from 'next-intl/server';
import ProductReview from '@/components/admin/ProductReview';
import { pageTitle } from '@/lib/metadata';
import { adminListProducts } from '@/server/services/biz-products';
import { getRolePermissions } from '@/server/services/orgs';
import { requireSession } from '@/server/session';
import PageHeader from '@/components/shared/PageHeader';
import TabsNav from '@/components/shared/TabsNav';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'adm2.products.title');
}

export default async function AdminProductsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  const sp = await searchParams;
  const s = await requireSession({ locale, path: '/admin/products' });
  const t = await getTranslations({ locale });
  const mine = s.memberships.find((m) => m.org.type === 'mitra');
  const perms = mine ? await getRolePermissions(s.supabase, mine.role) : new Set<string>();
  if (!perms.has('listing:review')) {
    return (
      <>
        <PageHeader title={t('adm2.products.title')} />
        <p className="message message-error" role="alert">
          {t('adm2.products.noAccess')}
        </p>
      </>
    );
  }
  const live = sp.status === 'live';
  const res = await adminListProducts(s.supabase, live ? 'live' : 'in_review');
  const money = (c: number) => `RM ${(c / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const items = (res.ok ? res.data : []).map((p) => ({ ...p, statusLabel: p.status === 'in_review' ? t('claimStatus.in_review') : p.status === 'live' ? t('adm2.products.filterLive') : p.status, priceText: p.ask_for_quote || p.price_cents === null ? t('biz2.products.askQuote') : `${money(p.price_cents)}${p.unit ? ` / ${p.unit}` : ''}` }));
  return (
    <>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <PageHeader title={t('adm2.products.title')} sub={t('adm2.products.sub')} />
        </div>
      </div>
      <TabsNav label={t('adm2.products.title')} items={[{ href: '/admin/products', label: t('adm2.products.filterAll'), active: !live }, { href: '/admin/products?status=live', label: t('adm2.products.filterLive'), active: live }]} />
      {items.length === 0 ? <div className="empty"><strong>{t('adm2.products.none')}</strong></div> : <ProductReview items={items} />}
    </>
  );
}

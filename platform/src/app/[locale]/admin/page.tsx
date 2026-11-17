import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { adminListProducts } from '@/server/services/biz-products';
import { listListingQueue } from '@/server/services/directory';
import { adminListNews } from '@/server/services/news';
import { queueCounts } from '@/server/services/verification';
import { requireSession } from '@/server/session';
import { notFound } from 'next/navigation';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'adm2.overviewTitle');
}

export default async function AdminHomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const s = await requireSession({ locale, path: '/admin' });
  if (!s.memberships.some((m) => m.org.type === 'mitra')) notFound();
  const t = await getTranslations({ locale });
  const [verif, listings, products, news, proposals, switches] = await Promise.all([
    queueCounts(s.supabase).catch(() => ({}) as Record<string, number>),
    listListingQueue(s.supabase, 'pending').catch(() => []),
    adminListProducts(s.supabase, 'in_review'),
    adminListNews(s.supabase),
    s.supabase.from('gov_change_proposals').select('id', { count: 'exact', head: true }).in('status', ['pending', 'needs_info']),
    s.supabase.from('gov_settings').select('key, enabled'),
  ]);
  const sw = new Map((switches.data ?? []).map((r: { key: string; enabled: boolean }) => [r.key, r.enabled]));
  const tiles = [
    { href: '/admin/verification', label: t('adm2.tileVerification'), n: (verif.submitted ?? 0) + (verif.in_review ?? 0) },
    { href: '/admin/listings', label: t('adm2.tileListings'), n: listings.length },
    { href: '/admin/products', label: t('adm2.tileProducts'), n: products.ok ? products.data.length : 0 },
    { href: '/admin/business-help', label: t('adm2.tileProposals'), n: proposals.count ?? 0 },
    { href: '/admin/news', label: t('adm2.tileNews'), n: news.ok ? news.data.filter((p) => p.status === 'draft').length : 0 },
  ];
  return (
    <>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>{t('adm2.overviewTitle')}</h1>
          <p className="page-sub">{t('adm2.overviewSub')}</p>
        </div>
      </div>
      <div className="tiles">
        {tiles.map((x) => (
          <Link key={x.href} href={x.href} className="tile">
            <span className="mut" style={{ fontWeight: 700, fontSize: '0.875rem' }}>
              {x.label}
            </span>
            <span className="tile-n">{x.n}</span>
            <span style={{ color: 'var(--brand)', fontWeight: 700, fontSize: '0.875rem' }}>{t('adm2.open')}</span>
          </Link>
        ))}
      </div>
      <section className="acard" aria-labelledby="adm-sw">
        <h2 id="adm-sw" style={{ margin: 0, fontSize: '1.0625rem' }}>
          {t('adm2.switches')}
        </h2>
        <p style={{ margin: 0, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {([['publishing_enabled', 'swPublishing'], ['monitoring_enabled', 'swMonitoring'], ['notifications_enabled', 'swNotifications']] as const).map(([k, label]) => (
            <span key={k} className={`chip-x ${sw.get(k) ? 'green' : ''}`}>
              {t(`adm2.${label}`)}: {sw.get(k) ? t('adm2.on') : t('adm2.off')}
            </span>
          ))}
        </p>
        <Link href="/admin/business-help" className="dcard-go">
          {t('adm2.manage')}
        </Link>
      </section>
    </>
  );
}

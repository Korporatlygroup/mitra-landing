import { getTranslations } from 'next-intl/server';
import CardActions from '@/components/catalogue/CardActions';
import { pageCount } from '@/components/catalogue/helpers';
import ProductCard from '@/components/catalogue/ProductCard';
import QuickForm from '@/components/catalogue/QuickForm';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { listSavedProducts } from '@/server/services/p5-buyer';
import { requireSession } from '@/server/session';
import { unsaveProductAction } from '../actions';

const SAVED_PAGE_SIZE = 24;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5buyer.saved.title');
}

/**
 * Saved products. A product that is no longer shown (unpublished, paused, withdrawn) stays in the list with the name it had, marked as
 * not available: nothing disappears silently. It can be removed.
 */
export default async function SavedPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const rawPage = Number((await searchParams).page);
  const page = Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 500 ? rawPage : 1;
  const session = await requireSession({ locale, requireOrg: true, path: '/catalogue/saved' });
  const t = await getTranslations({ locale, namespace: 'p5buyer' });
  const r = await listSavedProducts(session.supabase, (page - 1) * SAVED_PAGE_SIZE);
  const pages = r.ok ? pageCount(r.data.total, SAVED_PAGE_SIZE) : 1;

  return (
    <>
      <h1>{t('saved.title')}</h1>
      <p>{t('saved.intro')}</p>
      {!r.ok ? (
        <p className="message message-error" role="alert">
          {t('saved.error')}
        </p>
      ) : r.data.items.length === 0 ? (
        <section aria-labelledby="sv-none-h">
          <h2 id="sv-none-h">{t('saved.emptyTitle')}</h2>
          <p>{t('saved.emptyBody')}</p>
          <p>
            <Link href="/catalogue" locale={locale} className="btn btn-primary">
              {t('compare.browse')}
            </Link>
          </p>
        </section>
      ) : (
        <>
          <p role="status">{t('saved.count', { n: r.data.total })}</p>
          <ul className="p5-grid catalogue-grid">
            {r.data.items.map((row) =>
              row.available ? (
                <ProductCard
                  key={row.product_id}
                  item={row.item}
                  locale={locale}
                  actions={<CardActions id={row.item.id} name={row.item.name} locale={locale} signedIn saved nextPath={`/${locale}/catalogue/saved`} />}
                />
              ) : (
                <li key={row.product_id} className="card catalogue-card catalogue-card-gone" data-product-id={row.product_id}>
                  <h2 className="catalogue-card-title">{row.name}</h2>
                  <p className="muted" style={{ margin: 0 }}>
                    {row.supplier_name}
                  </p>
                  <p style={{ margin: '8px 0' }}>
                    <span className="chip chip-bad">{t('saved.unavailableChip')}</span>
                  </p>
                  <p className="muted">{t('saved.unavailableBody')}</p>
                  <div className="catalogue-card-actions">
                    <QuickForm action={unsaveProductAction} fields={{ locale, productId: row.product_id }} label={t('save.remove')} srName={row.name} />
                  </div>
                </li>
              ),
            )}
          </ul>
          {pages > 1 ? (
            <nav aria-label={t('search.pages')} className="link-row catalogue-pages">
              {page > 1 ? (
                <Link href={`/catalogue/saved?page=${page - 1}`} locale={locale} className="btn btn-secondary">
                  {t('search.prev')}
                </Link>
              ) : null}
              <span>{t('search.pageOf', { page, pages })}</span>
              {page < pages ? (
                <Link href={`/catalogue/saved?page=${page + 1}`} locale={locale} className="btn btn-secondary">
                  {t('search.next')}
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}

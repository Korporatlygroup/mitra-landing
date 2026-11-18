import FilterSheet from '@/components/catalogue/FilterSheet';
import { getTranslations } from 'next-intl/server';
import CardActions from '@/components/catalogue/CardActions';
import { hasActiveFilters, pageCount, parseSearchFilters, searchQueryString, toServiceParams } from '@/components/catalogue/helpers';
import ProductCard from '@/components/catalogue/ProductCard';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { PRODUCT_CATEGORY_SLUGS, PRODUCT_CURRENCIES } from '@/lib/schemas';
import { CATALOGUE_PAGE_SIZE, searchCatalogue } from '@/server/services/p5-buyer';
import { getOptionalUser } from '@/server/session';
import { savedIdSet } from '../data';
import PageHeader from '@/components/shared/PageHeader';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5buyer.title');
}

/**
 * Products from India. Public: anyone may search. The database returns only approved, published products of approved suppliers
 * (nothing is filtered on the page), in a stable order, so page 2 continues exactly where page 1 ended.
 */
export default async function CataloguePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const f = parseSearchFilters(await searchParams);
  const [t, tc, t6, { supabase, user }] = await Promise.all([getTranslations({ locale, namespace: 'p5buyer' }), getTranslations({ locale, namespace: 'p5common' }), getTranslations({ locale, namespace: 'p6' }), getOptionalUser()]);

  // The search and the signed-in user's saved ids do not depend on each other: ask for both at once.
  const [result, saved] = await Promise.all([supabase ? searchCatalogue(supabase, toServiceParams(f, CATALOGUE_PAGE_SIZE)) : Promise.resolve(null), savedIdSet(supabase, Boolean(user))]);
  const data = result?.ok ? result.data : null;
  const pages = data ? pageCount(data.total, CATALOGUE_PAGE_SIZE) : 1;
  const filtered = hasActiveFilters(f);
  const nextPath = `/${locale}/catalogue${searchQueryString(f, { page: f.page })}`;
  const categories = [...new Set([...(data?.categories?.length ? data.categories : PRODUCT_CATEGORY_SLUGS), ...(f.category ? [f.category] : [])])].filter((c): c is (typeof PRODUCT_CATEGORY_SLUGS)[number] =>
    (PRODUCT_CATEGORY_SLUGS as readonly string[]).includes(c),
  );
  const supplierName = f.supplier ? data?.items.find((i) => i.supplier.id === f.supplier)?.supplier.name : undefined;
  const priceFailed = result && !result.ok && result.errorKey === 'currency_required';

  return (
    <>
      <PageHeader title={t('title')} sub={t('intro')} />
      <p><Link href="/sourcing/new" locale={locale} className="btn btn-primary">{t6('new')}</Link></p>
      <p className="muted">{tc('price.note')}</p>

      <FilterSheet label={t('search.filters')} active={filtered}>
      <form method="get" className="form catalogue-filters" role="search" aria-label={t('search.label')}>
        <div className="field">
          <label htmlFor="q">{t('search.q')}</label>
          <p className="hint" id="q-hint">
            {t('search.qHint')}
          </p>
          <input id="q" name="q" type="search" defaultValue={f.q ?? ''} maxLength={80} aria-describedby="q-hint" />
        </div>
        {f.supplier ? <input type="hidden" name="supplier" value={f.supplier} /> : null}
        <div className="catalogue-filter-grid">
          <div className="field">
            <label htmlFor="category">{t('search.category')}</label>
            <select id="category" name="category" defaultValue={f.category ?? ''}>
              <option value="">{t('search.anyCategory')}</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {tc(`categories.${c}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="moq_max">{t('search.moqMax')}</label>
            <p className="hint" id="moq-hint">
              {t('search.moqMaxHint')}
            </p>
            <input id="moq_max" name="moq_max" type="number" inputMode="numeric" min={1} step={1} defaultValue={f.moqMax ?? ''} aria-describedby="moq-hint" />
          </div>
        </div>
        <fieldset className="catalogue-price-filter">
          <legend>{t('search.priceLegend')}</legend>
          <p className="hint" id="price-hint">
            {t('search.priceHint')}
          </p>
          <div className="catalogue-filter-grid">
            <div className="field">
              <label htmlFor="currency">{t('search.currency')}</label>
              <select id="currency" name="currency" defaultValue={f.currency ?? ''} aria-describedby="price-hint">
                <option value="">{t('search.anyCurrency')}</option>
                {PRODUCT_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {tc(`currencies.${c}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="price_min">{t('search.priceMin')}</label>
              <input id="price_min" name="price_min" type="text" inputMode="decimal" defaultValue={f.priceMin ?? ''} maxLength={14} autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="price_max">{t('search.priceMax')}</label>
              <input id="price_max" name="price_max" type="text" inputMode="decimal" defaultValue={f.priceMax ?? ''} maxLength={14} autoComplete="off" />
            </div>
          </div>
        </fieldset>
        {f.priceNeedsCurrency || priceFailed ? (
          <p className="message message-warn" role="status">
            {t('search.needCurrency')}
          </p>
        ) : null}
        <div className="link-row">
          <button type="submit" className="btn btn-primary">
            {t('search.apply')}
          </button>
          {filtered ? (
            <Link href="/catalogue" locale={locale} className="btn btn-secondary">
              {t('search.clear')}
            </Link>
          ) : null}
        </div>
      </form>
      </FilterSheet>

      {f.supplier ? (
        <p className="catalogue-active-filter">
          <span className="chip">{t('search.onlySupplier', { name: supplierName ?? t('search.thisSupplier') })}</span>{' '}
          <Link href={`/catalogue${searchQueryString(f, { supplier: undefined, page: 1 })}`} locale={locale}>
            {t('search.removeSupplier')}
          </Link>
        </p>
      ) : null}

      {!data ? (
        <section role="alert" aria-labelledby="err-h">
          <h2 id="err-h">{t('search.errorTitle')}</h2>
          <p>{t('search.errorBody')}</p>
          <p>
            <Link href={`/catalogue${searchQueryString(f)}`} locale={locale} className="btn btn-secondary">
              {t('search.retry')}
            </Link>
          </p>
        </section>
      ) : data.items.length === 0 && data.total > 0 ? (
        <section aria-labelledby="none-h">
          <h2 id="none-h">{t('search.pageEmptyTitle')}</h2>
          <p>
            <Link href={`/catalogue${searchQueryString(f, { page: 1 })}`} locale={locale} className="btn btn-secondary">
              {t('search.firstPage')}
            </Link>
          </p>
        </section>
      ) : data.items.length === 0 ? (
        <section aria-labelledby="none-h">
          <h2 id="none-h">{filtered ? t('search.noneTitle') : t('search.emptyCatalogueTitle')}</h2>
          <p>{filtered ? t('search.noneBody') : t('search.emptyCatalogueBody')}</p>
          {filtered ? (
            <ul>
              <li>{t('search.tipFewerFilters')}</li>
              <li>{t('search.tipOtherWords')}</li>
              <li>{t('search.tipPrice')}</li>
              <li>
                <Link href="/catalogue" locale={locale}>
                  {t('search.clearAll')}
                </Link>
              </li>
            </ul>
          ) : null}
        </section>
      ) : (
        <>
          <p role="status" aria-live="polite" className="catalogue-count">
            {t('search.count', { n: data.total })}
          </p>
          <ul className="p5-grid catalogue-grid">
            {data.items.map((item) => (
                <ProductCard
                  key={item.id}
                  item={item}
                  locale={locale}
                  supplierHref={`/catalogue${searchQueryString({ supplier: item.supplier.id })}`}
                  actions={<CardActions id={item.id} name={item.name} locale={locale} signedIn={Boolean(user)} saved={saved.has(item.id)} nextPath={nextPath} />}
                />
            ))}
          </ul>
          {pages > 1 ? (
            <nav aria-label={t('search.pages')} className="link-row catalogue-pages">
              {f.page > 1 ? (
                <Link href={`/catalogue${searchQueryString(f, { page: f.page - 1 })}`} locale={locale} className="btn btn-secondary" rel="prev">
                  {t('search.prev')}
                </Link>
              ) : null}
              <span>{t('search.pageOf', { page: f.page, pages })}</span>
              {f.page < pages ? (
                <Link href={`/catalogue${searchQueryString(f, { page: f.page + 1 })}`} locale={locale} className="btn btn-secondary" rel="next">
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

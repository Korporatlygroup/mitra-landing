import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { CompareSync } from '@/components/catalogue/CompareControls';
import { buildCompareModel, compareHref, parseCompareIds, priceText, specValue } from '@/components/catalogue/helpers';
import { PriceTierList, VerificationNote } from '@/components/catalogue/Notes';
import { Link } from '@/i18n/navigation';
import { formatDate, leadTimeLabel } from '@/lib/p5-format';
import { pageTitle } from '@/lib/metadata';
import { compareItems } from '@/server/services/p5-buyer';
import type { CatalogueItemDetail } from '@/server/services/p5-types';
import { getOptionalUser } from '@/server/session';
import EmptyState from '@/components/shared/EmptyState';
import PageHeader from '@/components/shared/PageHeader';

function Row({
  label,
  differs,
  diffLabel,
  items,
  children,
}: {
  label: string;
  differs?: boolean;
  diffLabel: string;
  items: CatalogueItemDetail[];
  children: (i: CatalogueItemDetail) => ReactNode;
}) {
  return (
    <tr className={differs ? 'compare-differs' : undefined}>
      <th scope="row">
        {label}
        {differs ? <span className="p5b-diff"> ({diffLabel})</span> : null}
      </th>
      {items.map((i) => (
        <td key={i.id} data-label={i.name}>
          {children(i)}
        </td>
      ))}
    </tr>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5buyer.compare.title');
}

/**
 * Side-by-side comparison of up to four products. Only values the suppliers gave are compared: a missing value says "Not provided".
 * Prices stay in their own currency, are labelled with it, and are never converted or ranked against each other.
 */
export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const ids = parseCompareIds((await searchParams).ids);
  const t = await getTranslations({ locale, namespace: 'p5buyer' });
  const tc = await getTranslations({ locale, namespace: 'p5common' });
  const { supabase } = await getOptionalUser();

  const result = ids.length >= 1 && supabase ? await compareItems(supabase, ids) : null;
  const items = result?.ok ? result.data.items : [];
  const gone = result?.ok ? result.data.unavailable.length : 0;
  const model = buildCompareModel(items);
  const np = t('compare.notProvided');
  const leadOf = (i: (typeof items)[number]) => leadTimeLabel((k, v) => tc(k, v), i.lead_time_min_days, i.lead_time_max_days);

  const diffLabel = t('compare.differs');

  return (
    <>
      <PageHeader title={t('compare.title')} />
      <p>
        <Link href="/catalogue" locale={locale}>
          {t('detail.back')}
        </Link>
      </p>

      {!result || (result.ok && items.length === 0) || !result.ok ? (
        <EmptyState icon="list" title={result && !result.ok ? t('compare.errorTitle') : t('compare.emptyTitle')} text={result && !result.ok ? t('compare.errorBody') : gone > 0 ? t('compare.allGone') : t('compare.emptyBody')} action={{ href: '/catalogue', label: t('compare.browse') }} />
      ) : (
        <>
          <CompareSync entries={items.map((i) => ({ id: i.id, name: i.name }))} />
          {gone > 0 ? (
            <p className="message message-warn" role="status">
              {t('compare.someGone', { n: gone })}
            </p>
          ) : null}
          {items.length < 2 ? <p className="message message-warn">{t('compare.needTwo')}</p> : null}
          {model.mixedCurrencies ? (
            <p className="message message-warn" role="note">
              {t('compare.mixedCurrencies', { currencies: model.currencies.join(', ') })}
            </p>
          ) : null}
          <p className="muted">{t('compare.note')}</p>

          <ul className="compare-products" aria-label={t('compare.products')}>
            {items.map((i) => (
              <li key={i.id} className="card">
                <Link href={`/catalogue/${i.id}`} locale={locale}>
                  {i.name}
                </Link>
                <span className="muted"> · {i.supplier.name}</span>
                <Link
                  href={compareHref(items.filter((x) => x.id !== i.id).map((x) => x.id))}
                  locale={locale}
                  className="btn btn-secondary"
                  aria-label={t('compare.removeOne', { name: i.name })}
                >
                  {t('compare.remove')}
                </Link>
              </li>
            ))}
          </ul>

          <div className="table-wrap" role="region" aria-label={t('compare.tableRegion')} tabIndex={0}>
            <table className="compare-table">
              <caption className="p5b-sr">{t('compare.title')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('compare.attribute')}</th>
                  {items.map((i) => (
                    <th scope="col" key={i.id}>
                      {i.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <Row items={items} diffLabel={diffLabel} label={tc('labels.supplier')} differs={model.differs.supplier}>
                  {(i) => (
                    <>
                      {i.supplier.name}
                      <br />
                      <span className="muted">{[i.supplier.state_city, i.supplier.country].filter(Boolean).join(', ') || np}</span>
                    </>
                  )}
                </Row>
                <Row items={items} diffLabel={diffLabel} label={t('compare.reviewed')}>{(i) => <VerificationNote reviewed={i.supplier.reviewed} locale={locale} showScope={false} />}</Row>
                <Row items={items} diffLabel={diffLabel} label={t('compare.category')} differs={model.differs.category}>
                  {(i) => tc(`categories.${i.category_slug}`)}
                </Row>
                <Row items={items} diffLabel={diffLabel} label={tc('labels.sku')}>{(i) => i.sku}</Row>
                <Row items={items} diffLabel={diffLabel} label={tc('labels.moq')} differs={model.differs.moq}>
                  {(i) => `${i.moq} ${tc(`units.${i.unit}`)}`}
                </Row>
                <Row items={items} diffLabel={diffLabel} label={t('compare.variants')}>{(i) => (i.variants.length > 0 ? i.variants.map((v) => v.label).join(', ') : np)}</Row>
                <Row items={items} diffLabel={diffLabel} label={t('compare.currency')} differs={model.differs.currency}>
                  {(i) => tc(`currencies.${i.currency}`)}
                </Row>
                <Row items={items} diffLabel={diffLabel} label={t('compare.price')}>
                  {(i) =>
                    i.price_mode === 'fixed' && i.from_price != null ? (
                      `${tc('price.fixed')}: ${priceText(i.from_price, i.currency, locale)}`
                    ) : i.price_mode === 'request' || i.tiers.length === 0 ? (
                      tc('price.onRequest')
                    ) : (
                      <PriceTierList tiers={i.tiers} currency={i.currency} variants={i.variants} locale={locale} />
                    )
                  }
                </Row>
                <Row items={items} diffLabel={diffLabel} label={t('compare.priceDate')}>{(i) => (i.price_confirmed_on ? formatDate(i.price_confirmed_on, locale) : np)}</Row>
                <Row items={items} diffLabel={diffLabel} label={tc('labels.leadTime')} differs={model.differs.leadTime}>
                  {(i) => leadOf(i) ?? np}
                </Row>
                <Row items={items} diffLabel={diffLabel} label={t('compare.availability')} differs={model.differs.availability}>
                  {(i) => (
                    <>
                      {tc(`availability.${i.availability_status}`)}
                      <br />
                      <span className="muted">
                        {i.availability_confirmed_on ? tc('availability.confirmedOn', { date: formatDate(i.availability_confirmed_on, locale) }) : np}
                      </span>
                      {i.availability_outdated && i.availability_confirmed_on ? (
                        <>
                          <br />
                          <span className="p5b-diff">{t('compare.outdated')}</span>
                        </>
                      ) : null}
                    </>
                  )}
                </Row>
                {model.specKeys.map((k) => (
                  <Row key={`spec-${k}`} items={items} diffLabel={diffLabel} label={k} differs={new Set(items.map((i) => specValue(i, k) ?? '')).size > 1}>
                    {(i) => specValue(i, k) ?? np}
                  </Row>
                ))}
                <Row items={items} diffLabel={diffLabel} label={t('detail.packaging')}>{(i) => i.packaging || np}</Row>
                <Row items={items} diffLabel={diffLabel} label={t('compare.actions')}>
                  {(i) => (
                    <Link href={`/catalogue/${i.id}/request`} locale={locale} className="btn btn-primary" aria-label={`${tc('buttons.requestPrice')}: ${i.name}`}>
                      {tc('buttons.requestPrice')}
                    </Link>
                  )}
                </Row>
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

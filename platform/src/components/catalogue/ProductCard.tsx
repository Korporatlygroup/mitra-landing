import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { leadTimeLabel } from '@/lib/p5-format';
import type { CatalogueItem } from '@/server/services/p5-types';
import { AvailabilityNote, PriceSummary } from './Notes';

/** Catalogue image through the access-checked media route (the route asks the database every time). */
export function ProductImage({ id, alt, className = 'p5-thumb' }: { id: string | null; alt: string; className?: string }) {
  if (!id) return <div className={`${className} catalogue-noimage`} role="img" aria-label={alt} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={`/api/v1/catalogue-media/${id}`} alt={alt} width={640} height={480} loading="lazy" decoding="async" />;
}

/**
 * One product in a list: image, name, supplier and place, minimum order, indicative price with its date, availability statement.
 * `actions` is rendered under the details (Save, Compare, Request Price on the buyer pages). `href` null = no link (previews).
 */
export default async function ProductCard({
  item,
  locale,
  actions,
  href,
  headingLevel = 2,
  supplierHref,
}: {
  item: CatalogueItem;
  locale: string;
  actions?: ReactNode;
  href?: string | null;
  headingLevel?: 2 | 3;
  supplierHref?: string | null;
}) {
  const t = await getTranslations({ locale, namespace: 'p5buyer' });
  const tc = await getTranslations({ locale, namespace: 'p5common' });
  const H = (`h${headingLevel}`) as 'h2' | 'h3';
  const target = href === undefined ? `/catalogue/${item.id}` : href;
  const place = [item.supplier.state_city, item.supplier.country].filter(Boolean).join(', ');
  const lead = leadTimeLabel((k, v) => tc(k, v), item.lead_time_min_days, item.lead_time_max_days);
  return (
    <li className="card catalogue-card" data-product-id={item.id}>
      <ProductImage id={item.image_id} alt={t('card.imageAlt', { name: item.name })} />
      <H className="catalogue-card-title">{target ? <Link href={target} locale={locale}>{item.name}</Link> : item.name}</H>
      <p className="muted" style={{ margin: 0 }}>
        {supplierHref ? (
          <Link href={supplierHref} locale={locale}>
            {item.supplier.name}
          </Link>
        ) : (
          item.supplier.name
        )}
        {place ? ` · ${place}` : null}
      </p>
      <p className="muted" style={{ margin: 0 }}>
        {tc(`categories.${item.category_slug}`)}
        {item.summary ? ` · ${item.summary}` : null}
      </p>
      <dl className="dl catalogue-facts">
        <dt>{tc('labels.moq')}</dt>
        <dd>
          {item.moq} {tc(`units.${item.unit}`)}
        </dd>
        {lead ? (
          <>
            <dt>{tc('labels.leadTime')}</dt>
            <dd>{lead}</dd>
          </>
        ) : null}
      </dl>
      <PriceSummary priceMode={item.price_mode} fromPrice={item.from_price} currency={item.currency} unit={item.unit} confirmedOn={item.price_confirmed_on} locale={locale} />
      <AvailabilityNote status={item.availability_status} confirmedOn={item.availability_confirmed_on} outdated={item.availability_outdated} locale={locale} />
      {actions ? <div className="catalogue-card-actions">{actions}</div> : null}
    </li>
  );
}

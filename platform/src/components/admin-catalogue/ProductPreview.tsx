import { getTranslations } from 'next-intl/server';
import { formatDate, formatMoney, leadTimeLabel } from '@/lib/p5-format';
import type { Currency, ProductData } from '@/server/services/p5-types';

const CURRENCIES = ['INR', 'MYR', 'USD'];

/**
 * A reviewer's preview of a product as buyers would see it: the same wording and labels as the public catalogue (p5common), but built
 * from the submitted revision, so it also works before the product is published. No supplier contact data is ever shown here.
 */
export default async function ProductPreview({
  locale,
  data,
  supplierName,
  images,
}: {
  locale: string;
  data: ProductData;
  supplierName: string | null;
  images: { id: string; alt: string | null }[];
}) {
  const c = await getTranslations({ locale, namespace: 'p5common' });
  const t = await getTranslations({ locale, namespace: 'p5admin.products.preview' });
  const cur: Currency | null = data.currency && CURRENCIES.includes(data.currency) ? data.currency : null;
  const money = (v: string | number) => (cur ? formatMoney(v, cur, locale) : String(v));
  const cT = (k: string, v?: Record<string, string | number>) => c(k as never, v as never);
  const lead = leadTimeLabel(
    cT,
    data.lead_time_min_days === undefined ? null : Number(data.lead_time_min_days),
    data.lead_time_max_days === undefined ? null : Number(data.lead_time_max_days),
  );
  const tiers = data.tiers ?? [];
  const variants = data.variants ?? [];
  const specs = Object.entries(data.specs ?? {});
  const unit = data.unit ? (c.has(`units.${data.unit}` as never) ? c(`units.${data.unit}` as never) : data.unit) : null;
  const lowest = tiers.length > 0 ? [...tiers].map((x) => x.unit_price).sort((a, b) => Number(a) - Number(b))[0]! : null;

  return (
    <article className="card adm-preview" aria-label={t('label')} data-testid="product-preview">
      {images.length > 0 ? (
        <ul className="p5-grid" aria-label={t('images')}>
          {images.map((m) => (
            <li key={m.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="p5-thumb" src={`/api/v1/catalogue-media/${m.id}`} alt={m.alt ?? ''} width={320} height={240} loading="lazy" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{t('noImages')}</p>
      )}
      <h3>{data.name ?? '-'}</h3>
      <p className="muted" style={{ margin: 0 }}>
        {c('labels.supplier')}: {supplierName ?? '-'}
      </p>
      <p className="p5-price" style={{ margin: '8px 0' }}>
        {data.price_mode === 'request'
          ? c('price.onRequest')
          : data.price_mode === 'fixed' && data.unit_price
            ? money(data.unit_price)
            : data.price_mode === 'tiers' && lowest !== null
              ? c('price.from', { price: money(lowest) })
              : '-'}
        {unit ? <span className="muted"> / {unit}</span> : null}
      </p>
      {data.price_confirmed_on ? <p className="muted" style={{ margin: 0 }}>{c('price.confirmedOn', { date: formatDate(data.price_confirmed_on, locale) })}</p> : null}
      <dl className="dl">
        <dt>{c('labels.sku')}</dt>
        <dd>{data.sku ?? '-'}</dd>
        {data.category_slug ? (
          <>
            <dt>{t('category')}</dt>
            <dd>{c.has(`categories.${data.category_slug}` as never) ? c(`categories.${data.category_slug}` as never) : data.category_slug}</dd>
          </>
        ) : null}
        <dt>{c('labels.moq')}</dt>
        <dd>{data.moq ?? '-'}</dd>
        {lead ? (
          <>
            <dt>{c('labels.leadTime')}</dt>
            <dd>{lead}</dd>
          </>
        ) : null}
        {data.availability_status ? (
          <>
            <dt>{t('availability')}</dt>
            <dd>
              {c(`availability.${data.availability_status}` as never)}
              {data.availability_confirmed_on ? <> &middot; {c('availability.confirmedOn', { date: formatDate(data.availability_confirmed_on, locale) })}</> : null}
            </dd>
          </>
        ) : null}
        {data.packaging ? (
          <>
            <dt>{t('packaging')}</dt>
            <dd>{data.packaging}</dd>
          </>
        ) : null}
      </dl>
      {data.description ? <p>{data.description}</p> : null}
      {tiers.length > 0 ? (
        <>
          <h4>{c('price.tiers')}</h4>
          <ul>
            {tiers.map((x, i) => (
              <li key={i}>
                {x.max_qty === null ? t('tierOpen', { min: x.min_qty }) : t('tierRange', { min: x.min_qty, max: x.max_qty })}: {money(x.unit_price)}
                {x.variant_sku ? <> ({x.variant_sku})</> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {variants.length > 0 ? (
        <>
          <h4>{t('variants')}</h4>
          <ul>
            {variants.map((v) => (
              <li key={v.sku}>
                {v.label} ({v.sku})
                {v.moq ? (
                  <>
                    {' '}
                    &middot; {c('labels.moq')}: {v.moq}
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {specs.length > 0 ? (
        <>
          <h4>{t('specs')}</h4>
          <dl className="dl">
            {specs.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
      <p className="muted">{c('price.note')}</p>
    </article>
  );
}

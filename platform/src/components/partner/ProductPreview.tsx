import { getTranslations } from 'next-intl/server';
import { formatDate, formatMoney, leadTimeLabel, reviewedSummary } from '@/lib/p5-format';
import type { Currency, MyProductMedia, ProductData, SupplierReviewCheck } from '@/server/services/p5-types';

/**
 * Read-only view of how the product will look to a buyer once it is approved and published (same facts, same wording rules: indicative
 * prices with a confirmation date, availability as a statement, supplier review wording from the stored checks only). Built from the draft.
 * Money is formatted for display only.
 */
export default async function ProductPreview({
  locale,
  draft,
  supplier,
  media,
}: {
  locale: string;
  draft: ProductData;
  supplier: { name: string | null; country: string | null; state_city: string | null; checks: SupplierReviewCheck[] | null; reviewed_at: string | null };
  media: MyProductMedia[];
}) {
  const t = await getTranslations({ locale, namespace: 'p5partner.preview' });
  const tc = await getTranslations({ locale, namespace: 'p5common' });
  const cur = (draft.currency ?? 'INR') as Currency;
  const tiers = draft.tiers ?? [];
  const variants = draft.variants ?? [];
  const lead = leadTimeLabel(tc as never, draft.lead_time_min_days != null ? Number(draft.lead_time_min_days) : null, draft.lead_time_max_days != null ? Number(draft.lead_time_max_days) : null);
  const money = (v: string | number) => formatMoney(v, cur, locale);
  const fromPrice =
    draft.price_mode === 'fixed' && draft.unit_price != null
      ? money(draft.unit_price)
      : draft.price_mode === 'tiers' && tiers.length > 0
        ? money(tiers.reduce((lo, r) => (Number(r.unit_price) < Number(lo) ? r.unit_price : lo), tiers[0]!.unit_price))
        : null;
  const images = media.filter((m) => m.scan_status === 'clean');

  return (
    <article aria-label={t('articleLabel')} className="card preview" data-testid="product-preview">
      <p className="banner">{t('banner')}</p>
      <h2 style={{ marginTop: '1rem' }}>{draft.name ?? t('noName')}</h2>
      <p className="muted">
        {tc('labels.sku')}: {draft.sku ?? '-'} {draft.category_slug ? `· ${tc(`categories.${draft.category_slug}`)}` : ''}
      </p>
      {images.length > 0 ? (
        <ul className="p5-grid">
          {images.map((m) => (
            <li key={m.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="p5-thumb" src={`/api/v1/catalogue-media/${m.id}`} alt={m.alt ?? ''} width={320} height={240} loading="lazy" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">{t('noImages')}</p>
      )}
      <p className="p5-price" style={{ fontSize: '1.3rem' }}>
        {draft.price_mode === 'request' || !fromPrice ? tc('price.onRequest') : tc('price.from', { price: fromPrice })}
        {draft.unit ? <span className="muted"> / {tc(`units.${draft.unit}`)}</span> : null}
      </p>
      <p className="hint">{tc('price.note')}</p>
      {draft.price_confirmed_on ? <p className="hint">{tc('price.confirmedOn', { date: formatDate(draft.price_confirmed_on, locale) })}</p> : null}

      <dl className="dl">
        <dt>{tc('labels.moq')}</dt>
        <dd>
          {draft.moq ?? '-'} {draft.unit ? tc(`units.${draft.unit}`) : ''}
        </dd>
        <dt>{tc('labels.leadTime')}</dt>
        <dd>{lead ?? '-'}</dd>
        <dt>{t('availability')}</dt>
        <dd>
          {draft.availability_status ? tc(`availability.${draft.availability_status}`) : '-'}
          {draft.availability_confirmed_on ? <span className="muted"> ({tc('availability.confirmedOn', { date: formatDate(draft.availability_confirmed_on, locale) })})</span> : null}
        </dd>
        <dt>{tc('labels.supplier')}</dt>
        <dd>{supplier.name ?? '-'}</dd>
        <dt>{tc('labels.country')}</dt>
        <dd>{[supplier.country, supplier.state_city].filter(Boolean).join(', ') || '-'}</dd>
        {draft.packaging ? (
          <>
            <dt>{t('packaging')}</dt>
            <dd>{draft.packaging}</dd>
          </>
        ) : null}
      </dl>
      <p className="hint">{reviewedSummary(tc as never, { checks: supplier.checks, reviewed_at: supplier.reviewed_at }, locale)}</p>

      {draft.description ? (
        <>
          <h3>{t('description')}</h3>
          <p style={{ whiteSpace: 'pre-line' }}>{draft.description}</p>
        </>
      ) : null}

      {draft.price_mode === 'tiers' && tiers.length > 0 ? (
        <>
          <h3>{t('tiers')}</h3>
          <div className="table-wrap">
            <table className="stack">
              <thead>
                <tr>
                  {variants.length > 0 ? <th scope="col">{t('variant')}</th> : null}
                  <th scope="col">{t('quantity')}</th>
                  <th scope="col">{t('unitPrice')}</th>
                </tr>
              </thead>
              <tbody>
                {tiers.map((r, i) => (
                  <tr key={i}>
                    {variants.length > 0 ? <td data-label={t('variant')}>{r.variant_sku ?? t('allVariants')}</td> : null}
                    <td data-label={t('quantity')}>{r.max_qty == null ? t('orMore', { min: r.min_qty }) : t('range', { min: r.min_qty, max: r.max_qty })}</td>
                    <td data-label={t('unitPrice')}>{money(r.unit_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {variants.length > 0 ? (
        <>
          <h3>{t('variants')}</h3>
          <ul>
            {variants.map((v) => (
              <li key={v.sku}>
                <strong>{v.label}</strong> ({v.sku}){Object.keys(v.attributes ?? {}).length ? ` - ${Object.entries(v.attributes).map(([k, x]) => `${k}: ${x}`).join(', ')}` : ''}
                {v.moq ? ` - ${tc('labels.moq')}: ${v.moq}` : ''}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {Object.keys(draft.specs ?? {}).length > 0 ? (
        <>
          <h3>{t('specs')}</h3>
          <dl className="dl">
            {Object.entries(draft.specs ?? {}).map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
    </article>
  );
}

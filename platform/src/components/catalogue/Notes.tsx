import { getTranslations } from 'next-intl/server';
import { formatDate, reviewedSummary } from '@/lib/p5-format';
import type { AvailabilityStatus, CatalogueTier, CatalogueVariant, Currency, PriceMode, SupplierReviewCheck } from '@/server/services/p5-types';
import { groupTiers, priceText } from './helpers';

/**
 * Reusable display pieces for catalogue products (buyer pages, and the partner "preview as a buyer" screen):
 * PriceTiers, PriceSummary, VerificationNote, AvailabilityNote. All server components; text from p5common/p5buyer.
 */

/** Indicative price tiers as a table per option (variant). Amounts are shown exactly as stored, in their own currency. */
export async function PriceTiers({
  tiers,
  currency,
  unit,
  variants = [],
  locale,
}: {
  tiers: CatalogueTier[];
  currency: Currency;
  unit?: string | null;
  variants?: Pick<CatalogueVariant, 'sku' | 'label'>[];
  locale: string;
}) {
  const t = await getTranslations({ locale, namespace: 'p5buyer' });
  const tc = await getTranslations({ locale, namespace: 'p5common' });
  if (tiers.length === 0) return <p className="muted">{tc('price.onRequest')}</p>;
  const groups = groupTiers(tiers, variants);
  const unitLabel = unit ? tc(`units.${unit}`) : null;
  return (
    <div className="price-tiers">
      {groups.map((g) => (
        <div className="table-wrap" key={g.variantSku ?? 'all'} tabIndex={0} role="region" aria-label={g.variantLabel ? t('tiers.captionVariant', { variant: g.variantLabel, currency }) : t('tiers.caption', { currency })}>
          <table className="price-tier-table">
            <caption>
              {g.variantLabel ? t('tiers.captionVariant', { variant: g.variantLabel, currency }) : t('tiers.caption', { currency })}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t('tiers.quantity')}</th>
                <th scope="col">{unitLabel ? t('tiers.priceEachUnit', { unit: unitLabel }) : t('tiers.priceEach')}</th>
              </tr>
            </thead>
            <tbody>
              {g.tiers.map((x) => (
                <tr key={`${x.variant_sku ?? ''}-${x.min_qty}`}>
                  <td>{x.max_qty == null ? t('tiers.openEnded', { min: x.min_qty }) : t('tiers.range', { min: x.min_qty, max: x.max_qty })}</td>
                  <td>
                    <strong>{priceText(x.unit_price, x.currency ?? currency, locale)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/** The same tiers as a compact list (used inside the comparison table, where a table in a cell would be too wide on a phone). */
export async function PriceTierList({
  tiers,
  currency,
  variants = [],
  locale,
}: {
  tiers: CatalogueTier[];
  currency: Currency;
  variants?: Pick<CatalogueVariant, 'sku' | 'label'>[];
  locale: string;
}) {
  const t = await getTranslations({ locale, namespace: 'p5buyer' });
  return (
    <>
      {groupTiers(tiers, variants).map((g) => (
        <div key={g.variantSku ?? 'all'} className="tier-list">
          {g.variantLabel ? <strong>{g.variantLabel}</strong> : null}
          <ul>
            {g.tiers.map((x) => (
              <li key={`${x.variant_sku ?? ''}-${x.min_qty}`}>
                {x.max_qty == null ? t('tiers.openEnded', { min: x.min_qty }) : t('tiers.range', { min: x.min_qty, max: x.max_qty })}:{' '}
                <strong>{priceText(x.unit_price, x.currency ?? currency, locale)}</strong>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

/** One-line price statement: "From INR 450.00 / piece", "One price: ...", or "Price on request", with the confirmed date. */
export async function PriceSummary({
  priceMode,
  fromPrice,
  currency,
  unit,
  confirmedOn,
  locale,
}: {
  priceMode: PriceMode;
  fromPrice: string | number | null;
  currency: Currency;
  unit?: string | null;
  confirmedOn: string | null;
  locale: string;
}) {
  const t = await getTranslations({ locale, namespace: 'p5buyer' });
  const tc = await getTranslations({ locale, namespace: 'p5common' });
  const hasPrice = priceMode !== 'request' && fromPrice !== null && fromPrice !== undefined;
  const money = hasPrice ? priceText(fromPrice, currency, locale) : null;
  const unitLabel = unit ? tc(`units.${unit}`) : null;
  return (
    <div className="price-summary">
      <p className="p5-price" style={{ margin: 0 }}>
        {money ? (
          <>
            {priceMode === 'tiers' ? tc('price.from', { price: money }) : `${tc('price.fixed')}: ${money}`}
            {unitLabel ? <span className="muted"> {t('card.perUnit', { unit: unitLabel })}</span> : null}
          </>
        ) : (
          tc('price.onRequest')
        )}
      </p>
      <p className="muted" style={{ margin: 0 }}>
        {money ? `${t('card.indicative')} ` : null}
        {confirmedOn ? tc('price.confirmedOn', { date: formatDate(confirmedOn, locale) }) : t('card.priceDateMissing')}
      </p>
    </div>
  );
}

/** What MITRA reviewed and when (built from the stored checks, never "trusted"), plus the scope sentence. */
export async function VerificationNote({
  reviewed,
  locale,
  showScope = true,
}: {
  reviewed: { checks: SupplierReviewCheck[]; reviewed_at: string } | null;
  locale: string;
  showScope?: boolean;
}) {
  const tc = await getTranslations({ locale, namespace: 'p5common' });
  const text = reviewedSummary(tc, reviewed, locale);
  return (
    <div className="verification-note">
      <p style={{ margin: 0 }}>{text}</p>
      {showScope && reviewed ? (
        <p className="muted" style={{ margin: '4px 0 0' }}>
          {tc('verification.scope')}
        </p>
      ) : null}
    </div>
  );
}

/** Availability as a statement with its date. Never live stock; an old confirmation says so. */
export async function AvailabilityNote({
  status,
  confirmedOn,
  outdated,
  locale,
}: {
  status: AvailabilityStatus;
  confirmedOn: string | null;
  outdated: boolean;
  locale: string;
}) {
  const t = await getTranslations({ locale, namespace: 'p5buyer' });
  const tc = await getTranslations({ locale, namespace: 'p5common' });
  return (
    <div className="availability-note">
      <p style={{ margin: 0 }}>
        <strong>{tc(`availability.${status}`)}</strong>
      </p>
      <p className="muted" style={{ margin: 0 }}>
        {confirmedOn ? tc('availability.confirmedOn', { date: formatDate(confirmedOn, locale) }) : t('card.availabilityDateMissing')}
      </p>
      {outdated && confirmedOn ? (
        <p className="message message-warn" style={{ margin: '4px 0 0' }}>
          {tc('availability.outdated', { date: formatDate(confirmedOn, locale) })}
        </p>
      ) : null}
    </div>
  );
}

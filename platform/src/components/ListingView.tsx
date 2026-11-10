import { getFormatter, getTranslations } from 'next-intl/server';
import type { ReviewedClaim, ServiceDetail } from '@/server/services/directory';

export interface ListingViewData {
  name: string;
  category: { name_en: string; name_ta: string } | null;
  state: string | null;
  district: string | null;
  headline: string | null;
  description: string | null;
  phone: string | null;
  email: string | null;
  reviewed: ReviewedClaim[];
  accepting_requests: boolean;
  service_details: ServiceDetail[];
  portfolio: { title: string; description: string | null }[];
}

/** The public business profile. Used by the public page, the owner preview and the moderation review. Never shows a street address. */
export default async function ListingView({ data, locale, headingLevel = 1 }: { data: ListingViewData; locale: string; headingLevel?: 1 | 2 }) {
  const t = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  const H = headingLevel === 1 ? 'h1' : 'h2';
  const place = [data.district, data.state].filter(Boolean).join(', ');
  const reviewed = data.reviewed.filter((c) => c.decided_at);

  return (
    <article aria-labelledby="listing-name">
      <H id="listing-name">{data.name}</H>
      <p className="muted">
        {data.category ? (locale === 'ta' ? data.category.name_ta : data.category.name_en) : null}
        {place ? ` · ${place}` : null}
      </p>
      {data.headline ? <p className="lead">{data.headline}</p> : null}
      {!data.accepting_requests ? (
        <p className="banner" role="note">
          {t('dir.busy')}
        </p>
      ) : null}

      <p className="card" data-testid="review-wording">
        {reviewed.length > 0
          ? reviewed.map((c) => (
              <span key={c.claim_type} style={{ display: 'block' }}>
                {t('preview.reviewedOn', {
                  date: fmt.dateTime(new Date(c.decided_at as string), { dateStyle: 'medium', timeZone: 'UTC' }),
                  scope: t(`claimScope.${c.claim_type}`),
                })}
              </span>
            ))
          : t('dir.notReviewed')}
        <br />
        <span className="muted">{t('dir.reviewLimit')}</span>
      </p>

      {data.description ? (
        <>
          <h2>{t('dir.about')}</h2>
          <p style={{ whiteSpace: 'pre-line' }}>{data.description}</p>
        </>
      ) : null}

      <h2>{t('dir.services')}</h2>
      {data.service_details.length === 0 ? (
        <p>{t('dir.noServices')}</p>
      ) : (
        <ul className="card-list">
          {data.service_details.map((s, i) => (
            <li key={`${s.name}-${i}`} className="card">
              <h3 style={{ marginTop: 0 }}>{s.name}</h3>
              {s.description ? <p>{s.description}</p> : null}
              <dl className="dl">
                <dt>{t('dir.serves')}</dt>
                <dd>{s.nationwide ? t('dir.allMalaysia') : s.areas.join(', ')}</dd>
                {s.min_order_qty ? (
                  <>
                    <dt>{t('dir.minOrder')}</dt>
                    <dd>
                      {s.min_order_qty} {s.min_order_unit}
                    </dd>
                  </>
                ) : null}
                {s.lead_time_days !== null && s.lead_time_days !== undefined ? (
                  <>
                    <dt>{t('dir.leadTime')}</dt>
                    <dd>{t('dir.days', { n: s.lead_time_days })}</dd>
                  </>
                ) : null}
                {s.capacity_note ? (
                  <>
                    <dt>{t('dir.capacity')}</dt>
                    <dd>{s.capacity_note}</dd>
                  </>
                ) : null}
              </dl>
            </li>
          ))}
        </ul>
      )}
      {data.service_details.length > 0 ? <p className="muted">{t('dir.statedByBusiness')}</p> : null}

      {data.portfolio.length > 0 ? (
        <>
          <h2>{t('dir.portfolio')}</h2>
          <ul className="card-list">
            {data.portfolio.map((p, i) => (
              <li key={`${p.title}-${i}`} className="card">
                <strong>{p.title}</strong>
                {p.description ? <p style={{ margin: '4px 0 0' }}>{p.description}</p> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h2>{t('dir.contact')}</h2>
      <dl className="dl">
        {data.phone ? (
          <>
            <dt>{t('dir.phone')}</dt>
            <dd>{data.phone}</dd>
          </>
        ) : null}
        {data.email ? (
          <>
            <dt>{t('dir.email')}</dt>
            <dd>{data.email}</dd>
          </>
        ) : null}
        {!data.phone && !data.email ? <dd>{t('dir.contactInApp')}</dd> : null}
      </dl>
    </article>
  );
}

import { getFormatter, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import ProfileLayout from '@/components/public/ProfileLayout';
import Icon from '@/components/ui/Icon';
import Tag, { initialsOf, paletteFor } from '@/components/ui/Tag';
import { catName } from '@/lib/category';
import { LINK_KINDS, safeLinkHref, whatsappHref, type ListingLinks } from '@/lib/links';
import type { ReviewedClaim, ServiceDetail } from '@/server/services/directory';

export interface PublicProduct {
  id: string;
  name: string;
  description: string | null;
  unit: string | null;
  price_cents: number | null;
  ask_for_quote: boolean;
  min_order: number | null;
}

export interface ListingViewData {
  slug?: string;
  name: string;
  category: { slug?: string; name_en: string; name_ta: string } | null;
  state: string | null;
  district: string | null;
  headline: string | null;
  description: string | null;
  phone: string | null;
  email: string | null;
  links?: ListingLinks | null;
  hours?: string | null;
  reviewed: ReviewedClaim[];
  accepting_requests: boolean;
  service_details: ServiceDetail[];
  portfolio: { title: string; description: string | null; category_slug?: string | null; project_date?: string | null }[];
  serves_nationwide?: boolean;
  serves_states?: string[];
  products?: PublicProduct[];
}

/** The public business profile. Used by the public page, the owner preview and the moderation review. Never shows a street address. */
export default async function ListingView({
  data,
  locale,
  headingLevel = 1,
  actions,
  back,
  reviews,
}: {
  data: ListingViewData;
  locale: string;
  headingLevel?: 1 | 2;
  /** Buttons next to the name (the enquiry dialog on the public page). */
  actions?: ReactNode;
  back?: ReactNode;
  /** Published reviews for the Reviews tab. */
  reviews?: ReactNode;
}) {
  const t = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  const msgCategory = (slug: string) => t(`categories.${slug}`);
  const H = headingLevel === 1 ? 'h1' : 'h2';
  const place = [data.district, data.state].filter(Boolean).join(', ');
  const reviewed = data.reviewed.filter((c) => c.decided_at);
  const pal = paletteFor(data.slug ?? data.name);
  const palStyle = { ['--c1' as string]: pal.c1, ['--c2' as string]: pal.c2, ['--tint' as string]: pal.tint };
  const cat = data.category ? catName(locale, data.category) : '';
  const money = (cents: number) => `RM ${fmt.number(cents / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const serves = data.serves_nationwide ? t('dir2.allMalaysia') : (data.serves_states ?? []).join(', ');
  const minOrders = data.service_details.filter((s) => s.min_order_qty).map((s) => `${s.min_order_qty} ${s.min_order_unit ?? ''}`.trim());

  // Only well-formed https links to the expected hosts are rendered; anything else is dropped silently.
  const labelOf: Record<string, string> = {
    whatsapp: t('dir.whatsappLabel'), website: t('dir.websiteLabel'), facebook: t('dir.facebookLabel'), instagram: t('dir.instagramLabel'),
    tiktok: t('dir.tiktokLabel'), linkedin: t('dir.linkedinLabel'), youtube: t('dir.youtubeLabel'), google_maps: t('dir.mapsLabel'),
  };
  const onlineLinks: { kind: string; label: string; href: string; shown: string }[] = [];
  const wa = whatsappHref(data.links?.whatsapp);
  if (wa) onlineLinks.push({ kind: 'whatsapp', label: labelOf.whatsapp!, href: wa, shown: data.links!.whatsapp! });
  for (const kind of LINK_KINDS) {
    const href = safeLinkHref(kind, data.links?.[kind]);
    if (href) onlineLinks.push({ kind, label: labelOf[kind]!, href, shown: href.replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, '') });
  }

  const head = (
    <div style={palStyle}>
      <div className="profile-cover" aria-hidden="true" />
      <div className="profile-top">
        <div className="profile-avatar" aria-hidden="true">
          {initialsOf(data.name)}
        </div>
        <div className="profile-id">
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <H id="listing-name">{data.name}</H>
            {reviewed.length > 0 ? <Tag tone="green">{t('dir2.reviewedTag')}</Tag> : <Tag tone="gray">{t('dir2.inReview')}</Tag>}
          </span>
          <span className="mut" style={{ fontSize: '0.95rem' }}>
            {[cat, place].filter(Boolean).join(' · ')}
          </span>
          {data.headline ? <span style={{ fontSize: '1.0625rem', color: 'var(--text-2)' }}>{data.headline}</span> : null}
        </div>
        {actions ? <div className="profile-actions">{actions}</div> : null}
      </div>
    </div>
  );

  const overview = (
    <div className="card" style={{ padding: 26, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {!data.accepting_requests ? (
        <p className="banner" role="note" style={{ margin: 0 }}>
          {t('dir.busy')}
        </p>
      ) : null}
      <h2 style={{ margin: 0, fontSize: '1.25rem' }}>{t('dir.about')}</h2>
      {data.description ? <p style={{ margin: 0, whiteSpace: 'pre-line', fontSize: '1rem', lineHeight: 1.7, color: '#2a3530' }}>{data.description}</p> : <p className="mut">{t('dir.noServices')}</p>}
      {data.portfolio.length > 0 ? (
        <>
          <h2 style={{ margin: '8px 0 0', fontSize: '1.25rem' }}>{t('dir.portfolio')}</h2>
          <ul className="card-list">
            {data.portfolio.map((p, i) => (
              <li key={`${p.title}-${i}`} className="card" style={{ boxShadow: 'none' }}>
                <strong>{p.title}</strong>
                {p.category_slug || p.project_date ? (
                  <p className="muted" style={{ margin: '2px 0 0' }}>
                    {[
                      p.category_slug ? msgCategory(p.category_slug) : null,
                      p.project_date ? fmt.dateTime(new Date(`${p.project_date}T00:00:00Z`), { month: 'long', year: 'numeric', timeZone: 'UTC' }) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                ) : null}
                {p.description ? <p style={{ margin: '4px 0 0' }}>{p.description}</p> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h2 style={{ margin: '8px 0 0', fontSize: '1.25rem' }}>{t('dir.contact')}</h2>
      {data.phone || data.email ? (
        <dl className="dl" style={{ margin: 0 }}>
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
        </dl>
      ) : (
        <p style={{ margin: 0 }}>{t('dir.contactInApp')}</p>
      )}
      {onlineLinks.length > 0 || data.hours ? (
        <>
          <h2 style={{ margin: '8px 0 0', fontSize: '1.25rem' }}>{t('dir.onlineTitle')}</h2>
          <dl className="dl" style={{ margin: 0 }}>
            {data.hours ? (
              <>
                <dt>{t('dir.hoursTitle')}</dt>
                <dd>{data.hours}</dd>
              </>
            ) : null}
            {onlineLinks.map((l) => (
              <div key={l.kind} style={{ display: 'contents' }}>
                <dt>{l.label}</dt>
                <dd>
                  <a href={l.href} target="_blank" rel="noopener noreferrer nofollow ugc" title={t('dir.externalNote')}>
                    {l.shown}
                  </a>
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
    </div>
  );

  const products = data.products ?? [];
  const services = (
    <div className="card" style={{ padding: '10px 26px 16px' }}>
      {data.service_details.length === 0 && products.length === 0 ? <p>{t('dir.noServices')}</p> : null}
      {products.map((p) => (
        <div key={p.id} className="svc-row">
          <span>
            <strong>{p.name}</strong>
            {p.description ? (
              <span className="mut" style={{ display: 'block', fontSize: '0.875rem', marginTop: 4 }}>
                {p.description}
              </span>
            ) : null}
            {p.min_order ? (
              <span className="mut" style={{ display: 'block', fontSize: '0.875rem', marginTop: 4 }}>
                {t('biz2.products.minOrder', { n: p.min_order })}
              </span>
            ) : null}
          </span>
          <strong style={{ whiteSpace: 'nowrap' }}>
            {p.ask_for_quote || p.price_cents === null ? t('biz2.products.askQuote') : `${t('biz2.products.from')} ${money(p.price_cents)}${p.unit ? ` / ${p.unit}` : ''}`}
          </strong>
        </div>
      ))}
      {data.service_details.map((s, i) => (
        <div key={`${s.name}-${i}`} className="svc-row">
          <span>
            <strong>{s.name}</strong>
            {s.description ? (
              <span className="mut" style={{ display: 'block', fontSize: '0.875rem', marginTop: 4 }}>
                {s.description}
              </span>
            ) : null}
            <span className="mut" style={{ display: 'block', fontSize: '0.875rem', marginTop: 4 }}>
              {[
                s.nationwide ? t('dir.allMalaysia') : s.areas.join(', '),
                s.min_order_qty ? `${t('dir.minOrder')}: ${s.min_order_qty} ${s.min_order_unit ?? ''}`.trim() : null,
                s.lead_time_days !== null && s.lead_time_days !== undefined ? `${t('dir.leadTime')}: ${t('dir.days', { n: s.lead_time_days })}` : null,
                s.capacity_note ? `${t('dir.capacity')}: ${s.capacity_note}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
          <strong style={{ whiteSpace: 'nowrap' }}>{t('biz2.products.askQuote')}</strong>
        </div>
      ))}
      {data.service_details.length > 0 ? (
        <p className="muted" style={{ fontSize: '0.875rem' }}>
          {t('dir.statedByBusiness')}
        </p>
      ) : null}
    </div>
  );

  const reviewsPanel = (
    <div className="card" style={{ padding: 26, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {reviews ?? (
        <>
          <strong style={{ fontSize: '1.1rem' }}>{t('dir2.noReviews')}</strong>
          <span className="mut" style={{ lineHeight: 1.6 }}>
            {t('dir2.noReviewsSub')}
          </span>
        </>
      )}
    </div>
  );

  const aside = (
    <>
      <div className="card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="review-wording">
        <strong style={{ fontSize: '1rem' }}>{t('dir2.reviewedHeading')}</strong>
        {reviewed.length > 0 ? (
          reviewed.map((c) => (
            <span key={c.claim_type} className="checkrow">
              <Icon name="check" size={18} stroke={2.6} />
              <span>
                {t('preview.reviewedOn', {
                  date: fmt.dateTime(new Date(c.decided_at as string), { dateStyle: 'medium', timeZone: 'UTC' }),
                  scope: t(`claimScope.${c.claim_type}`),
                })}
              </span>
            </span>
          ))
        ) : (
          <span>{t('dir.notReviewed')}</span>
        )}
        <span className="mut" style={{ fontSize: '0.8125rem', lineHeight: 1.5, borderTop: '1px solid #f3ebdc', paddingTop: 10 }}>
          {t('dir.reviewLimit')} {t('dir2.reviewNote')}
        </span>
      </div>
      <div className="card" style={{ padding: 22 }}>
        {serves ? (
          <div className="row">
            <span className="mut">{t('dir2.detailServes')}</span>
            <span style={{ textAlign: 'right' }}>{serves}</span>
          </div>
        ) : null}
        {minOrders.length > 0 ? (
          <div className="row">
            <span className="mut">{t('dir2.detailSmallest')}</span>
            <span style={{ textAlign: 'right' }}>{minOrders[0]}</span>
          </div>
        ) : null}
        <div className="row">
          <span className="mut">{t('dir2.detailLocation')}</span>
          <span style={{ textAlign: 'right' }}>{t('dir2.areaOnly', { place: place || cat })}</span>
        </div>
      </div>
    </>
  );

  return (
    <article className="wide profile" aria-labelledby="listing-name">
      {back}
      <ProfileLayout
        head={head}
        aside={aside}
        tabsLabel={t('dir2.tabsLabel')}
        tabs={[
          { key: 'overview', label: t('dir2.tabOverview'), panel: overview },
          { key: 'services', label: t('dir2.tabServices'), panel: services },
          { key: 'reviews', label: t('dir2.tabReviews'), panel: reviewsPanel },
        ]}
      />
    </article>
  );
}

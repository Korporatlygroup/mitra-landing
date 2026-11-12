import { getFormatter, getTranslations } from 'next-intl/server';
import { saveGovProgrammeAction, unsaveGovProgrammeAction } from '@/app/[locale]/business-help/actions';
import QuickForm from '@/components/catalogue/QuickForm';
import { Link } from '@/i18n/navigation';
import type { MatchResult } from '@/lib/gov-matching';
import { formatRm, safeHttpsUrl } from '@/lib/gov-ui';
import type { GovProgrammeRow } from '@/server/services/gov';

const STATUS_CHIP: Record<string, string> = { open: 'chip chip-good', closed: 'chip chip-bad', upcoming: 'chip', unknown: 'chip' };

/**
 * One programme in a list. Shows what the agency published (name, agency, amount, dates), when INOK last checked it, and
 * what the business owner can do next. The application button leads only to the programme's own https link; INOK never
 * claims it can apply for the user, and an unconfirmed application status is shown as "Not confirmed" (with the reason).
 */
export default async function ProgrammeCard({
  p,
  locale,
  match,
  orgId,
  saved,
}: {
  p: GovProgrammeRow;
  locale: string;
  match?: MatchResult | null;
  orgId?: string | null;
  saved?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'gov' });
  const fmt = await getFormatter({ locale });
  const date = (d: string) => fmt.dateTime(new Date(d), { dateStyle: 'medium', timeZone: 'UTC' });
  const amount = p.amount_max ? (p.amount_min && p.amount_min !== p.amount_max ? t('card.amountRange', { min: formatRm(p.amount_min), max: formatRm(p.amount_max) }) : t('card.upTo', { max: formatRm(p.amount_max) })) : t('card.amountUnknown');
  const apply = safeHttpsUrl(p.application_url);
  return (
    <li className="card catalogue-card" data-programme={p.slug}>
      <h2 className="catalogue-card-title">{p.name}</h2>
      <p className="muted" style={{ margin: 0 }}>
        {t('card.agency')}: {p.agency_name}
      </p>
      <p style={{ margin: '4px 0' }}>
        {p.funding_type ? <span className="chip">{t(`type.${p.funding_type}`)}</span> : null}{' '}
        <span className={STATUS_CHIP[p.application_status] ?? 'chip'}>
          {t('card.status')}: {t(`status.${p.application_status}`)}
        </span>
      </p>
      {match ? (
        <p style={{ margin: '4px 0' }}>
          <strong>{t(`match.${match.label}`)}</strong>
          <br />
          <span className="muted">{t(`match.explain.${match.label}`)}</span>
        </p>
      ) : null}
      <dl className="catalogue-facts">
        <dt>{t('card.amount')}</dt>
        <dd>{amount}</dd>
        <dt>{t('card.importantDates')}</dt>
        <dd>{p.opens_on || p.closes_on ? [p.opens_on ? t('card.opens', { date: date(p.opens_on) }) : null, p.closes_on ? t('card.closes', { date: date(p.closes_on) }) : null].filter(Boolean).join(' · ') : t('card.noDates')}</dd>
      </dl>
      <p className="muted" style={{ margin: 0 }}>
        {p.last_checked_at ? t('card.checked', { date: date(p.last_checked_at) }) : t('card.neverChecked')}
        {p.last_verified_at ? ` · ${t('card.verified', { date: date(p.last_verified_at) })}` : ''}
      </p>
      {p.is_stale ? (
        <p className="message message-error" role="note" style={{ margin: '4px 0' }}>
          {t('card.stale')}
        </p>
      ) : null}
      <div className="catalogue-card-actions">
        <Link href={`/business-help/${p.slug}${orgId ? `?org=${orgId}` : ''}`} locale={locale} className="btn btn-primary">
          {t('card.details')}
          <span className="p5b-sr">: {p.name}</span>
        </Link>
        {orgId ? (
          <QuickForm
            action={saved ? unsaveGovProgrammeAction : saveGovProgrammeAction}
            fields={{ orgId, programmeId: p.id }}
            label={saved ? t('card.remove') : t('card.save')}
            srName={p.name}
          />
        ) : null}
        {apply ? (
          <a href={apply} className="btn btn-secondary" target="_blank" rel="noopener noreferrer">
            {t('card.apply')}
            <span className="p5b-sr">: {p.name}</span>
          </a>
        ) : null}
      </div>
    </li>
  );
}

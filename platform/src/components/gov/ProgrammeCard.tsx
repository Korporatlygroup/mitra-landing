import { getFormatter, getTranslations } from 'next-intl/server';
import { saveMyProgrammeAction, unsaveMyProgrammeAction } from '@/app/[locale]/business-help/actions';
import QuickForm from '@/components/catalogue/QuickForm';
import { Link } from '@/i18n/navigation';
import type { MatchResult } from '@/lib/gov-matching';
import { categoryOf, displayStatus } from '@/lib/gov-status';
import { formatRm, safeHttpsUrl } from '@/lib/gov-ui';
import StatusBadge from './StatusBadge';
import type { GovProgrammeRow } from '@/server/services/gov';

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
  signedIn,
  saved,
}: {
  p: GovProgrammeRow;
  locale: string;
  match?: MatchResult | null;
  orgId?: string | null;
  /** Saving is a personal bookmark: any signed-in person can do it, with or without a business. */
  signedIn?: boolean;
  saved?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'gov' });
  const fmt = await getFormatter({ locale });
  const date = (d: string) => fmt.dateTime(new Date(d), { dateStyle: 'medium', timeZone: 'UTC' });
  const amount = p.amount_max ? (p.amount_min && p.amount_min !== p.amount_max ? t('card.amountRange', { min: formatRm(p.amount_min), max: formatRm(p.amount_max) }) : t('card.upTo', { max: formatRm(p.amount_max) })) : t('card.amountUnknown');
  const statusInput = { publication_state: 'published', verification_status: p.verification_status, application_status: p.application_status, closes_on: p.closes_on, is_stale: p.is_stale };
  const shown = displayStatus(statusInput);
  const apply = p.application_channel === 'online' && p.application_status !== 'closed' && shown !== 'closed' ? safeHttpsUrl(p.application_url) : null;
  return (
    <li className="card catalogue-card" data-programme={p.slug}>
      <h2 className="catalogue-card-title">{p.name}</h2>
      <p className="muted" style={{ margin: 0 }}>
        {t('card.agency')}: {p.agency_name}
      </p>
      <p style={{ margin: '4px 0' }}>
        <span className="chip">{t(`category.${categoryOf(p)}`)}</span>{' '}
        <StatusBadge locale={locale} input={statusInput} />
        {p.beneficiary_type === 'organisation' ? (
          <>
            {' '}
            <span className="chip chip-warn">{t('match.for_organisations')}</span>
          </>
        ) : null}
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
        {signedIn ? (
          <QuickForm
            action={saved ? unsaveMyProgrammeAction : saveMyProgrammeAction}
            fields={{ programmeId: p.id }}
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

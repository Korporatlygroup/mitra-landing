import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { MatchResult, RuleResult, RuleStatus } from '@/lib/gov-matching';
import { safeHttpsUrl, textLang } from '@/lib/gov-ui';

const GROUPS: { status: RuleStatus; heading: string }[] = [
  { status: 'met', heading: 'match.fits' },
  { status: 'not_met', heading: 'match.notMet' },
  { status: 'unknown', heading: 'match.missing' },
  { status: 'agency', heading: 'match.agency' },
];

/**
 * The explained, indicative comparison: for every requirement the outcome, the information used, the reason and the official
 * page it comes from, then an overall sentence. Deterministic rules only; never a verdict on eligibility or approval.
 */
export default async function MatchExplanation({ match, locale, orgId, level = 2 }: { match: MatchResult; locale: string; orgId: string; level?: 2 | 3 }) {
  const t = await getTranslations({ locale, namespace: 'gov' });
  const H = (level === 2 ? 'h2' : 'h3') as 'h2' | 'h3';
  const Sub = (level === 2 ? 'h3' : 'h4') as 'h3' | 'h4';
  const counts = {
    met: match.rules.filter((r) => r.status === 'met').length,
    notMet: match.rules.filter((r) => r.status === 'not_met').length,
    unknown: match.rules.filter((r) => r.status === 'unknown').length,
    agency: match.rules.filter((r) => r.status === 'agency').length,
  };
  const used = (r: RuleResult) =>
    r.used === null
      ? t('match.usedNone')
      : r.usedValue === null
        ? t('match.usedVoluntary')
        : t('match.usedValue', { field: t(`match.field.${r.field}`), value: String(r.usedValue) });
  return (
    <section aria-labelledby="gov-match-h" className="card" id="gov-match">
      <H id="gov-match-h">{t('card.check')}</H>
      <p>
        <strong>{t(`match.${match.label}`)}</strong>
      </p>
      <p>{t(`match.explain.${match.label}`)}</p>
      {match.rules.length > 0 ? <p className="muted">{t('match.counts', counts)}</p> : null}
      {GROUPS.map(({ status, heading }) => {
        const rows = match.rules.filter((r) => r.status === status);
        if (rows.length === 0) return null;
        return (
          <div key={status}>
            <Sub>{t(heading)}</Sub>
            <ul className="gov-rules">
              {rows.map((r, i) => {
                const src = safeHttpsUrl(r.sourceUrl);
                return (
                  <li key={`${r.field}-${i}`}>
                    <p style={{ margin: 0 }}>
                      <span className="chip" data-rule-status={r.status}>
                        {t(`match.rule.${r.status}`)}
                      </span>{' '}
                      <span lang={textLang(r.quote)}>{r.quote}</span>
                    </p>
                    <p className="muted" style={{ margin: '2px 0 0' }}>
                      {t('match.usedLabel')}: {used(r)}. {t(`match.reason.${r.reason}`)}
                      {src ? (
                        <>
                          {' '}
                          <a href={src} target="_blank" rel="noopener noreferrer">
                            {t('match.source')}
                          </a>
                        </>
                      ) : null}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {match.missing.length ? (
        <p>
          <Link href={`/business-help/find?org=${orgId}`} locale={locale}>
            {t('find.change')}
          </Link>
        </p>
      ) : null}
      <p className="muted">{t('match.disclaimer')}</p>
      <p className="muted">{t('detail.profileHint')}</p>
    </section>
  );
}

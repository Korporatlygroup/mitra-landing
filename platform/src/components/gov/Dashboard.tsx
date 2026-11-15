import { getFormatter, getTranslations } from 'next-intl/server';
import StatusBadge from './StatusBadge';
import { Link } from '@/i18n/navigation';
import type { MatchLabel } from '@/lib/gov-matching';
import type { StatusInput } from '@/lib/gov-status';
import type { GovProgrammeRow, GovSavedRow } from '@/server/services/gov';

export interface DashboardData {
  /** null for visitors and for people without a business profile: the personal sections then explain what unlocks them. */
  orgId: string | null;
  signedIn: boolean;
  recommended: { p: GovProgrammeRow; label: MatchLabel }[];
  fresh: GovProgrammeRow[];
  closing: GovProgrammeRow[];
  saved: GovSavedRow[];
  applications: GovSavedRow[];
  training: GovProgrammeRow[];
}

const input = (p: GovProgrammeRow): StatusInput => ({
  publication_state: 'published', verification_status: p.verification_status, application_status: p.application_status, closes_on: p.closes_on, is_stale: p.is_stale,
});
// The saved list does not carry the verification state, so only what it does carry (publication, freshness, dates) is used.
const savedInput = (r: GovSavedRow): StatusInput => ({
  publication_state: r.publication_state, verification_status: 'verified', application_status: r.application_status, closes_on: r.closes_on, is_stale: r.is_stale,
});

/** Six plain sections. Each one says honestly when it is empty. Nothing here is a score or a promise of approval. */
export default async function Dashboard({ locale, data }: { locale: string; data: DashboardData }) {
  const t = await getTranslations({ locale, namespace: 'gov' });
  const fmt = await getFormatter({ locale });
  const date = (d: string) => fmt.dateTime(new Date(d), { dateStyle: 'medium', timeZone: 'UTC' });
  const org = data.orgId ? `?org=${data.orgId}` : '';

  const programmeList = (rows: GovProgrammeRow[], extra?: (p: GovProgrammeRow) => string | null) => (
    <ul className="card-list gov-mini">
      {rows.map((p) => (
        <li key={p.id} className="card" data-programme={p.slug}>
          <p style={{ margin: 0 }}>
            <Link href={`/business-help/${p.slug}${org}`} locale={locale}>
              <strong>{p.name}</strong>
            </Link>
          </p>
          <p className="muted" style={{ margin: '2px 0' }}>
            {p.agency_name}
          </p>
          <p style={{ margin: 0 }}>
            <StatusBadge locale={locale} input={input(p)} label={false} />
            {extra?.(p) ? ` ${extra(p)}` : ''}
          </p>
        </li>
      ))}
    </ul>
  );
  const savedList = (rows: GovSavedRow[]) => (
    <ul className="card-list gov-mini">
      {rows.map((r) => (
        <li key={r.programme_id} className="card" data-programme={r.slug}>
          <p style={{ margin: 0 }}>
            <Link href={`/business-help/${r.slug}${org}`} locale={locale}>
              <strong>{r.name}</strong>
            </Link>
          </p>
          <p style={{ margin: '2px 0 0' }}>
            <StatusBadge locale={locale} input={savedInput(r)} label={false} /> <span className="chip">{t(`saved.status.${r.tracking_status}`)}</span>
          </p>
        </li>
      ))}
    </ul>
  );
  const personal = (body: React.ReactNode, count: number, empty: string) => (count > 0 ? body : <p className="muted">{empty}</p>);

  const closes = (p: GovProgrammeRow) => (p.closes_on ? t('card.closes', { date: date(p.closes_on) }) : null);
  const sections: { id: string; title: string; hint?: string; body: React.ReactNode }[] = [
    {
      id: 'rec',
      title: t('dash.recommended'),
      hint: t('dash.recommendedHint'),
      body: !data.orgId
        ? <p className="muted">{data.signedIn ? t('dash.needOrg') : t('dash.needSignIn')}</p>
        : personal(
            <ul className="card-list gov-mini">
              {data.recommended.map(({ p, label }) => (
                <li key={p.id} className="card" data-programme={p.slug}>
                  <p style={{ margin: 0 }}>
                    <Link href={`/business-help/${p.slug}${org}`} locale={locale}>
                      <strong>{p.name}</strong>
                    </Link>
                  </p>
                  <p className="muted" style={{ margin: '2px 0' }}>
                    {t(`match.${label}`)}
                  </p>
                  <p style={{ margin: 0 }}>
                    <StatusBadge locale={locale} input={input(p)} label={false} />
                  </p>
                </li>
              ))}
            </ul>,
            data.recommended.length,
            t('dash.recommendedEmpty'),
          ),
    },
    { id: 'new', title: t('dash.fresh'), body: personal(programmeList(data.fresh), data.fresh.length, t('dash.freshEmpty')) },
    { id: 'closing', title: t('dash.closing'), hint: t('dash.closingHint'), body: personal(programmeList(data.closing, closes), data.closing.length, t('dash.closingEmpty')) },
    {
      id: 'saved',
      title: t('dash.saved'),
      body: !data.orgId ? <p className="muted">{data.signedIn ? t('dash.needOrg') : t('dash.needSignIn')}</p> : personal(savedList(data.saved), data.saved.length, t('dash.savedEmpty')),
    },
    {
      id: 'apps',
      title: t('dash.applications'),
      hint: t('saved.reportedNote'),
      body: !data.orgId ? <p className="muted">{data.signedIn ? t('dash.needOrg') : t('dash.needSignIn')}</p> : personal(savedList(data.applications), data.applications.length, t('dash.applicationsEmpty')),
    },
    { id: 'training', title: t('dash.training'), body: personal(programmeList(data.training), data.training.length, t('dash.trainingEmpty')) },
  ];
  return (
    <div className="gov-dashboard">
      {sections.map((s) => (
        <section key={s.id} aria-labelledby={`gov-dash-${s.id}`} data-section={s.id}>
          <h2 id={`gov-dash-${s.id}`}>{s.title}</h2>
          {s.hint ? <p className="muted">{s.hint}</p> : null}
          {s.body}
        </section>
      ))}
      {data.orgId ? (
        <p>
          <Link href={`/business-help/saved${org}`} locale={locale} className="btn btn-secondary">
            {t('home.saved')}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

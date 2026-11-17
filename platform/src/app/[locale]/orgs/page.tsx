import { getTranslations } from 'next-intl/server';
import { initialsOf, paletteFor } from '@/components/ui/Tag';
import WorkspaceShell from '@/components/workspace/WorkspaceShell';
import { Link } from '@/i18n/navigation';
import { requireSession } from '@/server/session';
import { pageTitle } from '@/lib/metadata';
import PageHeader from '@/components/shared/PageHeader';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'orgs.title');
}

export default async function OrgsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  const required = (await searchParams).required === '1';
  const s = await requireSession({ locale, path: '/orgs', requireMfaIfNeeded: false });
  const t = await getTranslations({ locale });

  return (
    <WorkspaceShell locale={locale}>
      <div className="page-head">
        <PageHeader title={t('orgs.title')} />
        <Link href="/orgs/new" className="btn btn-primary">
          {t('orgs.create')}
        </Link>
      </div>
      {required && s.memberships.length === 0 ? (
        <p className="banner" role="status">
          {t('orgs.requiredNote')}
        </p>
      ) : null}
      {s.memberships.length === 0 ? (
        <div className="empty">
          <strong>{t('orgs.none')}</strong>
          <h2 style={{ marginTop: 16 }}>{t('orgs.purposeTitle')}</h2>
          <p>{t('orgs.purposeIntro')}</p>
          <ul className="card-list" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 16rem), 1fr))' }}>
            {(['buy', 'sell', 'both'] as const).map((p) => (
              <li key={p} className="card">
                <h3 style={{ marginTop: 0 }}>
                  <Link href={`/orgs/new?purpose=${p}`} locale={locale}>
                    {t(`orgs.purpose${p === 'buy' ? 'Buy' : p === 'sell' ? 'Sell' : 'Both'}`)}
                  </Link>
                </h3>
                <p className="muted" style={{ margin: 0 }}>{t(`orgs.purpose${p === 'buy' ? 'Buy' : p === 'sell' ? 'Sell' : 'Both'}Hint`)}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ul className="card-list" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 20rem), 1fr))' }}>
          {s.memberships.map((m) => {
            const pal = paletteFor(m.org.id);
            return (
              <li key={m.org.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span className="org-init" style={{ width: 44, height: 44, background: pal.tint, color: pal.c1 }} aria-hidden="true">
                    {initialsOf(m.org.name)}
                  </span>
                  <span>
                    <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{m.org.name}</h2>
                    <span className="muted" style={{ fontSize: '0.875rem' }}>
                      {t(`orgTypes.${m.org.type}`)} &middot; {t('orgs.role')}: {t(`roles.${m.role}`)}
                    </span>
                  </span>
                </span>
                <p className="link-row" style={{ margin: 0 }}>
                  <Link href={`/orgs/${m.org.id}/members`} locale={locale}>
                    {t('orgs.members')}
                  </Link>
                  {m.org.type === 'business' ? (
                    <Link href={`/orgs/${m.org.id}/business`} locale={locale}>
                      {t('orgs.businessLink')}
                    </Link>
                  ) : null}
                  {m.org.type === 'partner' ? (
                    <Link href={`/orgs/${m.org.id}/partner`} locale={locale}>
                      {t('p5common.nav.partnerDashboard')}
                    </Link>
                  ) : null}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </WorkspaceShell>
  );
}

import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireSession } from '@/server/session';
import { pageTitle } from '@/lib/metadata';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'orgs.title');
}

export default async function OrgsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const s = await requireSession({ locale, path: '/orgs', requireMfaIfNeeded: false });
  const t = await getTranslations({ locale });

  return (
    <>
      <h1>{t('orgs.title')}</h1>
      {s.memberships.length === 0 ? (
        <p>{t('orgs.none')}</p>
      ) : (
        <ul className="card-list">
          {s.memberships.map((m) => (
            <li key={m.org.id} className="card">
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{m.org.name}</h2>
              <p className="muted">
                {t(`orgTypes.${m.org.type}`)} &middot; {t('orgs.role')}: {t(`roles.${m.role}`)}
              </p>
              <p className="link-row">
                <Link href={`/orgs/${m.org.id}/members`} locale={locale}>
                  {t('orgs.members')}
                </Link>
              </p>
            </li>
          ))}
        </ul>
      )}
      <p>
        <Link href="/orgs/new" locale={locale} className="btn btn-primary">
          {t('orgs.create')}
        </Link>
      </p>
    </>
  );
}

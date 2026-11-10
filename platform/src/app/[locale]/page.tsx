import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getProfile } from '@/server/services/auth';
import { listMyMemberships } from '@/server/services/orgs';
import { getOptionalUser } from '@/server/session';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = (await params).locale;
  const nav = await getTranslations({ locale, namespace: 'nav' });
  const common = await getTranslations({ locale, namespace: 'common' });
  // The layout's title template does not apply to its own index page, so compose it here.
  return { title: { absolute: `${nav('home')} | ${common('appName')}` } };
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'home' });
  const nav = await getTranslations({ locale, namespace: 'nav' });
  const all = await getTranslations({ locale });
  const { supabase, user } = await getOptionalUser();

  if (!user || !supabase) {
    return (
      <>
        <h1>{t('titleSignedOut')}</h1>
        <p>{t('introSignedOut')}</p>
        <p className="link-row">
          <Link href="/login" locale={locale} className="btn btn-primary">
            {nav('signIn')}
          </Link>
          <Link href="/signup" locale={locale} className="btn btn-secondary">
            {nav('signUp')}
          </Link>
        </p>
      </>
    );
  }

  const [profile, memberships] = await Promise.all([getProfile(supabase, user.id), listMyMemberships(supabase, user.id)]);
  const isAdmin = memberships.some((m) => m.org.type === 'mitra');
  const hasAudit = isAdmin || memberships.some((m) => m.role === 'owner');

  return (
    <>
      <h1>{t('titleSignedIn', { name: profile.display_name || user.email || '' })}</h1>
      <h2>{t('yourOrgs')}</h2>
      {memberships.length === 0 ? (
        <p>{t('noOrgs')}</p>
      ) : (
        <ul className="card-list">
          {memberships.map((m) => (
            <li key={m.org.id} className="card">
              <h3>
                <Link href={`/orgs/${m.org.id}/members`} locale={locale}>
                  {m.org.name}
                </Link>
              </h3>
              <p className="muted" style={{ margin: 0 }}>
                {all(`roles.${m.role}`)}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="link-row">
        <Link href="/orgs/new" locale={locale} className="btn btn-primary">
          {t('createOrg')}
        </Link>
        <Link href="/orgs" locale={locale} className="btn btn-secondary">
          {t('openOrgs')}
        </Link>
      </p>
      {isAdmin || hasAudit ? (
        <>
          <h2>{t('adminTitle')}</h2>
          <p className="link-row">
            {isAdmin ? (
              <Link href="/admin/users" locale={locale}>
                {t('adminUsers')}
              </Link>
            ) : null}
            {isAdmin ? (
              <Link href="/admin/verification" locale={locale}>
                {t('adminVerification')}
              </Link>
            ) : null}
            <Link href="/admin/audit" locale={locale}>
              {t('adminAudit')}
            </Link>
          </p>
        </>
      ) : null}
    </>
  );
}

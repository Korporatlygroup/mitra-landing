import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { Link } from '@/i18n/navigation';
import AccountMenu from './AccountMenu';
import LocaleSwitcher from './LocaleSwitcher';
import PublicNav from './PublicNav';
import Logo from './ui/Logo';
import { initialsOf } from './ui/Tag';

/** Public top bar: logo, four nav pills, language switch, then Sign in / List your business, or My business and the account menu. */
export default async function SiteHeader({ locale, user }: { locale: string; user: { name: string; home: string } | null }) {
  const t = await getTranslations({ locale });
  return (
    <header className="pub-top">
      <div className="pub-wrap">
        <Logo locale={locale} label={t('ws.homeLabel')} />
        <PublicNav />
        <div className="pub-actions">
          <Suspense fallback={null}>
            <LocaleSwitcher />
          </Suspense>
          {user ? (
            <>
              <Link href={user.home} className="btn btn-dark btn-sm">
                {t('ws.myBusiness')}
              </Link>
              <AccountMenu initials={initialsOf(user.name)} name={user.name} />
            </>
          ) : (
            <>
              <Link href="/login" className="btn btn-secondary btn-sm">
                {t('nav.signIn')}
              </Link>
              <Link href="/list-your-business" className="btn btn-dark btn-sm">
                {t('ws.listYourBusiness')}
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

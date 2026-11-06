import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { signOutAction } from '@/app/[locale]/account/actions';
import { Link } from '@/i18n/navigation';
import LocaleSwitcher from './LocaleSwitcher';

export default async function SiteHeader({ locale, signedIn }: { locale: string; signedIn: boolean }) {
  const t = await getTranslations({ locale });
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" locale={locale} className="brand">
          {t('common.appName')}
        </Link>
        <Suspense fallback={null}>
          <LocaleSwitcher />
        </Suspense>
        <nav aria-label={t('common.mainNav')} className="main-nav">
          {signedIn ? (
            <>
              <Link href="/orgs" locale={locale}>
                {t('nav.organisations')}
              </Link>
              <Link href="/account" locale={locale}>
                {t('nav.account')}
              </Link>
              <form action={signOutAction}>
                <input type="hidden" name="locale" value={locale} />
                <button type="submit" className="btn btn-link">
                  {t('nav.signOut')}
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" locale={locale}>
                {t('nav.signIn')}
              </Link>
              <Link href="/signup" locale={locale}>
                {t('nav.signUp')}
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

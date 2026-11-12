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
          <Link href="/directory" locale={locale}>
            {t('nav.find')}
          </Link>
          <Link href="/catalogue" locale={locale}>
            {t('p5common.nav.catalogue')}
          </Link>
          <Link href="/business-help" locale={locale}>
            {t('gov.nav.help')}
          </Link>
          {signedIn ? (
            <>
              <Link href="/requests" locale={locale}>
                {t('nav.requests')}
              </Link>
              <Link href="/catalogue/saved" locale={locale}>
                {t('p5buyer.nav.saved')}
              </Link>
              <Link href="/catalogue/requests" locale={locale}>
                {t('p5buyer.nav.requests')}
              </Link>
              <Link href="/orgs" locale={locale}>
                {t('nav.organisations')}
              </Link>
              <Link href="/notifications" locale={locale}>
                {t('nav.notifications')}
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

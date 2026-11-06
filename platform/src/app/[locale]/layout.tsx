import type { Metadata } from 'next';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import SiteHeader from '@/components/SiteHeader';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { getOptionalUser } from '@/server/session';
import '../globals.css';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'common' });
  return { title: { default: t('appName'), template: `%s | ${t('appName')}` }, robots: { index: false } };
}

export const viewport = { width: 'device-width', initialScale: 1 };

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const [messages, t, { user }] = await Promise.all([getMessages({ locale }), getTranslations({ locale }), getOptionalUser()]);

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <a className="skip-link" href="#main">
            {t('common.skipToContent')}
          </a>
          <SiteHeader locale={locale} signedIn={Boolean(user)} />
          <main id="main">{children}</main>
          <footer className="site-footer">
            <Link href="/terms" locale={locale}>
              {t('nav.terms')}
            </Link>
            <Link href="/privacy" locale={locale}>
              {t('nav.privacy')}
            </Link>
          </footer>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

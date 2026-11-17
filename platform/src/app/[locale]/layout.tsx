import type { Metadata } from 'next';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { Inter, Noto_Sans_Tamil } from 'next/font/google';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import { BASE_PATHS } from '@/i18n/client-namespaces';
import { pickMessages } from '@/i18n/pick-messages';
import { routing } from '@/i18n/routing';
import { getOptionalUser, myMembershipsOnce, myProfileOnce } from '@/server/session';
import '../globals.css';
import '../ui.css';
import '../shell.css';
import '../pages.css';

const inter = Inter({ subsets: ['latin', 'latin-ext'], variable: '--font-inter', display: 'swap' });
const tamil = Noto_Sans_Tamil({ subsets: ['tamil'], weight: ['400', '500', '600', '700'], variable: '--font-tamil', display: 'swap' });

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'common' });
  return { title: { default: t('appName'), template: `%s | ${t('appName')}` }, robots: { index: false } };
}

export const viewport = { width: 'device-width', initialScale: 1 };

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const [messages, t, { user, supabase }] = await Promise.all([getMessages({ locale }), getTranslations({ locale }), getOptionalUser()]);

  let header: { name: string; home: string } | null = null;
  if (user && supabase) {
    const [profile, memberships] = await Promise.all([myProfileOnce(supabase, user.id), myMembershipsOnce(supabase, user.id)]);
    const name = profile.display_name || user.email || '';
    const staff = memberships.find((m) => m.org.type === 'mitra');
    const biz = memberships.find((m) => m.org.type === 'business');
    const partner = memberships.find((m) => m.org.type === 'partner');
    header = { name, home: staff ? '/admin' : biz ? `/orgs/${biz.org.id}/business` : partner ? `/orgs/${partner.org.id}/partner` : '/orgs' };
  }

  return (
    <html lang={locale} className={`${inter.variable} ${tamil.variable}`}>
      <body>
        <NextIntlClientProvider locale={locale} messages={pickMessages(messages as Record<string, unknown>, BASE_PATHS) as never}>
          <a className="skip-link" href="#main">
            {t('common.skipToContent')}
          </a>
          <div className="pub-chrome">
            <SiteHeader locale={locale} user={header} />
          </div>
          <main id="main">{children}</main>
          <div className="pub-chrome">
            <SiteFooter locale={locale} />
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

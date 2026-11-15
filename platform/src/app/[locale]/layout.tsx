import type { Metadata } from 'next';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { Bricolage_Grotesque, Hanken_Grotesk, Noto_Sans_Tamil } from 'next/font/google';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import { routing } from '@/i18n/routing';
import { getOptionalUser } from '@/server/session';
import { listMyMemberships } from '@/server/services/orgs';
import '../globals.css';
import '../ui.css';
import '../shell.css';
import '../pages.css';

const hanken = Hanken_Grotesk({ subsets: ['latin', 'latin-ext'], variable: '--font-hanken', display: 'swap' });
const bricolage = Bricolage_Grotesque({ subsets: ['latin', 'latin-ext'], variable: '--font-bricolage', display: 'swap' });
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
    const [{ data }, memberships] = await Promise.all([supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle(), listMyMemberships(supabase, user.id)]);
    const name = (data as { display_name?: string } | null)?.display_name || user.email || '';
    const staff = memberships.find((m) => m.org.type === 'mitra');
    const biz = memberships.find((m) => m.org.type === 'business');
    const partner = memberships.find((m) => m.org.type === 'partner');
    header = { name, home: staff ? '/admin' : biz ? `/orgs/${biz.org.id}/business` : partner ? `/orgs/${partner.org.id}/partner` : '/orgs' };
  }

  return (
    <html lang={locale} className={`${hanken.variable} ${bricolage.variable} ${tamil.variable}`}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
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

import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'gov.title');
}

const CHOICES = [
  { key: 'financing', href: '/business-help/find?need=financing', icon: '💰' },
  { key: 'grant', href: '/business-help/find?need=grant', icon: '🎁' },
  { key: 'training', href: '/business-help/find?need=training', icon: '📚' },
  { key: 'growth', href: '/business-help/find?need=growth', icon: '📈' },
  { key: 'saved', href: '/business-help/saved', icon: '⭐' },
] as const;

/** Business help home: five large choices, no assessment before browsing. Public; saving needs a signed-in business. */
export default async function BusinessHelpHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'gov' });
  return (
    <>
      <h1>{t('title')}</h1>
      <p>{t('intro')}</p>
      <ul className="gov-need-grid" aria-label={t('title')}>
        {CHOICES.map((c) => (
          <li key={c.key}>
            <Link href={c.href} locale={locale} className="gov-need-button">
              <span aria-hidden="true" className="gov-need-icon">
                {c.icon}
              </span>
              <span>{t(`home.${c.key}`)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p>
        <Link href="/business-help/find" locale={locale}>
          {t('home.all')}
        </Link>
      </p>
      <section aria-labelledby="gov-how-h">
        <h2 id="gov-how-h">{t('home.howTitle')}</h2>
        <ol>
          {(['how1', 'how2', 'how3', 'how4'] as const).map((k) => (
            <li key={k}>{t(`home.${k}`)}</li>
          ))}
        </ol>
      </section>
    </>
  );
}

import { getTranslations } from 'next-intl/server';
import { pageTitle } from '@/lib/metadata';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'legal.termsTitle');
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legal' });
  return (
    <>
      <p className="banner" role="note">
        {t('draftBanner')}
      </p>
      <h1>{t('termsTitle')}</h1>
      <p>{t('termsBody')}</p>
    </>
  );
}

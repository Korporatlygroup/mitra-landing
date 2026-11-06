import { getTranslations } from 'next-intl/server';
import { pageTitle } from '@/lib/metadata';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'legal.privacyTitle');
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legal' });
  return (
    <>
      <p className="banner" role="note">
        {t('draftBanner')}
      </p>
      <h1>{t('privacyTitle')}</h1>
      <p>{t('privacyBody')}</p>
    </>
  );
}

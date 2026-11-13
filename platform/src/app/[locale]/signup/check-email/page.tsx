import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'signup.checkEmailTitle');
}

export default async function CheckEmailPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'signup' });
  return (
    <>
      <h1>{t('checkEmailTitle')}</h1>
      <p>{t('checkEmailBody')}</p>
      <p>
        <Link href="/login" locale={locale} className="btn btn-secondary">
          {t('toLogin')}
        </Link>
      </p>
    </>
  );
}

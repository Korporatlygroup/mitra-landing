import { getTranslations } from 'next-intl/server';
import ActionForm from '@/components/ActionForm';
import { Field } from '@/components/Field';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { forgotPasswordAction } from './actions';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'forgot.title');
}

export default async function ForgotPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'forgot' });
  const nav = await getTranslations({ locale, namespace: 'nav' });
  return (
    <>
      <h1>{t('title')}</h1>
      <p>{t('intro')}</p>
      <ActionForm action={forgotPasswordAction} submitLabel={t('submit')}>
        <Field id="email" name="email" type="email" label={t('email')} required autoComplete="email" inputMode="email" maxLength={254} />
      </ActionForm>
      <p>
        <Link href="/login" locale={locale}>
          {nav('signIn')}
        </Link>
      </p>
    </>
  );
}

import { getTranslations } from 'next-intl/server';
import ActionForm from '@/components/ActionForm';
import { Field } from '@/components/Field';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { getOptionalUser } from '@/server/session';
import { resetPasswordAction } from './actions';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'reset.title');
}

export default async function ResetPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'reset' });
  const { user } = await getOptionalUser();

  if (!user) {
    return (
      <>
        <h1>{t('title')}</h1>
        <p role="alert" className="message message-error">
          <strong>{(await getTranslations({ locale, namespace: 'common' }))('error')}: </strong>
          {t('noSession')}
        </p>
        <p>
          <Link href="/forgot-password" locale={locale} className="btn btn-secondary">
            {t('askAgain')}
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1>{t('title')}</h1>
      <ActionForm action={resetPasswordAction} submitLabel={t('submit')}>
        <input type="hidden" name="locale" value={locale} />
        <Field
          id="password"
          name="password"
          type="password"
          label={t('password')}
          hint={t('hint')}
          required
          autoComplete="new-password"
          minLength={10}
          maxLength={72}
        />
      </ActionForm>
    </>
  );
}

import { getTranslations } from 'next-intl/server';
import ActionForm from '@/components/ActionForm';
import TurnstileField from '@/components/TurnstileField';
import { Field } from '@/components/Field';
import { Link } from '@/i18n/navigation';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { loginAction } from './actions';
import { pageTitle } from '@/lib/metadata';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'login.title');
}

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: 'login' });
  const nav = await getTranslations({ locale, namespace: 'nav' });
  const next = safeRedirectPath(typeof sp.next === 'string' ? sp.next : null, '');
  const linkError = sp.error === 'link_invalid';

  return (
    <>
      <h1>{t('title')}</h1>
      {linkError ? (
        <p role="alert" className="message message-error">
          <strong>{(await getTranslations({ locale, namespace: 'common' }))('error')}: </strong>
          {t('linkInvalid')}
        </p>
      ) : null}
      <ActionForm action={loginAction} submitLabel={t('submit')}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="next" value={next} />
        <Field id="email" name="email" type="email" label={t('email')} required autoComplete="email" inputMode="email" maxLength={254} />
        <Field id="password" name="password" type="password" label={t('password')} required autoComplete="current-password" maxLength={200} />
        <TurnstileField language={locale} />
      </ActionForm>
      <p>
        <Link href="/forgot-password" locale={locale}>
          {(await getTranslations({ locale, namespace: 'forgot' }))('link')}
        </Link>
      </p>
      <p>
        {t('noAccount')}{' '}
        <Link href="/signup" locale={locale}>
          {nav('signUp')}
        </Link>
      </p>
    </>
  );
}

import { getTranslations } from 'next-intl/server';
import ActionForm from '@/components/ActionForm';
import TurnstileField from '@/components/TurnstileField';
import { CheckField, Field, SelectField } from '@/components/Field';
import { Link } from '@/i18n/navigation';
import { signUpAction } from './actions';
import { pageTitle } from '@/lib/metadata';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'signup.title');
}

export default async function SignUpPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  const sp = await searchParams;
  const intent = sp.intent === 'sell' ? 'sell' : '';
  const t = await getTranslations({ locale, namespace: 'signup' });
  const req = (await getTranslations({ locale, namespace: 'common' }))('required');

  return (
    <>
      <h1>{t('title')}</h1>
      <ActionForm action={signUpAction} submitLabel={t('submit')}>
        {intent ? <input type="hidden" name="intent" value={intent} /> : null}
        <Field id="displayName" name="displayName" label={t('displayName')} required requiredLabel={req} autoComplete="name" maxLength={120} />
        <Field id="email" name="email" type="email" label={t('email')} required requiredLabel={req} autoComplete="email" inputMode="email" maxLength={254} />
        <Field
          id="password"
          name="password"
          type="password"
          label={t('password')}
          hint={t('passwordHint')}
          required
          requiredLabel={req}
          autoComplete="new-password"
          minLength={10}
          maxLength={72}
        />
        <details className="signup-more">
          <summary>{t('language')}</summary>
          <SelectField id="language" name="language" label={t('language')} defaultValue={locale}>
            <option value="en">English</option>
            <option value="ta">தமிழ்</option>
            <option value="ms">Bahasa Melayu</option>
          </SelectField>
        </details>
        <fieldset className="signup-consents">
          <legend>{(await getTranslations({ locale, namespace: 'deals' }))('consentLegend')}</legend>
          <CheckField id="acceptTerms" name="acceptTerms" label={t('acceptTerms')} />
          <CheckField id="acceptPrivacy" name="acceptPrivacy" label={t('acceptPrivacy')} />
        </fieldset>
        <TurnstileField language={locale} />
        <CheckField id="acceptMarketing" name="acceptMarketing" label={t('acceptMarketing')} required={false} />
        <p className="hint">{t('marketingHint')}</p>
        <p className="link-row">
          <Link href="/terms" locale={locale}>
            {t('readTerms')}
          </Link>
          <Link href="/privacy" locale={locale}>
            {t('readPrivacy')}
          </Link>
          <Link href="/cookies" locale={locale}>
            {t('readCookies')}
          </Link>
        </p>
      </ActionForm>
      <p>
        {t('haveAccount')}{' '}
        <Link href="/login" locale={locale}>
          {(await getTranslations({ locale, namespace: 'nav' }))('signIn')}
        </Link>
      </p>
    </>
  );
}

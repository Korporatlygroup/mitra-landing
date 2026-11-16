import { getTranslations } from 'next-intl/server';
import ActionForm from '@/components/ActionForm';
import { CheckField, Field, SelectField } from '@/components/Field';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { hasCurrentConsents } from '@/server/services/consent';
import { getMfaStatus } from '@/server/services/mfa';
import { requireSession } from '@/server/session';
import { hasMarketingConsent, listMyPrivacyRequests, PRIVACY_REQUEST_TYPES } from '@/server/services/privacy';
import { changePasswordAction, grantConsentAction, setMarketingAction, signOutAction, submitPrivacyRequestAction, updateProfileAction } from './actions';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'account.title');
}

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const s = await requireSession({ locale, path: '/account', requireMfaIfNeeded: false });
  const t = await getTranslations({ locale, namespace: 'account' });
  const c = await getTranslations({ locale, namespace: 'consent' });
  const signup = await getTranslations({ locale, namespace: 'signup' });
  const [mfa, consented, marketing, myRequests] = await Promise.all([
    getMfaStatus(s.supabase),
    hasCurrentConsents(s.supabase, s.user.id),
    hasMarketingConsent(s.supabase, s.user.id),
    listMyPrivacyRequests(s.supabase),
  ]);
  const next = safeRedirectPath(typeof sp.next === 'string' ? sp.next : null, '');

  return (
    <>
      <h1>{t('title')}</h1>
      <p>
        <strong>{t('emailLabel')}:</strong> {s.user.email}
      </p>

      {consented ? null : (
        <section aria-labelledby="consent-title">
          <h2 id="consent-title">{c('title')}</h2>
          <p>{c('intro')}</p>
          <ActionForm action={grantConsentAction} submitLabel={c('submit')}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="next" value={next} />
            <CheckField id="consent-terms" name="acceptTerms" label={signup('acceptTerms')} />
            <CheckField id="consent-privacy" name="acceptPrivacy" label={signup('acceptPrivacy')} />
            <p className="link-row">
              <Link href="/terms" locale={locale}>
                {signup('readTerms')}
              </Link>
              <Link href="/privacy" locale={locale}>
                {signup('readPrivacy')}
              </Link>
            </p>
          </ActionForm>
        </section>
      )}

      <h2>{t('profileTitle')}</h2>
      {sp.saved === '1' ? (
        <p role="status" className="message message-ok">
          {t('saved')}
        </p>
      ) : null}
      <ActionForm action={updateProfileAction} submitLabel={t('save')}>
        <Field id="displayName" name="displayName" label={t('displayName')} defaultValue={s.profile.display_name} required maxLength={120} autoComplete="name" />
        <SelectField id="language" name="language" label={t('language')} defaultValue={s.profile.language}>
          <option value="en">English</option>
          <option value="ta">தமிழ்</option>
          <option value="ms">Bahasa Melayu</option>
        </SelectField>
      </ActionForm>

      <h2>{t('passwordTitle')}</h2>
      <ActionForm action={changePasswordAction} submitLabel={t('changePassword')}>
        <input type="hidden" name="locale" value={locale} />
        <Field
          id="password"
          name="password"
          type="password"
          label={t('newPassword')}
          hint={t('passwordHint')}
          required
          autoComplete="new-password"
          minLength={10}
          maxLength={72}
        />
      </ActionForm>

      <h2>{t('mfaTitle')}</h2>
      <p>{mfa.verifiedFactorId ? t('mfaOn') : t('mfaOff')}</p>
      {mfa.verifiedFactorId ? null : (
        <p>
          <Link href="/mfa/enrol" locale={locale} className="btn btn-secondary">
            {t('mfaSetUp')}
          </Link>
        </p>
      )}

      <h2 id="privacy-title">{t('privacyTitle')}</h2>
      <p>
        <Link href="/privacy" locale={locale}>
          {signup('readPrivacy')}
        </Link>
      </p>
      <h3>{t('marketingTitle')}</h3>
      <p>{t('marketingIntro')}</p>
      <ActionForm action={setMarketingAction} submitLabel={t('marketingSave')}>
        <input type="hidden" name="locale" value={locale} />
        <CheckField id="marketing" name="marketing" label={signup('acceptMarketing')} required={false} defaultChecked={marketing} />
      </ActionForm>
      <h3>{t('requestsTitle')}</h3>
      <p>{t('requestsIntro')}</p>
      <ActionForm action={submitPrivacyRequestAction} submitLabel={t('requestSubmit')}>
        <input type="hidden" name="locale" value={locale} />
        <SelectField id="request-type" name="type" label={t('requestType')} defaultValue="access">
          {PRIVACY_REQUEST_TYPES.map((k) => (
            <option key={k} value={k}>
              {t(`requestTypes.${k}`)}
            </option>
          ))}
        </SelectField>
        <div className="field">
          <label htmlFor="request-details">{t('requestDetails')}</label>
          <textarea id="request-details" name="details" required maxLength={2000} rows={4} />
        </div>
      </ActionForm>
      {myRequests.length ? (
        <ul className="plain-list" data-testid="my-privacy-requests">
          {myRequests.map((r) => (
            <li key={r.id}>
              <strong>{t(`requestTypes.${r.request_type}`)}</strong> — {t(`requestStatus.${r.status}`)} ({t('requestDue')} {r.due_at.slice(0, 10)})
              {r.response_note ? <> — {r.response_note}</> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <form action={signOutAction}>
        <input type="hidden" name="locale" value={locale} />
        <button type="submit" className="btn btn-secondary">
          {t('signOut')}
        </button>
      </form>
    </>
  );
}

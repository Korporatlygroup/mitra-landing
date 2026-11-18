import { getTranslations } from 'next-intl/server';
import ActionForm from '@/components/ActionForm';
import { CheckField, Field, SelectField } from '@/components/Field';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { hasCurrentConsents } from '@/server/services/consent';
import { getMfaStatus } from '@/server/services/mfa';
import { requireSession } from '@/server/session';
import { hasEmailNotifications, hasMarketingConsent, listMyPrivacyRequests, PRIVACY_REQUEST_TYPES } from '@/server/services/privacy';
import { changePasswordAction, grantConsentAction, setEmailNotificationsAction, setMarketingAction, signOutAction, submitPrivacyRequestAction, updateProfileAction } from './actions';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'account.title');
}

const SECTIONS = ['account', 'security', 'notifications', 'privacy', 'data'] as const;
type Section = (typeof SECTIONS)[number];
const NAV_LABEL: Record<Section, string> = { account: 'navAccount', security: 'navSecurity', notifications: 'navNotifications', privacy: 'navPrivacy', data: 'navData' };
const HINT: Record<Section, string> = { account: 'accountHint', security: 'securityHint', notifications: 'notifHint', privacy: 'privacyHint', data: 'dataHint' };

/** Settings workspace: one section per view (secondary navigation on the left, a scrolling row on phones). The consent prompt stays on top of every section. */
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
  const [mfa, consented, marketing, myRequests, emailNotif] = await Promise.all([
    getMfaStatus(s.supabase),
    hasCurrentConsents(s.supabase, s.user.id),
    hasMarketingConsent(s.supabase, s.user.id),
    listMyPrivacyRequests(s.supabase),
    hasEmailNotifications(s.supabase, s.user.id),
  ]);
  const next = safeRedirectPath(typeof sp.next === 'string' ? sp.next : null, '');
  const section: Section = (SECTIONS as readonly string[]).includes(String(sp.section)) ? (sp.section as Section) : 'account';
  const nextQs = next ? `&next=${encodeURIComponent(next)}` : '';

  return (
    <>
      <PageHeader title={t('title')} sub={t('sub')} />

      {consented ? null : (
        <section aria-labelledby="consent-title" className="acard" style={{ marginBottom: 20 }}>
          <h2 id="consent-title" style={{ margin: 0 }}>
            {c('title')}
          </h2>
          <p style={{ margin: 0 }}>{c('intro')}</p>
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

      <div className="settings-x">
        <nav className="snav" aria-label={t('navLabel')}>
          {SECTIONS.map((k) => (
            <Link key={k} href={`/account${k === 'account' && !next ? '' : `?section=${k}${nextQs}`}`} className="snav-i" aria-current={section === k ? 'page' : undefined}>
              {t(NAV_LABEL[k])}
            </Link>
          ))}
          <form action={signOutAction} className="snav-out">
            <input type="hidden" name="locale" value={locale} />
            <button type="submit" className="btn btn-ghost btn-sm">
              {t('signOut')}
            </button>
          </form>
        </nav>

        <div className="settings-main">
          <div className="sechead" style={{ marginBottom: 4 }}>
            <h2 id="settings-h">{t(NAV_LABEL[section])}</h2>
          </div>
          <p className="mut" style={{ margin: '0 0 16px', fontSize: '0.875rem' }}>
            {t(HINT[section])}
          </p>

          {section === 'account' ? (
            <section className="acard" aria-labelledby="profile-h">
              <h3 id="profile-h" style={{ margin: 0 }}>
                {t('profileTitle')}
              </h3>
              <p className="mut" style={{ margin: 0, fontSize: '0.875rem' }}>
                {t('signedInAs')} <strong>{s.user.email}</strong>
              </p>
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
            </section>
          ) : null}

          {section === 'security' ? (
            <div className="stack-x">
              <section className="acard" aria-labelledby="pw-h">
                <h3 id="pw-h" style={{ margin: 0 }}>
                  {t('passwordTitle')}
                </h3>
                <ActionForm action={changePasswordAction} submitLabel={t('changePassword')}>
                  <input type="hidden" name="locale" value={locale} />
                  <Field id="password" name="password" type="password" label={t('newPassword')} hint={t('passwordHint')} required autoComplete="new-password" minLength={10} maxLength={72} />
                </ActionForm>
              </section>
              <section className="acard" aria-labelledby="mfa-h">
                <div className="rrow-top">
                  <h3 id="mfa-h" style={{ margin: 0 }}>
                    {t('mfaTitle')}
                  </h3>
                  <StatusBadge label={mfa.verifiedFactorId ? t('mfaStateOn') : t('mfaStateOff')} tone={mfa.verifiedFactorId ? 'green' : 'neutral'} />
                </div>
                <p style={{ margin: 0 }}>{mfa.verifiedFactorId ? t('mfaOn') : t('mfaOff')}</p>
                {mfa.verifiedFactorId ? null : (
                  <div>
                    <Link href="/mfa/enrol" locale={locale} className="btn btn-secondary">
                      {t('mfaSetUp')}
                    </Link>
                  </div>
                )}
              </section>
            </div>
          ) : null}

          {section === 'notifications' ? (
            <div className="stack-x">
              <section className="acard" aria-labelledby="en-h">
                <h3 id="en-h" style={{ margin: 0 }}>
                  {t('emailNotifTitle')}
                </h3>
                <p style={{ margin: 0 }}>{t('emailNotifIntro')}</p>
                <ActionForm action={setEmailNotificationsAction} submitLabel={t('emailNotifSave')}>
                  <input type="hidden" name="locale" value={locale} />
                  <CheckField id="notify" name="notify" label={t('emailNotifLabel')} required={false} defaultChecked={emailNotif} />
                </ActionForm>
              </section>
              <section className="acard" aria-labelledby="mk-h">
                <h3 id="mk-h" style={{ margin: 0 }}>
                  {t('marketingTitle')}
                </h3>
                <p style={{ margin: 0 }}>{t('marketingIntro')}</p>
                <ActionForm action={setMarketingAction} submitLabel={t('marketingSave')}>
                  <input type="hidden" name="locale" value={locale} />
                  <CheckField id="marketing" name="marketing" label={signup('acceptMarketing')} required={false} defaultChecked={marketing} />
                </ActionForm>
              </section>
            </div>
          ) : null}

          {section === 'privacy' ? (
            <section className="acard" aria-labelledby="privacy-title">
              <h3 id="privacy-title" style={{ margin: 0 }}>
                {t('privacyTitle')}
              </h3>
              <p style={{ margin: 0 }}>{t('privacyHint')}</p>
              <ul className="stack-x" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                <li>
                  <Link href="/privacy" locale={locale}>
                    {signup('readPrivacy')}
                  </Link>
                </li>
                <li>
                  <Link href="/terms" locale={locale}>
                    {signup('readTerms')}
                  </Link>
                </li>
              </ul>
            </section>
          ) : null}

          {section === 'data' ? (
            <div className="stack-x">
              <section className="acard" aria-labelledby="dr-h">
                <h3 id="dr-h" style={{ margin: 0 }}>
                  {t('requestsTitle')}
                </h3>
                <p style={{ margin: 0 }}>{t('requestsIntro')}</p>
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
              </section>
              {myRequests.length ? (
                <ul className="stack-x" style={{ listStyle: 'none', padding: 0, margin: 0 }} data-testid="my-privacy-requests">
                  {myRequests.map((r) => (
                    <li key={r.id} className="rrow">
                      <div className="rrow-top">
                        <strong>{t(`requestTypes.${r.request_type}`)}</strong>
                        <StatusBadge label={t(`requestStatus.${r.status}`)} />
                      </div>
                      <div className="meta">
                        <span>
                          {t('requestDue')} {r.due_at.slice(0, 10)}
                        </span>
                      </div>
                      {r.response_note ? <p style={{ margin: 0 }}>{r.response_note}</p> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import ActionForm from '@/components/ActionForm';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { createClient } from '@/lib/supabase/server';
import { getMfaStatus } from '@/server/services/mfa';
import { requireSession } from '@/server/session';
import { verifyMfaAction } from './actions';
import { pageTitle } from '@/lib/metadata';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'mfa.verifyTitle');
}

export default async function MfaVerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const next = safeRedirectPath(typeof sp.next === 'string' ? sp.next : null, `/${locale}`);
  await requireSession({ locale, path: '/mfa/verify', requireMfaIfNeeded: false });

  const mfa = await getMfaStatus(await createClient());
  if (!mfa.verifiedFactorId) redirect(`/${locale}/mfa/enrol?next=${encodeURIComponent(next)}`);
  if (mfa.currentLevel === 'aal2') redirect(next);

  const t = await getTranslations({ locale, namespace: 'mfa' });
  return (
    <>
      <h1>{t('verifyTitle')}</h1>
      <p>{t('verifyIntro')}</p>
      <ActionForm action={verifyMfaAction} submitLabel={t('verifySubmit')}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="next" value={next} />
        <div className="field">
          <label htmlFor="code">{t('codeLabel')}</label>
          <input id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required />
        </div>
      </ActionForm>
    </>
  );
}

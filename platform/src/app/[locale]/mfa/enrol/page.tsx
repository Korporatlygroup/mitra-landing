import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/server/session';
import { getMfaStatus } from '@/server/services/mfa';
import EnrolFlow from './EnrolFlow';
import { pageTitle } from '@/lib/metadata';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'mfa.enrolTitle');
}

export default async function MfaEnrolPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const next = safeRedirectPath(typeof sp.next === 'string' ? sp.next : null, `/${locale}/account`);
  await requireSession({ locale, path: '/mfa/enrol', requireMfaIfNeeded: false });

  const mfa = await getMfaStatus(await createClient());
  if (mfa.verifiedFactorId) {
    // Already enrolled: finish at aal2 via the verify page (or just continue if already aal2).
    redirect(mfa.currentLevel === 'aal2' ? next : `/${locale}/mfa/verify?next=${encodeURIComponent(next)}`);
  }

  const t = await getTranslations({ locale, namespace: 'mfa' });
  return (
    <>
      <h1>{t('enrolTitle')}</h1>
      <p>{t('enrolWhy')}</p>
      <EnrolFlow locale={locale} next={next} />
    </>
  );
}

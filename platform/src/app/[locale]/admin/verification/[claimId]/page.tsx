import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import ClaimReview from '@/components/admin/ClaimReview';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { uuidSchema } from '@/lib/schemas';
import { requireReviewer } from '@/server/reviewer';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'adminVer.title');
}

/** The full page of one claim (the queue shows the same review in a side drawer). */
export default async function AdminClaimPage({ params }: { params: Promise<{ locale: string; claimId: string }> }) {
  const { locale, claimId } = await params;
  if (!uuidSchema.safeParse(claimId).success) notFound();
  const { session, canReview, canDecide } = await requireReviewer(locale, `/admin/verification/${claimId}`);
  const t = await getTranslations({ locale });

  if (!canReview) {
    return (
      <p role="alert" className="message message-error">
        {t('adminVer.noAccess')}
      </p>
    );
  }
  return (
    <>
      <p style={{ margin: 0 }}>
        <Link href="/admin/verification">{t('adminVer.back')}</Link>
      </p>
      <div className="card" style={{ padding: 24 }}>
        <ClaimReview claimId={claimId} locale={locale} db={session.supabase} canDecide={canDecide} headingLevel={1} />
      </div>
    </>
  );
}

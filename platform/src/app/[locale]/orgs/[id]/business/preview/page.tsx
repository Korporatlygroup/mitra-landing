import { getFormatter, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { requireBusinessContext } from '@/server/business-context';
import { getBusinessProfile, getVerificationSummary, listCategories } from '@/server/services/verification';
import { catName } from '@/lib/category';
import EmptyState from '@/components/shared/EmptyState';
import PageHeader from '@/components/shared/PageHeader';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'preview.title');
}

/**
 * How the profile reads publicly. Wording rule: only "documents reviewed by MITRA ... for: <scope>".
 * Never shows the street address, postcode or contact details.
 */
export default async function PreviewPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const ctx = await requireBusinessContext(locale, id, '/preview');
  const t = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  const db = ctx.session.supabase;

  const [profile, categories, claims] = await Promise.all([getBusinessProfile(db, id), listCategories(db), getVerificationSummary(db, id)]);
  const base = `/orgs/${id}/business`;

  if (!profile) {
    return (
      <>
        <PageHeader title={t('preview.title')} sub={t('biz.notStarted')} />
        <EmptyState icon="store" title={t('biz.notStarted')} text={t('preview.title')} action={{ href: `${base}/onboarding?step=1`, label: t('biz.next.start') }} />
      </>
    );
  }

  const category = categories.find((c) => c.id === profile.category_id);
  // Statuses come from get_verification_summary, so staff and viewers see the real state too.
  const approved = claims.filter((c) => c.status === 'approved' && c.decided_at);
  const place = [profile.district, profile.state].filter(Boolean).join(', ');

  return (
    <>
      <PageHeader title={t('preview.title')} />
      <p className="banner" role="note">
        {t('preview.banner')}
      </p>

      <article className="card" aria-labelledby="pv-name">
        <h2 id="pv-name" style={{ marginTop: 0 }}>
          {profile.business_name}
        </h2>
        <dl className="dl">
          <dt>{t('preview.category')}</dt>
          <dd>{category ? (catName(locale, category)) : '-'}</dd>
          <dt>{t('preview.location')}</dt>
          <dd>{place || t('preview.noLocation')}</dd>
        </dl>

        {profile.registration_status === 'unregistered' ? (
          <p>
            <strong>{t('preview.unregistered')}</strong>
          </p>
        ) : (
          <p>
            {t('preview.registeredNote')}
            {approved.length === 0 ? ` ${t('preview.notReviewedYet')}` : ''}
          </p>
        )}

        {approved.length === 0 ? (
          <p>
            <strong>{t('preview.unverified')}</strong>. {t('preview.nothingReviewed')}
          </p>
        ) : (
          <ul>
            {approved.map((c) => (
              <li key={c.claim_type}>
                {t('preview.reviewedOn', {
                  date: fmt.dateTime(new Date(c.decided_at as string), { dateStyle: 'long', timeZone: 'UTC' }),
                  scope: t(`claimScope.${c.claim_type}`),
                })}
              </li>
            ))}
          </ul>
        )}
      </article>
      <p>
        <Link href={base} locale={locale}>
          {t('biz.title')}
        </Link>
      </p>
    </>
  );
}

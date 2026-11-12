import { getTranslations } from 'next-intl/server';
import ListingView from '@/components/ListingView';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { requireBusinessContext } from '@/server/business-context';
import { getOwnerListing } from '@/server/services/directory';
import { getBusinessProfile, getVerificationSummary, listCategories } from '@/server/services/verification';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'listing.previewTitle');
}

/** The saved draft exactly as it would read publicly. Nothing here is public until MITRA approves it. */
export default async function ListingPreviewPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const ctx = await requireBusinessContext(locale, id, '/listing/preview');
  const db = ctx.session.supabase;
  const t = await getTranslations({ locale });
  const [profile, listing, categories, claims] = await Promise.all([
    getBusinessProfile(db, id),
    getOwnerListing(db, id),
    listCategories(db),
    getVerificationSummary(db, id),
  ]);
  const back = `/orgs/${id}/business/listing`;
  const draft = listing?.draft;
  if (!profile || !draft || !draft.headline) {
    return (
      <>
        <h1>{t('listing.previewTitle')}</h1>
        <p>{t('listing.previewEmpty')}</p>
        <Link href={back} locale={locale} className="btn btn-primary">
          {t('listing.title')}
        </Link>
      </>
    );
  }
  const cat = categories.find((c) => c.id === profile.category_id) ?? null;
  const reviewed = claims.filter((c) => c.status === 'approved' && c.decided_at).map((c) => ({ claim_type: c.claim_type, decided_at: c.decided_at }));
  return (
    <>
      <p>
        <Link href={back} locale={locale}>
          {t('listing.back')}
        </Link>
      </p>
      <p className="banner" role="note">
        {t('listing.previewBanner')}
      </p>
      <ListingView
        locale={locale}
        data={{
          name: profile.business_name,
          category: cat,
          state: profile.state,
          district: profile.district,
          headline: draft.headline ?? null,
          description: draft.description ?? null,
          phone: draft.show_phone ? (draft.public_phone ?? null) : null,
          email: draft.show_email ? (draft.public_email ?? null) : null,
          reviewed,
          accepting_requests: listing.accepting_requests,
          service_details: draft.services ?? [],
          portfolio: draft.portfolio ?? [],
        }}
      />
    </>
  );
}

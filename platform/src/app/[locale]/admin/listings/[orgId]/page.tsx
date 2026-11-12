import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import ActionForm from '@/components/ActionForm';
import ListingView from '@/components/ListingView';
import StatusChip from '@/components/StatusChip';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { uuidSchema } from '@/lib/schemas';
import { requireModerator } from '@/server/reviewer';
import { getOwnerListing, listListingEvents } from '@/server/services/directory';
import { listCategories } from '@/server/services/verification';
import { reviewListingAction, suspendListingAction } from '../actions';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'adminList.reviewTitle');
}

export default async function AdminListingReviewPage({ params }: { params: Promise<{ locale: string; orgId: string }> }) {
  const { locale, orgId } = await params;
  if (!uuidSchema.safeParse(orgId).success) notFound();
  const { session, canReviewListings } = await requireModerator(locale, `/admin/listings/${orgId}`);
  const t = await getTranslations({ locale });
  if (!canReviewListings) {
    return (
      <p role="alert" className="message message-error">
        {t('adminList.noAccess')}
      </p>
    );
  }
  const db = session.supabase;
  const [l, events, categories] = await Promise.all([getOwnerListing(db, orgId), listListingEvents(db, orgId, 20), listCategories(db)]);
  if (!l) notFound();
  const d = l.draft;
  const prof = d.profile;
  const cat = categories.find((c) => c.id === prof?.category_id) ?? null;
  const pending = l.review_status === 'pending_review';
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgId" value={orgId} />
    </>
  );

  return (
    <>
      <p>
        <Link href="/admin/listings" locale={locale}>
          {t('adminList.title')}
        </Link>
      </p>
      <h1>{prof?.business_name ?? l.live_name ?? t('adminList.reviewTitle')}</h1>
      <p>
        <StatusChip status={pending ? 'needs_info' : l.live_status === 'published' ? 'approved' : l.live_status === 'suspended' ? 'rejected' : 'none'} label={`${t(`listing.live.${l.live_status}`)} / ${t(`listing.review.${l.review_status}`)}`} />
      </p>
      <p className="muted">{t('adminList.privacyNote')}</p>

      {pending && prof ? (
        <>
          <h2>{t('adminList.submittedContent')}</h2>
          <div className="card">
            <ListingView
              locale={locale}
              headingLevel={2}
              data={{
                name: prof.business_name,
                category: cat,
                state: prof.state,
                district: prof.district,
                headline: d.headline ?? null,
                description: d.description ?? null,
                phone: d.show_phone ? (d.public_phone ?? null) : null,
                email: d.show_email ? (d.public_email ?? null) : null,
                reviewed: [],
                accepting_requests: l.accepting_requests,
                service_details: d.services ?? [],
                portfolio: d.portfolio ?? [],
              }}
            />
          </div>
          <h2>{t('adminList.decision')}</h2>
          <ActionForm action={reviewListingAction} submitLabel={t('adminList.save')}>
            {hidden}
            <input type="hidden" name="expectedVersion" value={l.draft_version} />
            <fieldset>
              <legend>{t('adminList.decisionLegend')}</legend>
              {(['approve', 'request_changes', 'reject'] as const).map((x) => (
                <div className="radio" key={x}>
                  <input id={`dec-${x}`} type="radio" name="decision" value={x} required />
                  <label htmlFor={`dec-${x}`}>{t(`adminList.decisions.${x}`)}</label>
                </div>
              ))}
            </fieldset>
            <div className="field">
              <label htmlFor="reason">{t('adminList.reason')}</label>
              <p className="hint">{t('adminList.reasonHint')}</p>
              <textarea id="reason" name="reason" rows={4} maxLength={1000} />
            </div>
          </ActionForm>
        </>
      ) : (
        <p>{t('adminList.nothingPending')}</p>
      )}

      {l.live_status === 'published' || l.live_status === 'suspended' ? (
        <section aria-labelledby="sus-h">
          <h2 id="sus-h">{l.live_status === 'published' ? t('adminList.suspendTitle') : t('adminList.reinstateTitle')}</h2>
          <ActionForm action={suspendListingAction} submitLabel={l.live_status === 'published' ? t('adminList.suspend') : t('adminList.reinstate')} variant={l.live_status === 'published' ? 'danger' : 'primary'}>
            {hidden}
            <input type="hidden" name="mode" value={l.live_status === 'published' ? 'suspend' : 'reinstate'} />
            <div className="field">
              <label htmlFor="sreason">{t('adminList.reason')}</label>
              <textarea id="sreason" name="reason" rows={3} required minLength={5} maxLength={1000} />
            </div>
          </ActionForm>
        </section>
      ) : null}

      <section aria-labelledby="hist-h">
        <h2 id="hist-h">{t('listing.historyTitle')}</h2>
        {events.length === 0 ? (
          <p>{t('adminList.noHistory')}</p>
        ) : (
          <ul className="timeline">
            {events.map((e) => (
              <li key={e.id}>
                {t(`listing.events.${e.event}`)}
                {e.details?.reason ? `: ${e.details.reason}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

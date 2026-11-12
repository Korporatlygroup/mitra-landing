import { getTranslations } from 'next-intl/server';
import ActionForm from '@/components/ActionForm';
import { getRolePermissions } from '@/server/services/orgs';
import { requireSession } from '@/server/session';
import { moderateResponseAction, moderateReviewAction } from './actions';

export default async function AdminReviewsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await requireSession({ locale, path: '/admin/reviews' });
  const staff = session.memberships.find((m) => m.org.type === 'mitra');
  const perms = staff ? await getRolePermissions(session.supabase, staff.role) : new Set<string>();
  const t = await getTranslations({ locale, namespace: 'p4' });
  if (!perms.has('review:moderate')) return <p role="alert">{t('noAccess')}</p>;
  const [reviewResult, responseResult] = await Promise.all([
    session.supabase.from('business_reviews').select('id,rating,review_text,status,created_at').in('status', ['pending','flagged']).order('created_at').limit(50),
    session.supabase.from('business_reviews').select('id,rating,review_text,seller_response').eq('status','published').eq('seller_response_status','pending').order('updated_at').limit(50),
  ]);
  const reviews = reviewResult.data;
  const responses = responseResult.data;
  return <><h1>{t('moderateReviews')}</h1>
    {(reviews?.length ?? 0) + (responses?.length ?? 0) === 0 ? <p>{t('noPendingReviews')}</p> : null}
    {(reviews?.length ?? 0) > 0 ? <ul className="card-list">{reviews!.map((review) => <li key={review.id} className="card">
      <p><strong>{review.rating}/5</strong> · {review.status}</p><p>{review.review_text}</p>
      <ActionForm action={moderateReviewAction} submitLabel={t('decideReview')}>
        <input type="hidden" name="reviewId" value={review.id} />
        <label htmlFor={`review-status-${review.id}`}>{t('reviewDecision')}</label>
        <select id={`review-status-${review.id}`} name="status"><option value="published">{t('publishReview')}</option><option value="removed">{t('removeReview')}</option><option value="flagged">{t('flagReview')}</option></select>
        <label htmlFor={`review-reason-${review.id}`}>{t('moderationReason')}</label>
        <textarea id={`review-reason-${review.id}`} name="reason" minLength={3} maxLength={1000} required />
      </ActionForm>
    </li>)}</ul> : null}
    {(responses?.length ?? 0) > 0 ? <section aria-labelledby="response-review-heading"><h2 id="response-review-heading">{t('moderateResponses')}</h2>
      <ul className="card-list">{responses!.map((review) => <li key={review.id} className="card">
        <p>{t('review')}: {review.review_text}</p><p>{t('sellerResponse')}: {review.seller_response}</p>
        <ActionForm action={moderateResponseAction} submitLabel={t('decideReview')}>
          <input type="hidden" name="reviewId" value={review.id} />
          <label htmlFor={`response-decision-${review.id}`}>{t('reviewDecision')}</label>
          <select id={`response-decision-${review.id}`} name="decision"><option value="approve">{t('publishReview')}</option><option value="remove">{t('removeReview')}</option></select>
          <label htmlFor={`response-reason-${review.id}`}>{t('moderationReason')}</label>
          <textarea id={`response-reason-${review.id}`} name="reason" minLength={3} maxLength={1000} required />
        </ActionForm>
      </li>)}</ul></section> : null}
  </>;
}

import { getTranslations } from 'next-intl/server';
import ActionForm from '@/components/ActionForm';
import EmptyState from '@/components/shared/EmptyState';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import { getRolePermissions } from '@/server/services/orgs';
import { requireSession } from '@/server/session';
import { moderateResponseAction, moderateReviewAction } from './actions';

/** Review moderation: new or flagged reviews, then business responses waiting for approval. Every decision needs a written reason. */
export default async function AdminReviewsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await requireSession({ locale, path: '/admin/reviews' });
  const staff = session.memberships.find((m) => m.org.type === 'mitra');
  const perms = staff ? await getRolePermissions(session.supabase, staff.role) : new Set<string>();
  const t = await getTranslations({ locale, namespace: 'p4' });
  if (!perms.has('review:moderate')) return <p role="alert">{t('noAccess')}</p>;
  const [reviewResult, responseResult] = await Promise.all([
    session.supabase.from('business_reviews').select('id,rating,review_text,status,created_at').in('status', ['pending', 'flagged']).order('created_at').limit(50),
    session.supabase.from('business_reviews').select('id,rating,review_text,seller_response').eq('status', 'published').eq('seller_response_status', 'pending').order('updated_at').limit(50),
  ]);
  const reviews = reviewResult.data ?? [];
  const responses = responseResult.data ?? [];
  return (
    <>
      <PageHeader title={t('moderateReviews')} />
      {reviews.length + responses.length === 0 ? <EmptyState icon="star" title={t('noPendingReviews')} text={t('moderateReviews')} /> : null}
      {reviews.length > 0 ? (
        <ul className="stack-x" style={{ listStyle: 'none', padding: 0, margin: '0 0 24px' }}>
          {reviews.map((review) => (
            <li key={review.id} className="rrow">
              <div className="rrow-top">
                <strong>{review.rating}/5</strong>
                <StatusBadge label={review.status} tone={review.status === 'flagged' ? 'red' : 'gold'} />
              </div>
              <p style={{ margin: 0 }}>{review.review_text}</p>
              <details className="rgroup">
                <summary>{t('decideReview')}</summary>
                <ActionForm action={moderateReviewAction} submitLabel={t('decideReview')}>
                  <input type="hidden" name="reviewId" value={review.id} />
                  <label htmlFor={`review-status-${review.id}`}>{t('reviewDecision')}</label>
                  <select id={`review-status-${review.id}`} name="status">
                    <option value="published">{t('publishReview')}</option>
                    <option value="removed">{t('removeReview')}</option>
                    <option value="flagged">{t('flagReview')}</option>
                  </select>
                  <label htmlFor={`review-reason-${review.id}`}>{t('moderationReason')}</label>
                  <textarea id={`review-reason-${review.id}`} name="reason" minLength={3} maxLength={1000} required />
                </ActionForm>
              </details>
            </li>
          ))}
        </ul>
      ) : null}
      {responses.length > 0 ? (
        <section aria-labelledby="response-review-heading">
          <div className="sechead">
            <h2 id="response-review-heading">{t('moderateResponses')}</h2>
          </div>
          <ul className="stack-x" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {responses.map((review) => (
              <li key={review.id} className="rrow">
                <p style={{ margin: 0 }}>
                  <span className="mut">{t('review')}:</span> {review.review_text}
                </p>
                <p style={{ margin: 0 }}>
                  <span className="mut">{t('sellerResponse')}:</span> {review.seller_response}
                </p>
                <details className="rgroup">
                  <summary>{t('decideReview')}</summary>
                  <ActionForm action={moderateResponseAction} submitLabel={t('decideReview')}>
                    <input type="hidden" name="reviewId" value={review.id} />
                    <label htmlFor={`response-decision-${review.id}`}>{t('reviewDecision')}</label>
                    <select id={`response-decision-${review.id}`} name="decision">
                      <option value="approve">{t('publishReview')}</option>
                      <option value="remove">{t('removeReview')}</option>
                    </select>
                    <label htmlFor={`response-reason-${review.id}`}>{t('moderationReason')}</label>
                    <textarea id={`response-reason-${review.id}`} name="reason" minLength={3} maxLength={1000} required />
                  </ActionForm>
                </details>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

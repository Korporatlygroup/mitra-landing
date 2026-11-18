import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import ActionForm from '@/components/ActionForm';
import { Field } from '@/components/Field';
import EmptyState from '@/components/shared/EmptyState';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge, { type BadgeTone } from '@/components/shared/StatusBadge';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { uuidSchema } from '@/lib/schemas';
import { getBuyerRequest, listRequestMatches, type MatchRow } from '@/server/services/directory';
import { requireSession } from '@/server/session';
import { listCategories } from '@/server/services/verification';
import { endRequestAction, findMoreAction, inviteSellerAction } from '../actions';
import { catName } from '@/lib/category';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'req.detailTitle');
}

const MAX_INVITES = 10;
const MATCH_TONE = (s: string): BadgeTone => (s === 'interested' || s === 'question' ? 'green' : s === 'declined' ? 'neutral' : 'brand');

async function MatchCard({ m, requestId, open, locale }: { m: MatchRow; requestId: string; open: boolean; locale: string }) {
  const t = await getTranslations({ locale });
  const listing = m.listing;
  const place = [listing.district, listing.state].filter(Boolean).join(', ');
  return (
    <li className="rrow" data-testid="match-card">
      <div className="rrow-top">
        <h3>
          {m.available && listing.slug ? (
            <Link href={`/directory/${listing.slug}`} locale={locale}>
              {listing.name}
            </Link>
          ) : (
            listing.name
          )}
        </h3>
        <StatusBadge label={t(`match.status.${m.status}`)} tone={MATCH_TONE(m.status)} />
      </div>
      {place ? <div className="meta"><span>{place}</span></div> : null}
      {listing.headline ? <p style={{ margin: 0 }}>{listing.headline}</p> : null}
      {m.reason_codes.length > 0 ? (
        <div>
          <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: '0.875rem' }}>{t('match.whyTitle')}</p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.875rem' }}>
            {m.reason_codes.map((c) => (
              <li key={c}>{t(`match.reason.${c}`)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {m.caution_codes.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.875rem' }}>
          {m.caution_codes.map((c) => (
            <li key={c}>
              <strong>{t('match.check')}: </strong>
              {t(`match.caution.${c}`)}
            </li>
          ))}
        </ul>
      ) : null}
      {m.response_note ? (
        <p className="acard" style={{ margin: 0 }}>
          <strong>{t('match.theirReply')}: </strong>
          {m.response_note}
        </p>
      ) : null}
      {m.enquiry_id ? (
        <div className="rrow-foot">
          <Link href={`/enquiries/${m.enquiry_id}`} locale={locale} className="btn btn-secondary btn-sm">
            {t('match.openEnquiry')}
          </Link>
        </div>
      ) : null}
      {m.status === 'candidate' && open && m.available ? (
        <ActionForm action={inviteSellerAction} submitLabel={t('match.invite')}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="sellerOrgId" value={m.seller_org_id} />
        </ActionForm>
      ) : null}
      {!m.available && m.status !== 'candidate' ? <p className="muted" style={{ margin: 0 }}>{t('match.unavailable')}</p> : null}
    </li>
  );
}

/** One request: status header, a summary panel, who was invited and what they replied, suggested businesses to invite, and how to end it. */
export default async function RequestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  const sp = await searchParams;
  if (!uuidSchema.safeParse(id).success) notFound();
  const session = await requireSession({ locale, requireOrg: true, path: `/requests/${id}` });
  const t = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  const db = session.supabase;

  const [r, matches, categories] = await Promise.all([getBuyerRequest(db, id), listRequestMatches(db, id), listCategories(db)]);
  if (!r) notFound();
  if (r.status === 'draft') redirect(`/${locale}/requests/new?step=1&id=${id}`);
  const cat = categories.find((c) => c.id === r.category_id);
  const open = r.status === 'open';
  const candidates = matches.filter((m) => m.status === 'candidate');
  const invited = matches.filter((m) => m.status !== 'candidate' && m.invited_at);
  const interested = invited.filter((m) => m.status === 'interested' || m.status === 'question').length;
  const ended = r.closed_reason;
  const date = (d: string | null) => (d ? fmt.dateTime(new Date(d), { dateStyle: 'medium', timeZone: 'UTC' }) : '-');

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/requests" locale={locale}>
            {t('req.title')}
          </Link>
        }
        title={r.title ?? t('req.untitled')}
        sub={`${t('req.s5.visLabel')}: ${r.visibility === 'eligible_sellers' ? t('req.s5.visShownBoard') : t('req.s5.visShownPrivate')}`}
        actions={
          <>
            <StatusBadge label={t(`req.status.${r.status}`)} tone={open ? 'green' : r.status === 'removed' ? 'red' : 'neutral'} />
            <Link href={`/requests/${id}/quotes`} locale={locale} className="btn btn-secondary">
              {t('p4.compareTitle')}
            </Link>
          </>
        }
      />
      {sp.sent ? (
        <p className="message message-ok" role="status">
          {t('req.sentNote', { n: candidates.length })}
        </p>
      ) : null}
      {r.status === 'removed' ? <p className="message message-error">{t('req.removedNote')}</p> : null}
      {ended && r.status !== 'removed' ? <p className="muted">{ended}</p> : null}

      <div className="split-x">
        <div className="stack-x" style={{ gap: 24 }}>
          <section aria-labelledby="inv-h">
            <div className="sechead">
              <h2 id="inv-h">{t('req.invitedTitle')}</h2>
              <span className="chip-x brand">{t('req.counts', { invited: invited.length, interested, declined: invited.filter((m) => m.status === 'declined').length })}</span>
            </div>
            {invited.length === 0 ? (
              <EmptyState icon="users" title={t('req.noneInvited')} text={open ? t('req.nextOpen') : t('req.title')} />
            ) : (
              <ul className="stack-x" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {invited.map((m) => (
                  <MatchCard key={m.seller_org_id} m={m} requestId={id} open={open} locale={locale} />
                ))}
              </ul>
            )}
          </section>

          {open ? (
            <section aria-labelledby="cand-h">
              <div className="sechead">
                <h2 id="cand-h">{t('req.candidatesTitle')}</h2>
                <span className="mut" style={{ fontSize: '0.8125rem' }}>
                  {t('req.inviteBound', { used: invited.length, max: MAX_INVITES })}
                </span>
              </div>
              <p className="mut" style={{ margin: '0 0 12px', fontSize: '0.875rem' }}>
                {t('match.disclaimer')}
              </p>
              {candidates.length === 0 ? (
                <EmptyState icon="search" title={t('match.noneTitle')} text={t('match.noneBody')} action={{ href: '/directory', label: t('match.browse') }} />
              ) : (
                <ul className="stack-x" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {candidates.map((m) => (
                    <MatchCard key={m.seller_org_id} m={m} requestId={id} open={open} locale={locale} />
                  ))}
                </ul>
              )}
              <div style={{ marginTop: 12 }}>
                <ActionForm action={findMoreAction} submitLabel={t('match.widen')} variant="secondary">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="requestId" value={id} />
                  <input type="hidden" name="broaden" value="true" />
                  <p className="hint">{t('match.widenHint')}</p>
                </ActionForm>
                <p>
                  <Link href="/directory" locale={locale}>
                    {t('match.browse')}
                  </Link>
                </p>
              </div>
            </section>
          ) : null}
        </div>

        <aside className="stack-x" style={{ gap: 20 }}>
          <section className="acard" aria-labelledby="sum-h">
            <h2 id="sum-h" style={{ margin: 0, fontSize: '1.0625rem' }}>
              {t('req.s4.description')}
            </h2>
            <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{r.description}</p>
            <dl className="pcard-facts" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div>
                <dt>{t('req.s1.category')}</dt>
                <dd>{cat ? catName(locale, cat) : '-'}</dd>
              </div>
              <div>
                <dt>{t('req.s2.state')}</dt>
                <dd>{[r.target_district, r.target_state].filter(Boolean).join(', ') || '-'}</dd>
              </div>
              <div>
                <dt>{t('req.s3.quantity')}</dt>
                <dd>{r.quantity ? `${r.quantity} ${r.unit ?? ''}` : '-'}</dd>
              </div>
              <div>
                <dt>{t('req.s3.neededBy')}</dt>
                <dd>{r.needed_by ?? '-'}</dd>
              </div>
              <div>
                <dt>{t('req.expires')}</dt>
                <dd>{date(r.expires_at)}</dd>
              </div>
            </dl>
          </section>

          {open ? (
            <section className="acard" aria-labelledby="end-h">
              <h2 id="end-h" style={{ margin: 0, fontSize: '1.0625rem' }}>
                {t('req.endTitle')}
              </h2>
              <ActionForm action={endRequestAction} submitLabel={t('req.closeDone')} variant="secondary">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="requestId" value={id} />
                <input type="hidden" name="status" value="closed" />
                <Field id="close-reason" name="reason" label={t('req.endReason')} maxLength={500} />
              </ActionForm>
              <ActionForm action={endRequestAction} submitLabel={t('req.withdraw')} variant="danger">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="requestId" value={id} />
                <input type="hidden" name="status" value="withdrawn" />
                <p className="hint">{t('req.withdrawHint')}</p>
              </ActionForm>
            </section>
          ) : null}
        </aside>
      </div>
    </>
  );
}

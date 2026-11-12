import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import ActionForm from '@/components/ActionForm';
import { Field } from '@/components/Field';
import StatusChip from '@/components/StatusChip';
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

async function MatchCard({ m, requestId, open, locale }: { m: MatchRow; requestId: string; open: boolean; locale: string }) {
  const t = await getTranslations({ locale });
  const listing = m.listing;
  const place = [listing.district, listing.state].filter(Boolean).join(', ');
  return (
    <li className="card" data-testid="match-card">
      <h3 style={{ marginTop: 0 }}>
        {m.available && listing.slug ? (
          <Link href={`/directory/${listing.slug}`} locale={locale}>
            {listing.name}
          </Link>
        ) : (
          listing.name
        )}
      </h3>
      {place ? <p className="muted" style={{ margin: '0 0 6px' }}>{place}</p> : null}
      {listing.headline ? <p style={{ margin: '0 0 6px' }}>{listing.headline}</p> : null}
      {m.reason_codes.length > 0 ? (
        <>
          <p style={{ margin: '0 0 4px' }}>
            <strong>{t('match.whyTitle')}</strong>
          </p>
          <ul style={{ margin: '0 0 8px' }}>
            {m.reason_codes.map((c) => (
              <li key={c}>{t(`match.reason.${c}`)}</li>
            ))}
          </ul>
        </>
      ) : null}
      {m.caution_codes.length > 0 ? (
        <ul style={{ margin: '0 0 8px' }}>
          {m.caution_codes.map((c) => (
            <li key={c}>
              <strong>{t('match.check')}: </strong>
              {t(`match.caution.${c}`)}
            </li>
          ))}
        </ul>
      ) : null}
      <p style={{ margin: '0 0 8px' }}>
        <StatusChip status={m.status === 'interested' || m.status === 'question' ? 'approved' : m.status === 'declined' ? 'rejected' : 'none'} label={t(`match.status.${m.status}`)} />
      </p>
      {m.response_note ? (
        <p className="card" style={{ margin: '0 0 8px' }}>
          <strong>{t('match.theirReply')}: </strong>
          {m.response_note}
        </p>
      ) : null}
      {m.enquiry_id ? (
        <p>
          <Link href={`/enquiries/${m.enquiry_id}`} locale={locale} className="btn btn-secondary">
            {t('match.openEnquiry')}
          </Link>
        </p>
      ) : null}
      {m.status === 'candidate' && open && m.available ? (
        <ActionForm action={inviteSellerAction} submitLabel={t('match.invite')}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="sellerOrgId" value={m.seller_org_id} />
        </ActionForm>
      ) : null}
      {!m.available && m.status !== 'candidate' ? <p className="muted">{t('match.unavailable')}</p> : null}
    </li>
  );
}

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
  const session = await requireSession({ locale, path: `/requests/${id}` });
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
  const ended = r.closed_reason;
  const date = (d: string | null) => (d ? fmt.dateTime(new Date(d), { dateStyle: 'medium', timeZone: 'UTC' }) : '-');

  return (
    <>
      <p>
        <Link href="/requests" locale={locale}>
          {t('req.title')}
        </Link>
      </p>
      <h1>{r.title}</h1>
      <p><Link href={`/requests/${id}/quotes`} locale={locale}>{t('p4.compareTitle')}</Link></p>
      <p>
        <StatusChip status={open ? 'approved' : r.status === 'removed' ? 'rejected' : 'none'} label={t(`req.status.${r.status}`)} />
      </p>
      <p className="muted">
        {t('req.s5.visLabel')}: {r.visibility === 'eligible_sellers' ? t('req.s5.visShownBoard') : t('req.s5.visShownPrivate')}
      </p>
      {sp.sent ? (
        <p className="message message-ok" role="status">
          {t('req.sentNote', { n: candidates.length })}
        </p>
      ) : null}
      {r.status === 'removed' ? <p className="message message-error">{t('req.removedNote')}</p> : null}
      {ended && r.status !== 'removed' ? <p className="muted">{ended}</p> : null}

      <dl className="dl card">
        <dt>{t('req.s1.category')}</dt>
        <dd>{cat ? (catName(locale, cat)) : '-'}</dd>
        <dt>{t('req.s2.state')}</dt>
        <dd>{[r.target_district, r.target_state].filter(Boolean).join(', ') || '-'}</dd>
        <dt>{t('req.s3.quantity')}</dt>
        <dd>{r.quantity ? `${r.quantity} ${r.unit ?? ''}` : '-'}</dd>
        <dt>{t('req.s3.neededBy')}</dt>
        <dd>{r.needed_by ?? '-'}</dd>
        <dt>{t('req.expires')}</dt>
        <dd>{date(r.expires_at)}</dd>
        <dt>{t('req.s4.description')}</dt>
        <dd style={{ whiteSpace: 'pre-line' }}>{r.description}</dd>
      </dl>

      {open ? <p>{t('req.nextOpen')}</p> : null}

      <section aria-labelledby="inv-h">
        <h2 id="inv-h">{t('req.invitedTitle')}</h2>
        {invited.length === 0 ? (
          <p>{t('req.noneInvited')}</p>
        ) : (
          <ul className="card-list">
            {invited.map((m) => (
              <MatchCard key={m.seller_org_id} m={m} requestId={id} open={open} locale={locale} />
            ))}
          </ul>
        )}
      </section>

      {open ? (
        <section aria-labelledby="cand-h">
          <h2 id="cand-h">{t('req.candidatesTitle')}</h2>
          <p>{t('match.disclaimer')}</p>
          <p className="muted">{t('req.inviteBound', { used: invited.length, max: MAX_INVITES })}</p>
          {candidates.length === 0 ? (
            <div role="status">
              <p>
                <strong>{t('match.noneTitle')}</strong>
              </p>
              <p>{t('match.noneBody')}</p>
            </div>
          ) : (
            <ul className="card-list">
              {candidates.map((m) => (
                <MatchCard key={m.seller_org_id} m={m} requestId={id} open={open} locale={locale} />
              ))}
            </ul>
          )}
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
        </section>
      ) : null}

      {open ? (
        <section aria-labelledby="end-h">
          <h2 id="end-h">{t('req.endTitle')}</h2>
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
    </>
  );
}

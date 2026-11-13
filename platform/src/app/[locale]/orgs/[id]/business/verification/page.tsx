import { getFormatter, getTranslations } from 'next-intl/server';
import ClaimDocuments from '@/components/ClaimDocuments';
import StatusChip from '@/components/StatusChip';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { CLAIM_TYPES } from '@/lib/schemas';
import { requireBusinessContext } from '@/server/business-context';
import { applicableClaims, getBusinessProfile, listClaims, listDocuments, listEvents } from '@/server/services/verification';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'ver.title');
}

export default async function VerificationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  const sp = await searchParams;
  const ctx = await requireBusinessContext(locale, id, '/verification');
  const t = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  const base = `/orgs/${id}/business`;

  if (!ctx.canRead) {
    return (
      <>
        <h1>{t('ver.title')}</h1>
        <p>{t('biz.staffNoVerification')}</p>
        <Link href={base} locale={locale}>
          {t('biz.title')}
        </Link>
      </>
    );
  }

  const db = ctx.session.supabase;
  const [profile, claims, docs] = await Promise.all([getBusinessProfile(db, id), listClaims(db, id), listDocuments(db, { orgId: id })]);
  const events = await listEvents(db, claims.map((c) => c.id));
  const types = CLAIM_TYPES.filter((ct) => applicableClaims(profile).includes(ct));

  return (
    <>
      <h1>{t('ver.title')}</h1>
      <p>{t('ver.intro')}</p>
      {sp.sent === '1' ? (
        <p role="status" className="message message-ok">
          <strong>{t('common.done')}: </strong>
          {t('ver.sent')}
        </p>
      ) : null}
      {!profile ? (
        <p>
          <Link href={`${base}/onboarding?step=1`} locale={locale} className="btn btn-primary">
            {t('biz.next.start')}
          </Link>
        </p>
      ) : null}

      {types.map((ct) => {
        const claim = claims.find((c) => c.claim_type === ct) ?? null;
        const history = claim ? events.filter((e) => e.claim_id === claim.id) : [];
        const showReason = claim && ['needs_info', 'rejected'].includes(claim.status) && claim.decision_reason;
        return (
          <article key={ct} aria-labelledby={`h-${ct}`}>
            <h2 id={`h-${ct}`}>
              {t(`claimTypes.${ct}`)} <StatusChip status={claim?.status ?? 'none'} label={t(`claimStatus.${claim?.status ?? 'none'}`)} />
            </h2>
            {showReason ? (
              <div className="message message-error" role="note">
                <strong>{t('ver.reasonTitle')}: </strong>
                {claim.decision_reason}
              </div>
            ) : null}
            {claim?.owner_note ? (
              <p>
                <strong>{t('ver.yourNote')}:</strong> {claim.owner_note}
              </p>
            ) : null}

            <ClaimDocuments
              locale={locale}
              orgId={id}
              claimType={ct}
              claim={claim}
              docs={claim ? docs.filter((d) => d.claim_id === claim.id) : []}
              canSubmit={ctx.canSubmit}
            />

            <h3>{t('ver.history')}</h3>
            {history.length === 0 ? (
              <p className="muted">{t('claimStatus.none')}</p>
            ) : (
              <ol className="timeline">
                {history.map((e) => (
                  <li key={e.id}>
                    <strong>{t(`events.${e.event}`)}</strong>
                    <br />
                    <span className="muted">{fmt.dateTime(new Date(e.at), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC</span>
                  </li>
                ))}
              </ol>
            )}
          </article>
        );
      })}
      <p>
        <Link href={base} locale={locale}>
          {t('biz.title')}
        </Link>
      </p>
    </>
  );
}

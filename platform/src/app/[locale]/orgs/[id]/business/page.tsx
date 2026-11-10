import { getTranslations } from 'next-intl/server';
import NotificationList from '@/components/NotificationList';
import StatusChip from '@/components/StatusChip';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { CLAIM_TYPES } from '@/lib/schemas';
import { requireBusinessContext } from '@/server/business-context';
import {
  applicableClaims,
  getBusinessPrivate,
  getBusinessProfile,
  getRepresentative,
  getVerificationSummary,
  listNotifications,
  recommendNextStep,
} from '@/server/services/verification';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'biz.title');
}

export default async function BusinessOverviewPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const ctx = await requireBusinessContext(locale, id, '');
  const db = ctx.session.supabase;
  const t = await getTranslations({ locale });

  const [profile, priv, rep, claims, unread] = await Promise.all([
    getBusinessProfile(db, id),
    ctx.canEdit ? getBusinessPrivate(db, id) : Promise.resolve(null),
    getRepresentative(db, id),
    getVerificationSummary(db, id),
    listNotifications(db, { unreadOnly: true, limit: 5 }),
  ]);
  const unreadHere = unread.filter((n) => n.org_id === id);
  const next = recommendNextStep({ profile, priv, rep, claims });
  const nextHref = next.href === 'onboarding' ? `/orgs/${id}/business/onboarding?step=${next.step}` : `/orgs/${id}/business/${next.href}`;

  const byType = new Map(claims.map((c) => [c.claim_type, c]));
  const applicable = applicableClaims(profile);
  const anyApproved = claims.some((c) => c.status === 'approved');

  return (
    <>
      <h1>{ctx.org.name}</h1>

      <section aria-labelledby="status-h">
        <h2 id="status-h">{t('biz.statusTitle')}</h2>
        {!anyApproved ? (
          <p>
            <StatusChip status="none" label={t('biz.unverified')} />
          </p>
        ) : null}
        {profile ? (
          <ul className="card-list">
            {CLAIM_TYPES.filter((ct) => applicable.includes(ct)).map((ct) => {
              const status = byType.get(ct)?.status ?? 'none';
              return (
                <li key={ct} className="card">
                  <strong>{t(`claimTypes.${ct}`)}</strong>{' '}
                  <StatusChip status={status} label={t(`claimStatus.${status}`)} />
                </li>
              );
            })}
          </ul>
        ) : (
          <p>{t('biz.notStarted')}</p>
        )}
        {ctx.canEdit && !ctx.canSubmit ? <p className="muted">{t('biz.readOnly')}</p> : null}
        {!ctx.canRead && ctx.canEdit ? <p className="muted">{t('biz.staffNoVerification')}</p> : null}
      </section>

      {ctx.canEdit ? (
        <section className="next-step" aria-labelledby="next-h">
          <h2 id="next-h" style={{ marginTop: 0 }}>
            {t('biz.nextHeading')}
          </h2>
          <Link href={nextHref} locale={locale} className="btn btn-primary">
            {t(`biz.next.${next.key}`)}
          </Link>
        </section>
      ) : null}

      <section aria-labelledby="msg-h">
        <h2 id="msg-h">{t('biz.unreadTitle')}</h2>
        {unreadHere.length === 0 ? <p>{t('biz.noUnread')}</p> : <NotificationList locale={locale} items={unreadHere} />}
        <p>
          <Link href="/notifications" locale={locale}>
            {t('biz.allMessages')}
          </Link>
        </p>
      </section>

      <nav aria-label={t('biz.title')} className="card-list">
        {ctx.canEdit ? (
          <Link className="big-link" href={`/orgs/${id}/business/onboarding?step=1`} locale={locale}>
            {t('biz.openOnboarding')}
          </Link>
        ) : null}
        {ctx.canRead ? (
          <Link className="big-link" href={`/orgs/${id}/business/verification`} locale={locale}>
            {t('biz.openVerification')}
          </Link>
        ) : null}
        {ctx.canEdit ? (
          <Link className="big-link" href={`/orgs/${id}/business/listing`} locale={locale}>
            {t('biz.openListing')}
          </Link>
        ) : null}
        {ctx.perms.has('request:respond') ? (
          <Link className="big-link" href={`/orgs/${id}/business/requests`} locale={locale}>
            {t('biz.openRequests')}
          </Link>
        ) : null}
        <Link className="big-link" href={`/orgs/${id}/business/preview`} locale={locale}>
          {t('biz.openPreview')}
        </Link>
        <Link className="big-link" href={`/orgs/${id}/members`} locale={locale}>
          {t('biz.openMembers')}
        </Link>
      </nav>
    </>
  );
}

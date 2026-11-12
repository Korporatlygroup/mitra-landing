import { getFormatter, getTranslations } from 'next-intl/server';
import ActionForm from '@/components/ActionForm';
import { Field, TextArea } from '@/components/Field';
import StatusChip from '@/components/StatusChip';
import CatalogueAdminNav from '@/components/admin-catalogue/CatalogueAdminNav';
import DoneBanner from '@/components/admin-catalogue/DoneBanner';
import NoAccess from '@/components/admin-catalogue/NoAccess';
import Pager from '@/components/admin-catalogue/Pager';
import { parseOffset } from '@/components/admin-catalogue/helpers';
import { pageTitle } from '@/lib/metadata';
import { requireCatalogueAdmin } from '@/server/catalogue-admin-context';
import { listPartnerOrgs } from '@/server/services/p5-admin';
import type { PartnerStatus } from '@/server/services/p5-types';
import { Link } from '@/i18n/navigation';
import { partnerDecisionAction, provisionPartnerAction, resendInvitationAction } from '../actions';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5admin.partners.title');
}

const FILTERS = ['all', 'pending', 'approved', 'suspended'] as const;
type Filter = (typeof FILTERS)[number];

export default async function AdminPartnersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const ctx = await requireCatalogueAdmin(locale, '/admin/catalogue/partners');
  const t = await getTranslations({ locale, namespace: 'p5admin' });
  const all = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  if (!ctx.canManagePartners) return <NoAccess locale={locale} title={t('partners.title')} />;

  const filter: Filter = FILTERS.includes(sp.status as Filter) ? (sp.status as Filter) : 'all';
  const offset = parseOffset(sp.offset);
  const res = await listPartnerOrgs(ctx.session.supabase, filter === 'all' ? null : (filter as PartnerStatus), offset);
  const page = res.ok ? res.data : null;
  const when = (iso: string) => fmt.dateTime(new Date(iso), { dateStyle: 'medium', timeZone: 'UTC' });

  return (
    <>
      <h1>{t('partners.title')}</h1>
      <CatalogueAdminNav locale={locale} ctx={ctx} current="partners" />
      <DoneBanner locale={locale} value={sp.done} />
      <p>{t('partners.intro')}</p>

      <section aria-labelledby="provision-h">
        <h2 id="provision-h">{t('partners.provisionTitle')}</h2>
        <p>{t('partners.provisionIntro')}</p>
        <ActionForm action={provisionPartnerAction} submitLabel={t('partners.provisionButton')}>
          <input type="hidden" name="locale" value={locale} />
          <Field id="prov-name" name="name" label={t('partners.fields.orgName')} hint={t('partners.fields.orgNameHint')} required requiredLabel={all('common.required')} maxLength={160} />
          <Field id="prov-display" name="displayName" label={t('partners.fields.displayName')} hint={t('partners.fields.displayNameHint')} required requiredLabel={all('common.required')} maxLength={120} />
          <Field id="prov-email" name="ownerEmail" type="email" label={t('partners.fields.ownerEmail')} hint={t('partners.fields.ownerEmailHint')} required requiredLabel={all('common.required')} autoComplete="off" />
        </ActionForm>
      </section>

      <h2>{t('partners.listTitle')}</h2>
      <nav aria-label={t('partners.filters')} className="link-row">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === 'all' ? '/admin/catalogue/partners' : `/admin/catalogue/partners?status=${f}`}
            locale={locale}
            className={f === filter ? 'btn btn-primary' : 'btn btn-secondary'}
            aria-current={f === filter ? 'page' : undefined}
          >
            {t(`partners.filter.${f}`)}
          </Link>
        ))}
      </nav>

      {!page ? (
        <p role="alert" className="message message-error">
          <strong>{t('common.error')}: </strong>
          {all(`errors.${res.ok ? 'invalid_input' : res.errorKey}`)}
        </p>
      ) : page.items.length === 0 ? (
        <p>{t('partners.empty')}</p>
      ) : (
        <ul className="card-list" data-testid="partner-list">
          {page.items.map((p) => (
            <li key={p.org_id} className="card" data-testid="partner-card" data-org={p.org_id}>
              <h3>{p.display_name ?? p.name}</h3>
              <p style={{ margin: '0 0 6px' }}>
                <StatusChip status={p.status} label={all(`p5common.status.partner.${p.status}`)} />
              </p>
              <p className="muted" style={{ margin: '0 0 6px' }}>
                {t(`partners.explain.${p.status}`)}
              </p>
              <dl className="dl">
                <dt>{t('partners.orgName')}</dt>
                <dd>{p.name}</dd>
                <dt>{t('partners.origin')}</dt>
                <dd>{p.provisioned ? t('partners.provisionedByMitra') : t('partners.selfCreated')}</dd>
                <dt>{t('partners.created')}</dt>
                <dd>{when(p.created_at)}</dd>
                {p.decided_at ? (
                  <>
                    <dt>{t('partners.decided')}</dt>
                    <dd>{when(p.decided_at)}</dd>
                  </>
                ) : null}
                {p.decision_reason ? (
                  <>
                    <dt>{t('partners.reason')}</dt>
                    <dd>{p.decision_reason}</dd>
                  </>
                ) : null}
              </dl>

              {p.conflict_of_interest ? (
                <p className="message message-error" role="note">
                  {t('common.conflict')}
                </p>
              ) : null}
              <div className="adm-actions">
                  {!p.conflict_of_interest && p.status !== 'approved' ? (
                    <details>
                      <summary>{p.status === 'suspended' ? t('partners.reinstateSummary') : t('partners.approveSummary')}</summary>
                      <ActionForm action={partnerDecisionAction} submitLabel={p.status === 'suspended' ? t('partners.reinstateButton') : t('partners.approveButton')}>
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="orgId" value={p.org_id} />
                        <input type="hidden" name="mode" value="approve" />
                        {p.status === 'suspended' ? (
                          <TextArea id={`ap-${p.org_id}`} name="reason" label={t('common.reasonLabel')} hint={t('common.reasonHint')} required maxLength={1000} />
                        ) : (
                          <TextArea id={`ap-${p.org_id}`} name="reason" label={t('partners.noteLabel')} hint={t('partners.noteHint')} maxLength={1000} />
                        )}
                      </ActionForm>
                    </details>
                  ) : null}
                  {!p.conflict_of_interest && p.status === 'approved' ? (
                    <details>
                      <summary>{t('partners.suspendSummary')}</summary>
                      <p className="hint">{t('partners.suspendWarning')}</p>
                      <ActionForm action={partnerDecisionAction} submitLabel={t('partners.suspendButton')} variant="danger">
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="orgId" value={p.org_id} />
                        <input type="hidden" name="mode" value="suspend" />
                        <TextArea id={`sp-${p.org_id}`} name="reason" label={t('common.reasonLabel')} hint={t('common.reasonHint')} required maxLength={1000} />
                      </ActionForm>
                    </details>
                  ) : null}
                  {p.provisioned ? (
                    <details>
                      <summary>{t('partners.resendSummary')}</summary>
                      <p className="hint">{t('partners.resendHelp')}</p>
                      <ActionForm action={resendInvitationAction} submitLabel={t('partners.resendButton')} variant="secondary">
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="orgId" value={p.org_id} />
                        <input type="hidden" name="orgName" value={p.name} />
                        <Field id={`rs-${p.org_id}`} name="ownerEmail" type="email" label={t('partners.fields.ownerEmail')} required requiredLabel={all('common.required')} autoComplete="off" />
                      </ActionForm>
                    </details>
                  ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {page ? <Pager locale={locale} base="/admin/catalogue/partners" offset={offset} total={page.total} params={filter === 'all' ? {} : { status: filter }} /> : null}
    </>
  );
}

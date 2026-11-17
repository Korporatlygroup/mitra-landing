import { getFormatter, getTranslations } from 'next-intl/server';
import StatusChip from '@/components/StatusChip';
import Icon from '@/components/ui/Icon';
import { Link } from '@/i18n/navigation';
import { matchProgramme, rankMatches, type MatchResult } from '@/lib/gov-matching';
import { pageTitle } from '@/lib/metadata';
import { requireBusinessContext } from '@/server/business-context';
import { listOrgProducts } from '@/server/services/biz-products';
import { getOwnerListing, listSellerRequests, type SellerInboxRow } from '@/server/services/directory';
import { sellerLeadMetrics } from '@/server/services/enquiries';
import { getGovProfile, listGovProgrammes, type GovProgrammeRow } from '@/server/services/gov';
import { listNews } from '@/server/services/news';
import { getBusinessPrivate, getBusinessProfile, getRepresentative, getVerificationSummary, listCategories } from '@/server/services/verification';

function Tile({ label, value, href, hint }: { label: string; value: string | number; href?: string; hint?: string }) {
  const body = (
    <>
      <span className="metric-head">
        <span className="metric-label">{label}</span>
      </span>
      <span className="metric-big">{value}</span>
      {hint ? (
        <span className="mut" style={{ fontSize: '0.8125rem' }}>
          {hint}
        </span>
      ) : null}
    </>
  );
  return href ? (
    <Link href={href} className="metric">
      {body}
    </Link>
  ) : (
    <div className="metric">{body}</div>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'b360.title');
}

/**
 * My Business 360°: one page assembled from records that already exist (profile, listing, products, verification, enquiries,
 * requests, notifications, assistance programmes, news). Nothing is stored here and no figure is estimated: every number is a count
 * of rows the signed-in member is allowed to read, every recommendation says why it appears.
 */
export default async function Business360Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const ctx = await requireBusinessContext(locale, id, '/360');
  const db = ctx.session.supabase;
  const t = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  const base = `/orgs/${id}/business`;
  const canRespond = ctx.perms.has('request:respond');

  const [claims, listing, products, metrics, requests, govProfile, profile, categories, priv, rep] = await Promise.all([
    getVerificationSummary(db, id),
    getOwnerListing(db, id),
    listOrgProducts(db, id),
    sellerLeadMetrics(db, id),
    canRespond ? listSellerRequests(db, id, 'all') : Promise.resolve([] as SellerInboxRow[]),
    ctx.perms.has('assist:manage') ? getGovProfile(db, id) : Promise.resolve(null),
    getBusinessProfile(db, id),
    listCategories(db),
    ctx.canEdit ? getBusinessPrivate(db, id) : Promise.resolve(null),
    getRepresentative(db, id),
  ]);
  const catSlug = categories.find((c) => c.id === profile?.category_id)?.slug ?? null;
  const [unread, buying, newsRes, govList] = await Promise.all([
    db.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', ctx.session.user.id).eq('org_id', id).is('read_at', null),
    db.from('buyer_requests').select('id', { count: 'exact', head: true }).eq('buyer_org_id', id).in('status', ['open']),
    listNews(db, { sector: catSlug, state: profile?.state ?? null, page: 1 }),
    listGovProgrammes(db, { limit: 100 }),
  ]);

  // --- A. overview, from real rows -------------------------------------------------------------------------------------------
  const m = metrics.ok ? metrics.data : null;
  const approved = claims.filter((c) => c.status === 'approved').length;
  const needsInfo = claims.find((c) => c.status === 'needs_info');
  const liveProducts = products.filter((p) => p.status === 'live').length;
  const listingLive = listing?.live_status === 'published';
  const draft = listing?.draft;
  const openEnquiries = m ? Math.max(0, m.enquiries_received - m.enquiries_answered) : null;
  const newRequests = requests.filter((r) => r.match_status === 'invited' && r.request_status === 'open');

  // Profile completion: each line is a fact about saved data. Percentage = lines met / lines.
  const checks = [
    { key: 'profile', ok: Boolean(profile), href: `${base}/onboarding?step=1` },
    { key: 'registration', ok: Boolean(profile && (profile.registration_status === 'unregistered' || profile.ssm_number)), href: `${base}/onboarding?step=2` },
    { key: 'location', ok: Boolean(profile?.state), href: `${base}/onboarding?step=3` },
    { key: 'address', ok: Boolean(priv?.address_line && priv?.postcode), href: `${base}/onboarding?step=3` },
    { key: 'representative', ok: Boolean(rep?.full_name), href: `${base}/onboarding?step=4` },
    { key: 'description', ok: (draft?.description?.length ?? 0) >= 30 && (draft?.headline?.length ?? 0) >= 10, href: `${base}/listing` },
    { key: 'links', ok: Object.values(draft?.links ?? {}).some(Boolean), href: `${base}/listing` },
    { key: 'products', ok: liveProducts > 0 || (draft?.services?.length ?? 0) > 0, href: `${base}/products?new=1` },
    { key: 'verified', ok: approved > 0, href: `${base}/verification` },
    { key: 'published', ok: listingLive, href: `${base}/listing` },
  ];
  const done = checks.filter((c) => c.ok).length;
  const pct = Math.round((done / checks.length) * 100);

  // --- B. assistance: the existing deterministic matcher; every row shows why ---------------------------------------------------
  const answeredHelp = govProfile?.ok ? govProfile.data.version >= 1 : false;
  const programmes: GovProgrammeRow[] = govList.ok ? govList.data : [];
  const matched = answeredHelp && govProfile?.ok
    ? rankMatches(
        programmes.map((p) => {
          const programme = { verification_status: p.verification_status, application_status: p.application_status, is_stale: p.is_stale, funding_type: p.funding_type, closes_on: p.closes_on, data: { rules: p.rules } };
          return { p, programme, match: matchProgramme(programme, govProfile.data) as MatchResult };
        }),
      ).slice(0, 5)
    : [];
  const training = programmes.filter((p) => p.funding_type === 'training').slice(0, 4);

  // --- F. news: relevant first (sector or state), then the latest ---------------------------------------------------------------
  const allNews = newsRes.ok ? newsRes.data.items : [];
  const relevant = allNews.filter((n) => (catSlug && n.sectors.includes(catSlug)) || (profile?.state && n.states.includes(profile.state)));
  const newsShown = [...relevant, ...allNews.filter((n) => !relevant.includes(n))].slice(0, 4);

  // --- G. next actions, in this order, from the state above ---------------------------------------------------------------------
  type Task = { key: string; text: string; href: string };
  const tasks: Task[] = [];
  if (needsInfo) tasks.push({ key: 'info', text: t('b360.task.info'), href: `${base}/verification` });
  if (newRequests.length > 0) tasks.push({ key: 'req', text: t('b360.task.requests', { n: newRequests.length }), href: `${base}/requests` });
  if (m && m.follow_ups_due > 0) tasks.push({ key: 'follow', text: t('b360.task.followUps', { n: m.follow_ups_due }), href: '/enquiries' });
  if (openEnquiries && openEnquiries > 0) tasks.push({ key: 'enq', text: t('b360.task.enquiries', { n: openEnquiries }), href: '/enquiries' });
  if ((unread.count ?? 0) > 0) tasks.push({ key: 'unread', text: t('b360.task.unread', { n: unread.count ?? 0 }), href: '/notifications' });
  for (const c of checks.filter((x) => !x.ok).slice(0, 3)) tasks.push({ key: `c-${c.key}`, text: t(`b360.check.${c.key}.todo`), href: c.href });
  if (!answeredHelp && ctx.perms.has('assist:manage')) tasks.push({ key: 'help', text: t('b360.task.assist'), href: '/business-help/find' });
  const topTasks = tasks.slice(0, 6);

  const money = (p: GovProgrammeRow) =>
    p.amount_max || p.amount_min
      ? [p.amount_min ? `RM ${fmt.number(Number(p.amount_min))}` : null, p.amount_max ? `RM ${fmt.number(Number(p.amount_max))}` : null].filter(Boolean).join(' – ')
      : t('b360.assist.amountNone');

  return (
    <div className="wide" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>{t('b360.title')}</h1>
          <p className="muted">{profile?.business_name ?? ctx.org.name}</p>
        </div>
      </div>

      <section aria-labelledby="b360-a">
        <h2 id="b360-a">{t('b360.overview')}</h2>
        <div className="metric-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))', gap: 12 }}>
          <div className="metric">
            <span className="metric-label">{t('b360.verification')}</span>
            <StatusChip status={approved > 0 ? 'approved' : needsInfo ? 'needs_info' : 'none'} label={approved > 0 ? t('b360.verified', { n: approved }) : needsInfo ? t('b360.needsInfo') : t('b360.notVerified')} />
          </div>
          <Tile label={t('b360.completion')} value={`${pct}%`} hint={t('b360.completionHint', { done, total: checks.length })} />
          <Tile label={t('b360.liveProducts')} value={liveProducts} href={`${base}/products`} />
          <Tile label={t('b360.openEnquiries')} value={openEnquiries ?? '-'} href="/enquiries" />
          <Tile label={t('b360.quotesSent')} value={m?.quotes_sent ?? '-'} href="/enquiries" />
          <Tile label={t('b360.unread')} value={unread.count ?? 0} href="/notifications" />
          <Tile label={t('b360.buyingRequests')} value={buying.count ?? 0} href="/requests" />
          <Tile label={t('b360.tasks')} value={topTasks.length} />
        </div>
      </section>

      <section aria-labelledby="b360-g">
        <h2 id="b360-g">{t('b360.nextTitle')}</h2>
        {topTasks.length === 0 ? (
          <p>{t('b360.nextNone')}</p>
        ) : (
          <ol className="card-list">
            {topTasks.map((x) => (
              <li key={x.key} className="card" style={{ boxShadow: 'none' }}>
                <Link href={x.href}>{x.text}</Link>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="b360-b">
        <h2 id="b360-b">{t('b360.assist.title')}</h2>
        <p className="muted">{t('b360.assist.note')}</p>
        {!answeredHelp ? (
          <p>
            {t('b360.assist.noProfile')} <Link href="/business-help/find">{t('b360.assist.answer')}</Link>
          </p>
        ) : matched.length === 0 ? (
          <p>{t('b360.assist.none')}</p>
        ) : (
          <ul className="card-list">
            {matched.map(({ p, match }) => (
              <li key={p.id} className="card" style={{ boxShadow: 'none' }}>
                <strong><Link href={`/business-help/${p.slug}`}>{p.name}</Link></strong>
                <p className="muted" style={{ margin: '2px 0' }}>
                  {p.agency_name} · {p.funding_type ? t(`gov.type.${p.funding_type}`) : '-'} · {t(`gov.status.${p.application_status}`)} · {money(p)}
                </p>
                <p style={{ margin: '4px 0' }}>
                  <strong>{t(`gov.match.${match.label}`)}.</strong> {t(`gov.match.explain.${match.label}`)}
                </p>
                {match.met.length > 0 ? <p className="muted" style={{ margin: 0 }}>{t('gov.match.fits')}: {match.met.map((f) => t(`gov.match.field.${f}`)).join(', ')}</p> : null}
                {match.missing.length > 0 ? <p className="muted" style={{ margin: 0 }}>{t('gov.match.missing')}: {[...new Set(match.missing.map((f) => t(`gov.match.field.${f}`)))].join(', ')}</p> : null}
                <p style={{ margin: '4px 0 0' }}>
                  {p.application_url || p.info_url ? (
                    <a href={(p.application_url ?? p.info_url)!} target="_blank" rel="noopener noreferrer nofollow">{t('b360.assist.official')}</a>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="b360-c">
        <h2 id="b360-c">{t('b360.readiness.title')}</h2>
        <p className="muted">{t('b360.readiness.note')}</p>
        <ul className="card-list">
          {checks.map((c) => (
            <li key={c.key} data-done={c.ok ? 'true' : 'false'} className="card" style={{ boxShadow: 'none', display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Icon name={c.ok ? 'check' : 'clock'} size={18} />
                {t(`b360.check.${c.key}.label`)}
              </span>
              {c.ok ? <span className="muted">{t('b360.done')}</span> : <Link href={c.href}>{t(`b360.check.${c.key}.todo`)}</Link>}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="b360-d">
        <h2 id="b360-d">{t('b360.training.title')}</h2>
        {training.length === 0 ? (
          <p>{t('b360.training.none')}</p>
        ) : (
          <ul className="card-list">
            {training.map((p) => (
              <li key={p.id} className="card" style={{ boxShadow: 'none' }}>
                <strong><Link href={`/business-help/${p.slug}`}>{p.name}</Link></strong>
                <p className="muted" style={{ margin: '2px 0' }}>{p.agency_name} · {t(`gov.status.${p.application_status}`)}{p.closes_on ? ` · ${fmt.dateTime(new Date(`${p.closes_on}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' })}` : ''}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="b360-e">
        <h2 id="b360-e">{t('b360.market.title')}</h2>
        {newRequests.length === 0 ? (
          <p>{t('b360.market.none')}</p>
        ) : (
          <ul className="card-list">
            {newRequests.slice(0, 5).map((r) => (
              <li key={r.request_id} className="card" style={{ boxShadow: 'none' }}>
                <Link href={`${base}/requests/${r.request_id}`}>{r.title ?? t('b360.market.untitled')}</Link>
                <span className="muted"> · {[r.category_slug ? t(`categories.${r.category_slug}`) : null, r.target_state].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        )}
        <p>
          <Link href={`${base}/requests`}>{t('b360.market.all')}</Link>
        </p>
      </section>

      <section aria-labelledby="b360-f">
        <h2 id="b360-f">{t('b360.news.title')}</h2>
        {newsShown.length === 0 ? (
          <p>{t('b360.news.none')}</p>
        ) : (
          <ul className="card-list">
            {newsShown.map((n) => (
              <li key={n.id} className="card" style={{ boxShadow: 'none' }}>
                <Link href={`/news/${n.id}`}>{n.title}</Link>
                <p className="muted" style={{ margin: '2px 0 0' }}>
                  {n.publisher ? `${n.publisher} · ` : ''}
                  {fmt.dateTime(new Date(n.published_at), { dateStyle: 'medium', timeZone: 'Asia/Kuala_Lumpur' })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

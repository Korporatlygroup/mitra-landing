import { getFormatter, getTranslations } from 'next-intl/server';
import EmptyState from '@/components/shared/EmptyState';
import StatusBadge from '@/components/shared/StatusBadge';
import Icon from '@/components/ui/Icon';
import { initialsOf } from '@/components/ui/Tag';
import { Link } from '@/i18n/navigation';
import { catName } from '@/lib/category';
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
      <span>{label}</span>
      <b>{value}</b>
      {hint ? <span>{hint}</span> : null}
    </>
  );
  return href ? (
    <Link href={href} className="mcard metric mcard-link">
      {body}
    </Link>
  ) : (
    <div className="mcard metric">{body}</div>
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

  const GROUPS: { key: string; checks: string[] }[] = [
    { key: 'identity', checks: ['profile', 'description'] },
    { key: 'registration', checks: ['registration', 'representative'] },
    { key: 'contact', checks: ['location', 'address'] },
    { key: 'online', checks: ['links'] },
    { key: 'listings', checks: ['products', 'published'] },
    { key: 'verification', checks: ['verified'] },
  ];
  const cat = categories.find((c) => c.id === profile?.category_id);
  const place = profile?.state ?? null;
  const verifiedTone = approved > 0 ? 'green' : needsInfo ? 'gold' : 'neutral';
  const verifiedLabel = approved > 0 ? t('b360.verified', { n: approved }) : needsInfo ? t('b360.needsInfo') : t('b360.notVerified');
  const businessName = profile?.business_name ?? ctx.org.name;

  return (
    <div className="wide" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header className="bizhead">
        <span className="bizhead-mono" aria-hidden="true">
          {initialsOf(businessName)}
        </span>
        <div className="bizhead-text">
          <h1>{t('b360.title')}</h1>
          <p className="bizhead-name">{businessName}</p>
          <div className="bizhead-meta">
            {cat ? <span>{catName(locale, cat)}</span> : null}
            {place ? <span>{place}</span> : null}
            <StatusBadge label={verifiedLabel} tone={verifiedTone} />
          </div>
        </div>
        <div className="pagehead-actions">
          <Link href={`${base}/listing`} className="btn btn-secondary">
            {t('b360.viewListing')}
          </Link>
          {ctx.canEdit ? (
            <Link href={`${base}/onboarding?step=1`} className="btn btn-primary">
              <Icon name="edit" size={18} />
              {t('b360.editProfile')}
            </Link>
          ) : null}
        </div>
      </header>

      <section aria-labelledby="b360-a">
        <div className="sechead">
          <h2 id="b360-a">{t('b360.overview')}</h2>
        </div>
        <div className="xgrid-m">
          <Tile label={t('b360.completion')} value={`${pct}%`} hint={t('b360.completionHint', { done, total: checks.length })} />
          <Tile label={t('b360.liveProducts')} value={liveProducts} href={`${base}/products`} />
          <Tile label={t('b360.openEnquiries')} value={openEnquiries ?? '-'} href="/enquiries" />
          <Tile label={t('b360.quotesSent')} value={m?.quotes_sent ?? '-'} href="/enquiries" />
        </div>
        <p className="chiprow-x">
          <Link href="/notifications" className="chip-x">
            {t('b360.unread')}: {unread.count ?? 0}
          </Link>
          <Link href="/requests" className="chip-x">
            {t('b360.buyingRequests')}: {buying.count ?? 0}
          </Link>
        </p>
      </section>

      <div className="split-x">
        <div className="stack-x" style={{ gap: 24 }}>
          <section aria-labelledby="b360-c">
            <div className="sechead">
              <h2 id="b360-c">{t('b360.readiness.title')}</h2>
              <span className="chip-x brand">
                {pct}% · {t('b360.completionHint', { done, total: checks.length })}
              </span>
            </div>
            <div className="acard">
              <div className="acard-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t('b360.completion')}>
                <i style={{ width: `${pct}%` }} />
              </div>
              <p className="mut" style={{ margin: 0, fontSize: '0.875rem' }}>
                {t('b360.readiness.note')}
              </p>
              {GROUPS.map((g) => {
                const items = checks.filter((c) => g.checks.includes(c.key));
                const gDone = items.filter((c) => c.ok).length;
                return (
                  <details key={g.key} className="rgroup" open={gDone < items.length}>
                    <summary>
                      <span>{t(`b360.grp.${g.key}`)}</span>
                      <span className={`chip-x${gDone === items.length ? ' green' : ''}`}>{t('b360.groupDone', { done: gDone, total: items.length })}</span>
                    </summary>
                    <ul className="rlist">
                      {items.map((c) => (
                        <li key={c.key} data-done={c.ok ? 'true' : 'false'}>
                          <span className="rlist-l">
                            <Icon name={c.ok ? 'check' : 'clock'} size={18} />
                            {t(`b360.check.${c.key}.label`)}
                          </span>
                          {c.ok ? <span className="mut">{t('b360.done')}</span> : <Link href={c.href} className="btn btn-secondary btn-sm">{t(`b360.check.${c.key}.todo`)}</Link>}
                        </li>
                      ))}
                    </ul>
                  </details>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="b360-b">
            <div className="sechead">
              <h2 id="b360-b">{t('b360.assist.title')}</h2>
              <Link href="/business-help">{t('apphome.seeAll')}</Link>
            </div>
            <p className="mut" style={{ margin: '0 0 12px', fontSize: '0.875rem' }}>
              {t('b360.assist.note')}
            </p>
            {!answeredHelp ? (
              <div className="acard">
                <p style={{ margin: 0 }}>{t('b360.assist.noProfile')}</p>
                <div>
                  <Link href="/business-help/find" className="btn btn-primary btn-sm">
                    {t('b360.assist.answer')}
                  </Link>
                </div>
              </div>
            ) : matched.length === 0 ? (
              <div className="acard">
                <p style={{ margin: 0 }}>{t('b360.assist.none')}</p>
              </div>
            ) : (
              <ul className="stack-x" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {matched.map(({ p, match }) => (
                  <li key={p.id} className="rrow">
                    <div className="rrow-top">
                      <h3>
                        <Link href={`/business-help/${p.slug}`}>{p.name}</Link>
                      </h3>
                      <StatusBadge label={t(`gov.match.${match.label}`)} tone="brand" />
                    </div>
                    <div className="meta">
                      <span>{p.agency_name}</span>
                      <span>{p.funding_type ? t(`gov.type.${p.funding_type}`) : '-'}</span>
                      <span>{t(`gov.status.${p.application_status}`)}</span>
                      <span>{money(p)}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.875rem' }}>{t(`gov.match.explain.${match.label}`)}</p>
                    {match.met.length > 0 ? (
                      <p className="mut" style={{ margin: 0, fontSize: '0.8125rem' }}>
                        {t('gov.match.fits')}: {match.met.map((f) => t(`gov.match.field.${f}`)).join(', ')}
                      </p>
                    ) : null}
                    {match.missing.length > 0 ? (
                      <p className="mut" style={{ margin: 0, fontSize: '0.8125rem' }}>
                        {t('gov.match.missing')}: {[...new Set(match.missing.map((f) => t(`gov.match.field.${f}`)))].join(', ')}
                      </p>
                    ) : null}
                    <div className="rrow-foot">
                      <Link href={`/business-help/${p.slug}`} className="btn btn-secondary btn-sm">
                        {t('apphome.viewDetails')}
                      </Link>
                      {p.application_url || p.info_url ? (
                        <a className="btn btn-ghost btn-sm" href={(p.application_url ?? p.info_url)!} target="_blank" rel="noopener noreferrer nofollow">
                          {t('b360.assist.official')}
                        </a>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="b360-e">
            <div className="sechead">
              <h2 id="b360-e">{t('b360.market.title')}</h2>
              <Link href={`${base}/requests`}>{t('b360.market.all')}</Link>
            </div>
            {newRequests.length === 0 ? (
              <EmptyState icon="board" title={t('b360.market.title')} text={t('b360.market.none')} />
            ) : (
              <ul className="stack-x" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {newRequests.slice(0, 5).map((r) => (
                  <li key={r.request_id} className="rrow">
                    <h3>
                      <Link href={`${base}/requests/${r.request_id}`}>{r.title ?? t('b360.market.untitled')}</Link>
                    </h3>
                    <div className="meta">
                      {r.category_slug ? <span>{t(`categories.${r.category_slug}`)}</span> : null}
                      {r.target_state ? <span>{r.target_state}</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="stack-x" style={{ gap: 24 }}>
          <section aria-labelledby="b360-g">
            <div className="sechead">
              <h2 id="b360-g">{t('b360.nextTitle')}</h2>
            </div>
            {topTasks.length === 0 ? (
              <div className="acard">
                <p style={{ margin: 0 }}>{t('b360.nextNone')}</p>
              </div>
            ) : (
              <ol className="nextlist">
                {topTasks.map((x, i) => (
                  <li key={x.key}>
                    <Link href={x.href}>
                      <span className="nextlist-n" aria-hidden="true">
                        {i + 1}
                      </span>
                      <span>{x.text}</span>
                      <Icon name="forward" size={16} />
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section aria-labelledby="b360-d">
            <div className="sechead">
              <h2 id="b360-d">{t('b360.training.title')}</h2>
            </div>
            {training.length === 0 ? (
              <div className="acard">
                <p style={{ margin: 0 }}>{t('b360.training.none')}</p>
              </div>
            ) : (
              <ul className="stack-x" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {training.map((p) => (
                  <li key={p.id} className="rrow">
                    <h3>
                      <Link href={`/business-help/${p.slug}`}>{p.name}</Link>
                    </h3>
                    <div className="meta">
                      <span>{p.agency_name}</span>
                      <span>{t(`gov.status.${p.application_status}`)}</span>
                      {p.closes_on ? <span>{fmt.dateTime(new Date(`${p.closes_on}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' })}</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="b360-f">
            <div className="sechead">
              <h2 id="b360-f">{t('b360.news.title')}</h2>
              <Link href="/news">{t('apphome.seeAll')}</Link>
            </div>
            {newsShown.length === 0 ? (
              <div className="acard">
                <p style={{ margin: 0 }}>{t('b360.news.none')}</p>
              </div>
            ) : (
              <ul className="stack-x" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {newsShown.map((n) => (
                  <li key={n.id} className="rrow">
                    <h3>
                      <Link href={`/news/${n.id}`}>{n.title}</Link>
                    </h3>
                    <div className="meta">
                      {n.publisher ? <span>{n.publisher}</span> : null}
                      <span>{fmt.dateTime(new Date(n.published_at), { dateStyle: 'medium', timeZone: 'Asia/Kuala_Lumpur' })}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

import { getFormatter, getTranslations } from 'next-intl/server';
import Icon from '@/components/ui/Icon';
import { Link } from '@/i18n/navigation';
import { matchProgramme } from '@/lib/gov-matching';
import { pageTitle } from '@/lib/metadata';
import { requireBusinessContext } from '@/server/business-context';
import { activeDismissals } from '@/server/services/dashboard';
import { getOwnerListing, listSellerRequests, type SellerInboxRow } from '@/server/services/directory';
import { sellerLeadMetrics } from '@/server/services/enquiries';
import { getGovProfile, listGovProgrammes } from '@/server/services/gov';
import { listNews } from '@/server/services/news';
import { listOrgProducts } from '@/server/services/biz-products';
import { getWorkspace } from '@/server/workspace';
import { getBusinessProfile, getVerificationSummary, listCategories } from '@/server/services/verification';
import { dismissCardAction } from './home-actions';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'biz2.home.title');
}

const MY = 'Asia/Kuala_Lumpur';
const isNew = (r: SellerInboxRow) => r.match_status === 'invited' && r.request_status === 'open';

function Metric({ href, label, value, tag, tagTone, bars }: { href: string; label: string; value: string; tag?: string; tagTone?: string; bars?: number[] }) {
  const max = Math.max(1, ...(bars ?? [0]));
  return (
    <Link href={href} className="metric">
      <span className="metric-head">
        <span className="metric-label">{label}</span>
        {tag ? <span className={`tag t-${tagTone ?? 'gray'}`}>{tag}</span> : null}
      </span>
      <span className="metric-big">{value}</span>
      {bars ? (
        <span className="spark" aria-hidden="true">
          {bars.map((b, i) => (
            <span key={i} style={{ height: `${Math.max(8, Math.round((b / max) * 100))}%` }} />
          ))}
        </span>
      ) : null}
    </Link>
  );
}

export default async function BusinessHomePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const ctx = await requireBusinessContext(locale, id, '');
  const db = ctx.session.supabase;
  const t = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  const base = `/orgs/${id}/business`;
  const canRespond = ctx.perms.has('request:respond');

  const [claims, listing, products, metrics, requests, govProfile, profile, categories, dismissed] = await Promise.all([
    getVerificationSummary(db, id),
    getOwnerListing(db, id),
    listOrgProducts(db, id),
    sellerLeadMetrics(db, id),
    canRespond ? listSellerRequests(db, id, 'all') : Promise.resolve([] as SellerInboxRow[]),
    ctx.perms.has('assist:manage') ? getGovProfile(db, id) : Promise.resolve(null),
    getBusinessProfile(db, id),
    listCategories(db),
    activeDismissals(db, id),
  ]);
  const ws = await getWorkspace(id);
  const catSlug = categories.find((c) => c.id === profile?.category_id)?.slug ?? null;
  const m = metrics.ok ? metrics.data : null;

  // Dates in Malaysia time: the greeting and "due today" follow the owner's day, not the server's.
  const now = new Date();
  const todayMy = new Intl.DateTimeFormat('en-CA', { timeZone: MY }).format(now);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: MY }).format(now));
  const greetKey = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const firstName = (ctx.session.profile.display_name || ctx.session.user.email).split(/\s+/)[0] ?? '';

  const newOnes = requests.filter(isNew);
  const dueToday = newOnes.filter((r) => r.needed_by && r.needed_by <= todayMy);
  const days = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat('en-CA', { timeZone: MY }).format(new Date(now.getTime() - (6 - i) * 86400000)));
  const spark = days.map((d) => requests.filter((r) => r.invited_at && new Intl.DateTimeFormat('en-CA', { timeZone: MY }).format(new Date(r.invited_at)) === d).length);

  const dur = (mins: number) => (mins < 60 ? t('biz2.home.minutes', { n: Math.round(mins) }) : mins < 2880 ? t('biz2.home.hours', { n: Math.round(mins / 6) / 10 }) : t('biz2.home.days', { n: Math.round(mins / 144) / 10 }));

  const anyApproved = claims.some((c) => c.status === 'approved');
  const needsInfo = claims.find((c) => c.status === 'needs_info');
  const listingLive = listing?.live_status === 'published';
  const answeredHelp = govProfile?.ok ? govProfile.data.version >= 1 : false;
  const hasProducts = products.length > 0;

  // Government help: how many published programmes are a potential match for the answers given.
  let govMatches = 0;
  if (answeredHelp && govProfile?.ok) {
    const list = await listGovProgrammes(db, { limit: 100 });
    if (list.ok) {
      govMatches = list.data.filter(
        (p) => matchProgramme({ verification_status: p.verification_status, application_status: p.application_status, is_stale: p.is_stale, funding_type: p.funding_type, data: { rules: p.rules } }, govProfile.data).label === 'potential_match',
      ).length;
    }
  }
  const newsRes = await listNews(db, { sector: catSlug, state: profile?.state ?? null, page: 1 });
  const newsPick = newsRes.ok ? newsRes.data.items.find((n) => n.sectors.includes(catSlug ?? '\u0000') || (profile?.state && n.states.includes(profile.state))) : undefined;

  const steps = [
    ...(!anyApproved ? [{ key: 'verify', done: false, t: t('biz2.home.sVerifyT'), d: t('biz2.home.sVerifyD'), a: t('biz2.home.sVerifyA'), href: `${base}/verification` }] : []),
    { key: 'listing', done: listingLive, t: t('biz2.home.sListingT'), d: t('biz2.home.sListingD'), a: t('biz2.home.sListingA'), href: `${base}/listing` },
    { key: 'products', done: hasProducts, t: t('biz2.home.sProductsT'), d: t('biz2.home.sProductsD'), a: t('biz2.home.sProductsA'), href: `${base}/products?new=1` },
    { key: 'help', done: answeredHelp, t: t('biz2.home.sHelpT'), d: t('biz2.home.sHelpD'), a: t('biz2.home.sHelpA'), href: '/business-help/find' },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  type Card = { key: string; kind: 'action' | 'grow' | 'gov'; title: string; desc: string; cta: string; href: string };
  const cards: Card[] = [];
  if (dueToday.length > 0) cards.push({ key: `due:${todayMy}`, kind: 'action', title: t('biz2.home.aDueT', { n: dueToday.length }), desc: t('biz2.home.aDueD'), cta: t('biz2.home.aDueA'), href: `${base}/requests` });
  if (needsInfo) cards.push({ key: `info:${needsInfo.claim_type}`, kind: 'action', title: t('biz2.home.aInfoT'), desc: t('biz2.home.aInfoD'), cta: t('biz2.home.aInfoA'), href: `${base}/verification` });
  if (govMatches > 0) cards.push({ key: 'gov:matches', kind: 'gov', title: t('biz2.home.aGovT', { n: govMatches }), desc: t('biz2.home.aGovD'), cta: t('biz2.home.aGovA'), href: '/business-help/find' });
  if (newsPick) cards.push({ key: `news:${newsPick.id}`, kind: 'grow', title: newsPick.title, desc: t('biz2.home.aNewsD'), cta: t('biz2.home.aNewsA'), href: `/news/${newsPick.id}` });
  const visible = cards.filter((c) => !dismissed.has(c.key));
  const tone = { action: 't-coral', grow: 't-blue', gov: 't-green' } as const;
  const kindLabel = { action: t('biz2.home.kindAction'), grow: t('biz2.home.kindGrow'), gov: t('biz2.home.kindGov') } as const;

  const publicHref = listingLive && listing?.slug ? `/directory/${listing.slug}` : `${base}/preview`;

  return (
    <div className="wide" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="mut" style={{ fontSize: '0.875rem', fontWeight: 600 }}>
            {fmt.dateTime(now, { weekday: 'long', day: 'numeric', month: 'long', timeZone: MY })}
          </span>
          <h1>{t(`biz2.home.${greetKey}`, { name: firstName })}</h1>
          <span className="mut" style={{ fontSize: '0.95rem' }}>
            {t('biz2.home.summary', { n: newOnes.length, m: ws?.unread ?? 0 })}
          </span>
        </div>
        <div className="btn-row">
          <Link className="btn btn-secondary" href={publicHref}>
            {t('biz2.home.viewPublic')}
          </Link>
          {canRespond ? (
            <Link className="btn btn-primary" href={`${base}/requests`}>
              {t('biz2.home.openRequests')}
            </Link>
          ) : null}
        </div>
      </div>

      <div className="metric-row" role="group" aria-label={t('biz2.home.keyNumbers')}>
        <Metric href={`${base}/requests`} label={t('biz2.home.mNew')} value={String(newOnes.length)} tag={dueToday.length ? t('biz2.home.mDue', { n: dueToday.length }) : undefined} tagTone="coral" bars={spark} />
        <Metric href="/enquiries" label={t('biz2.home.mReply')} value={m && m.median_response_minutes !== null ? dur(m.median_response_minutes) : '–'} tag={m && m.median_response_minutes === null ? t('biz2.home.mReplyNone') : undefined} />
        <Metric
          href={`${base}/requests`}
          label={t('biz2.home.mWins')}
          value={m ? (m.reported_wins + m.reported_losses > 0 ? t('biz2.home.mWinsOf', { w: m.reported_wins, t: m.reported_wins + m.reported_losses }) : t('biz2.home.mWinsNone')) : '–'}
          tag={t('biz2.home.selfReported')}
        />
        <Metric href="/enquiries" label={t('biz2.home.mEnq')} value={String(m?.enquiries_received ?? 0)} />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        <section className="card" aria-labelledby="setup-h" style={{ flex: '999 1 460px', minWidth: 0, padding: '22px 24px 8px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <div>
              <h2 id="setup-h" style={{ margin: 0, fontSize: '1.125rem' }}>
                {t('biz2.home.setupTitle')}
              </h2>
              <span className="mut" style={{ fontSize: '0.875rem' }}>
                {t('biz2.home.setupSub')}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 180 }}>
              <div className="bar" style={{ flex: 1 }} role="progressbar" aria-label={t('biz2.home.setupTitle')} aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount}>
                <div style={{ width: `${(doneCount / steps.length) * 100}%` }} />
              </div>
              <strong style={{ fontSize: '0.875rem', whiteSpace: 'nowrap' }}>{t('biz2.home.setupOf', { done: doneCount, total: steps.length })}</strong>
            </div>
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {steps.map((s) => (
              <li key={s.key} className="step-row">
                <span className={`chk${s.done ? ' done' : ''}`} aria-hidden="true">
                  {s.done ? <Icon name="check" size={16} stroke={3} /> : null}
                </span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <strong className={s.done ? 'strike' : undefined} style={{ fontSize: '0.95rem' }}>
                    {s.t}
                  </strong>
                  <span className="mut" style={{ fontSize: '0.875rem', lineHeight: 1.45 }}>
                    {s.d}
                  </span>
                </span>
                {s.done ? <span className="sr">{t('common.done')}</span> : (
                  <Link className="btn btn-secondary btn-sm" href={s.href}>
                    {s.a}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="advice-h" style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 id="advice-h" style={{ margin: 0, fontSize: '1.125rem' }}>
              {t('biz2.home.adviceTitle')}
            </h2>
            <span className="mut" style={{ fontSize: '0.8125rem' }}>
              {t('biz2.home.adviceLeft', { n: visible.length })}
            </span>
          </div>
          {visible.map((c) => (
            <div key={c.key} className="advice">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span className={`tag ${tone[c.kind]}`}>{kindLabel[c.kind]}</span>
                <form action={dismissCardAction}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="orgId" value={id} />
                  <input type="hidden" name="key" value={c.key} />
                  <button type="submit" className="ib" style={{ width: 36, height: 36 }} aria-label={`${t('biz2.home.dismiss')}: ${c.title}`}>
                    <Icon name="x" size={16} stroke={2.2} />
                  </button>
                </form>
              </div>
              <strong style={{ fontSize: '0.95rem', lineHeight: 1.35 }}>{c.title}</strong>
              <span className="mut" style={{ fontSize: '0.875rem', lineHeight: 1.45 }}>
                {c.desc}
              </span>
              <Link className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} href={c.href}>
                {c.cta}
              </Link>
            </div>
          ))}
          {visible.length === 0 ? <div className="advice" style={{ alignItems: 'center', textAlign: 'center', color: 'var(--muted)' }}>{t('biz2.home.caughtUp')}</div> : null}
        </section>
      </div>
    </div>
  );
}

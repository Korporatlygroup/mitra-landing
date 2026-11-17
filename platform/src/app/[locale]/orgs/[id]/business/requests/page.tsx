import { getTranslations } from 'next-intl/server';
import LeadsBoard from '@/components/workspace/LeadsBoard';
import { enquiryColumn, type LeadCard } from '@/lib/leads';
import { pageTitle } from '@/lib/metadata';
import { requireBusinessContext } from '@/server/business-context';
import { listEnquiries, listSellerRequests, type SellerInboxRow } from '@/server/services/directory';
import PageHeader from '@/components/shared/PageHeader';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'biz2.board.title');
}

const MY = 'Asia/Kuala_Lumpur';
const isNew = (r: SellerInboxRow) => r.match_status === 'invited' && r.request_status === 'open';

export default async function SellerInboxPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const ctx = await requireBusinessContext(locale, id, '/requests');
  const t = await getTranslations({ locale });

  if (!ctx.perms.has('request:respond')) {
    return (
      <>
        <PageHeader title={t('biz2.board.title')} />
        <p className="message message-error" role="alert">
          {t('errors.forbidden')}
        </p>
      </>
    );
  }
  const db = ctx.session.supabase;
  const [requests, enquiries, activities, quotes] = await Promise.all([
    listSellerRequests(db, id, 'all'),
    listEnquiries(db, { sellerOrgId: id }),
    db.from('lead_activities').select('enquiry_id,stage,recorded_at').eq('seller_org_id', id).order('recorded_at', { ascending: false }).limit(300),
    db.from('quotations').select('enquiry_id,status,current_version_id').eq('seller_org_id', id).limit(300),
  ]);
  const stage = new Map<string, string>();
  for (const a of activities.data ?? []) if (!stage.has(a.enquiry_id)) stage.set(a.enquiry_id, a.stage);
  const quote = new Map<string, { status: string; versionId: string | null }>();
  for (const q of quotes.data ?? []) quote.set(q.enquiry_id, { status: q.status, versionId: q.current_version_id });
  const versionIds = [...quote.values()].map((q) => q.versionId).filter((v): v is string => Boolean(v));
  const versions = versionIds.length ? await db.from('quotation_versions').select('id,version_number,total,valid_until').in('id', versionIds) : { data: [] };
  const versionById = new Map((versions.data ?? []).map((v) => [v.id as string, v]));

  const todayMy = new Intl.DateTimeFormat('en-CA', { timeZone: MY }).format(new Date());
  const cards: LeadCard[] = [];
  const claimedEnquiries = new Set<string>();

  for (const e of enquiries) {
    const q = quote.get(e.id) ?? null;
    const v = q?.versionId ? versionById.get(q.versionId) : null;
    const col = enquiryColumn(stage.get(e.id) ?? null, q?.status ?? null, e.status);
    claimedEnquiries.add(e.id);
    cards.push({
      key: `enquiry:${e.id}`,
      kind: 'enquiry',
      column: col,
      tag: col === 'won' ? 'won' : col === 'lost' ? 'lost' : col === 'quoted' ? 'quote' : 'shared',
      title: e.topic,
      sub: t(`enq.statuses.${e.status}`),
      qty: null,
      neededBy: null,
      requestId: null,
      enquiryId: e.id,
      at: e.created_at,
      quote: v ? { version: v.version_number as number, total: String(v.total), validUntil: String(v.valid_until) } : null,
      canAnswer: false,
      canClose: col !== 'won' && col !== 'lost',
    });
  }
  for (const r of requests) {
    if (r.enquiry_id && claimedEnquiries.has(r.enquiry_id)) continue; // already shown as its enquiry
    const fresh = isNew(r);
    const replied = ['interested', 'question'].includes(r.match_status);
    const col = fresh ? 'new' : replied ? 'talking' : 'lost';
    const due = fresh && r.needed_by !== null && r.needed_by <= todayMy;
    cards.push({
      key: `request:${r.request_id}`,
      kind: 'request',
      column: col,
      tag: due ? 'due' : fresh ? 'new' : replied ? 'talking' : r.match_status === 'declined' ? 'declined' : 'closed',
      title: r.title ?? t('inbox.noLongerShownShort'),
      sub: [r.target_state, t(`inbox.status.${fresh || replied || r.match_status === 'declined' ? r.match_status : 'withdrawn'}`)].filter(Boolean).join(' · '),
      qty: r.quantity ? `${r.quantity} ${r.unit ?? ''}`.trim() : null,
      neededBy: r.needed_by,
      requestId: r.request_id,
      enquiryId: r.enquiry_id,
      at: r.invited_at ?? '',
      quote: null,
      canAnswer: fresh,
      canClose: false,
    });
  }
  cards.sort((a, b) => (b.at > a.at ? 1 : b.at < a.at ? -1 : 0));

  return (
    <div className="wide">
      <LeadsBoard cards={cards} orgId={id} browseHref={`/orgs/${id}/business/requests/board`} />
    </div>
  );
}

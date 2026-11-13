'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useActionState, useEffect, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { respondAction } from '@/app/[locale]/orgs/[id]/business/requests/actions';
import { loadLeadDetailAction, markLeadAction } from '@/app/[locale]/orgs/[id]/business/requests/board-actions';
import { FormMessage } from '@/components/ActionForm';
import Icon from '@/components/ui/Icon';
import { Drawer } from '@/components/ui/Overlay';
import { Link } from '@/i18n/navigation';
import { idle } from '@/lib/form-state';
import type { LeadCard, LeadColumn, LeadDetail, LeadTag } from '@/lib/leads';

const COLS: { key: Exclude<LeadColumn, 'lost'>; dot: string; label: string }[] = [
  { key: 'new', dot: '#d9562b', label: 'colNew' },
  { key: 'talking', dot: '#2446a8', label: 'colTalking' },
  { key: 'quoted', dot: '#e9a01a', label: 'colQuoted' },
  { key: 'won', dot: '#0b5d4b', label: 'colWon' },
];
const TAG_TONE: Record<LeadTag, string> = { due: 'coral', new: 'coral', shared: 'blue', quote: 'gold', won: 'green', lost: 'gray', declined: 'gray', talking: 'blue', closed: 'gray' };
const TAG_LABEL: Record<LeadTag, string> = { due: 'tagDue', new: 'tagNew', shared: 'tagShared', quote: 'tagQuote', won: 'tagWon', lost: 'tagLost', declined: 'tagDeclined', talking: 'tagTalking', closed: 'tagClosed' };

function Pending({ children, kind = 'primary' }: { children: string; kind?: 'primary' | 'secondary' }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`btn btn-${kind}`} disabled={pending} aria-busy={pending}>
      {children}
    </button>
  );
}

function AnswerButtons({ card, orgId, onDone }: { card: LeadCard; orgId: string; onDone: () => void }) {
  const t = useTranslations('biz2.board');
  const locale = useLocale();
  const [state, action] = useActionState(respondAction, idle);
  useEffect(() => {
    if (state.status === 'success') onDone();
  }, [state, onDone]);
  const hidden = (resp: string) => (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="requestId" value={card.requestId ?? ''} />
      <input type="hidden" name="response" value={resp} />
    </>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="notice">
        <Icon name="lock" size={18} />
        <span>{t('lockNotice')}</span>
      </div>
      <FormMessage state={state} />
      <div className="btn-row">
        <form action={action}>
          {hidden('declined')}
          <Pending kind="secondary">{t('notForUs')}</Pending>
        </form>
        <form action={action}>
          {hidden('interested')}
          <Pending>{t('interested')}</Pending>
        </form>
      </div>
    </div>
  );
}

function MarkButtons({ card, onDone }: { card: LeadCard; onDone: () => void }) {
  const t = useTranslations('biz2.board');
  const [state, action] = useActionState(markLeadAction, idle);
  useEffect(() => {
    if (state.status === 'success') onDone();
  }, [state, onDone]);
  return (
    <>
      <FormMessage state={state} />
      <div className="btn-row">
        {(['reported_lost', 'reported_won'] as const).map((stage) => (
          <form key={stage} action={action}>
            <input type="hidden" name="enquiryId" value={card.enquiryId ?? ''} />
            <input type="hidden" name="stage" value={stage} />
            <Pending kind={stage === 'reported_won' ? 'primary' : 'secondary'}>{stage === 'reported_won' ? t('markWon') : t('markLost')}</Pending>
          </form>
        ))}
      </div>
    </>
  );
}

function DrawerBody({ card, orgId, onClose }: { card: LeadCard; orgId: string; onClose: () => void }) {
  const t = useTranslations('biz2.board');
  const locale = useLocale();
  const [detail, setDetail] = useState<LeadDetail | null | undefined>(card.requestId ? undefined : null);
  const [, start] = useTransition();
  useEffect(() => {
    if (!card.requestId) return;
    let alive = true;
    start(async () => {
      const d = await loadLeadDetailAction(orgId, card.requestId!, locale);
      if (alive) setDetail(d);
    });
    return () => {
      alive = false;
    };
  }, [card.requestId, orgId, locale]);

  const base = `/orgs/${orgId}/business`;
  const kv = (k: string, v: string) => (
    <div className="kv">
      <span className="kv-k">{k}</span>
      <span style={{ fontWeight: 600 }}>{v}</span>
    </div>
  );
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <span className={`tag t-${TAG_TONE[card.tag]}`}>{t(TAG_LABEL[card.tag])}</span>
        <span className="tag t-gray">{card.kind === 'request' ? t('kindRequest') : t('kindEnquiry')}</span>
      </div>
      <div>
        <div className="mut" style={{ fontSize: '0.9rem' }}>
          {detail?.buyer ? `${detail.buyer} · ` : ''}
          {card.sub}
        </div>
      </div>
      {detail === undefined ? <p className="mut" role="status">…</p> : null}
      {detail ? (
        <>
          <div className="kv-grid">
            {kv(t('qty'), detail.qty)}
            {kv(t('neededBy'), detail.neededBy)}
            {kv(t('deliverTo'), detail.area)}
            {kv(t('budget'), detail.budget)}
          </div>
          <div>
            <strong style={{ fontSize: '0.9rem' }}>{t('whatNeed')}</strong>
            <p style={{ margin: '4px 0 0', whiteSpace: 'pre-line', lineHeight: 1.55 }}>{detail.description}</p>
          </div>
          {detail.reasons.length > 0 ? (
            <div>
              <strong style={{ fontSize: '0.9rem' }}>{t('whyMatched')}</strong>
              <div className="fchip-row" style={{ marginTop: 8 }}>
                {detail.reasons.map((r) => (
                  <span key={r} className="tag t-green">
                    {r}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {detail.phone || detail.email ? (
            <div className="kv">
              <span className="kv-k">{t('contactUnlocked')}</span>
              <span style={{ fontWeight: 600 }}>{[detail.phone, detail.email].filter(Boolean).join(' / ')}</span>
            </div>
          ) : null}
        </>
      ) : null}
      {card.column === 'quoted' && card.quote ? (
        <div className="card" style={{ boxShadow: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <strong>{t('quoteSummary')}</strong>
          <span className="mut">{t('quoteVersion', { n: card.quote.version })}</span>
          <span style={{ fontWeight: 800, fontSize: '1.2rem' }}>
            {t('quoteTotal')}: RM {card.quote.total}
          </span>
          <span className="mut" style={{ fontSize: '0.8125rem' }}>
            {t('quoteTerms')}
          </span>
        </div>
      ) : null}
      {card.column === 'won' ? <p className="message message-ok">{t('wonNote')}</p> : null}
      {card.column === 'lost' && card.tag === 'lost' ? <p className="message">{t('lostNote')}</p> : null}

      {card.canAnswer && card.requestId ? <AnswerButtons card={card} orgId={orgId} onDone={onClose} /> : null}
      {card.enquiryId && card.column !== 'won' && card.column !== 'lost' ? (
        <div className="btn-row">
          <Link className="btn btn-secondary" href={`/enquiries/${card.enquiryId}`}>
            {t('message')}
          </Link>
          <Link className="btn btn-primary" href={`/enquiries/${card.enquiryId}`}>
            {t('sendQuote')}
          </Link>
        </div>
      ) : null}
      {card.canClose && card.enquiryId ? <MarkButtons card={card} onDone={onClose} /> : null}
      <Link href={card.requestId ? `${base}/requests/${card.requestId}` : `/enquiries/${card.enquiryId}`} className="btn btn-ghost" style={{ alignSelf: 'flex-start' }}>
        {t('fullPage')}
        <Icon name="forward" size={16} />
      </Link>
    </>
  );
}

export default function LeadsBoard({ cards, orgId, browseHref }: { cards: LeadCard[]; orgId: string; browseHref: string }) {
  const t = useTranslations('biz2.board');
  const tw = useTranslations('ws');
  const [view, setView] = useState<'board' | 'list'>('board');
  const [showLost, setShowLost] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = cards.find((c) => c.key === openKey) ?? null;
  const lost = cards.filter((c) => c.column === 'lost');
  const close = () => setOpenKey(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem('inok.board.view');
      if (v === 'list') setView('list');
    } catch {
      /* storage can be blocked */
    }
  }, []);
  const pick = (v: 'board' | 'list') => {
    setView(v);
    try {
      localStorage.setItem('inok.board.view', v);
    } catch {
      /* ignore */
    }
  };

  const CardButton = ({ c }: { c: LeadCard }) => (
    <button type="button" className={`lead${openKey === c.key ? ' sel' : ''}`} onClick={() => setOpenKey(c.key)} aria-label={`${t('openDetail')}: ${c.title}`} data-testid="inbox-row">
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <strong style={{ fontSize: '0.95rem', lineHeight: 1.3 }}>{c.title}</strong>
      </span>
      <span className="mut" style={{ fontSize: '0.8125rem' }}>
        {c.sub}
      </span>
      <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={`tag t-${TAG_TONE[c.tag]}`}>{t(TAG_LABEL[c.tag])}</span>
        {c.qty ? <span className="mut" style={{ fontSize: '0.8125rem' }}>{c.qty}</span> : null}
      </span>
    </button>
  );

  const empty = cards.length === 0;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p className="page-sub">{t('sub')}</p>
        </div>
        <div className="btn-row">
          <div className="seg" role="group" aria-label={t('viewLabel')}>
            <button type="button" className="seg-btn" aria-pressed={view === 'board'} onClick={() => pick('board')}>
              {t('viewBoard')}
            </button>
            <button type="button" className="seg-btn" aria-pressed={view === 'list'} onClick={() => pick('list')}>
              {t('viewList')}
            </button>
          </div>
          <Link className="btn btn-secondary btn-sm" href={browseHref}>
            {t('browse')}
          </Link>
          <button type="button" className="fchip" aria-pressed={showLost} onClick={() => setShowLost((v) => !v)}>
            {showLost ? t('hideLost') : `${t('showLost')} (${lost.length})`}
          </button>
        </div>
      </div>

      {empty ? (
        <div className="empty">
          <strong>{t('noneTitle')}</strong>
          <span className="mut">{t('noneBody')}</span>
        </div>
      ) : view === 'board' ? (
        <div className="board" role="group" aria-label={t('columns')}>
          {[...COLS, ...(showLost ? [{ key: 'lost' as const, dot: '#8a9a93', label: 'colLost' }] : [])].map((col) => {
            const items = cards.filter((c) => c.column === col.key);
            return (
              <section key={col.key} className="col" aria-label={`${t(col.label)} (${items.length})`}>
                <h2 className="col-h">
                  <span className="dot-s" style={{ background: col.dot }} aria-hidden="true" />
                  {t(col.label)}
                  <span className="mut" style={{ fontWeight: 600 }}>
                    {items.length}
                  </span>
                </h2>
                {items.length === 0 ? <p className="mut" style={{ fontSize: '0.8125rem', margin: '4px 6px' }}>{t('empty')}</p> : null}
                {items.map((c) => (
                  <CardButton key={c.key} c={c} />
                ))}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{t('title')}</th>
                <th scope="col">{t('deliverTo')}</th>
                <th scope="col">{t('qty')}</th>
                <th scope="col">{t('neededBy')}</th>
                <th scope="col">{t('colNew')}</th>
              </tr>
            </thead>
            <tbody>
              {cards
                .filter((c) => showLost || c.column !== 'lost')
                .map((c) => (
                  <tr key={c.key} data-testid="inbox-row">
                    <td>
                      <button type="button" className="btn btn-link" style={{ padding: 0, minHeight: 32, textAlign: 'left' }} onClick={() => setOpenKey(c.key)}>
                        {c.title}
                      </button>
                    </td>
                    <td>{c.sub}</td>
                    <td>{c.qty ?? '–'}</td>
                    <td>{c.neededBy ?? '–'}</td>
                    <td>
                      <span className={`tag t-${TAG_TONE[c.tag]}`}>{t(TAG_LABEL[c.tag])}</span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      <Drawer open={Boolean(open)} onClose={close} title={open?.title ?? ''} closeLabel={tw('close')}>
        {open ? <DrawerBody card={open} orgId={orgId} onClose={close} /> : null}
      </Drawer>
    </>
  );
}

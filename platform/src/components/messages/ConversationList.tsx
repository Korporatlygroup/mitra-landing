import { getFormatter, getTranslations } from 'next-intl/server';
import ConversationFilter from './ConversationFilter';
import { initialsOf, paletteFor } from '@/components/ui/Tag';
import { Link } from '@/i18n/navigation';
import type { Db } from '@/server/services/result';

interface Row {
  id: string;
  topic: string;
  status: string;
  created_at: string;
  opening_note: string | null;
}

/** Left pane of Messages: the user's conversations, newest activity first, with the last message as a one-line preview. */
export default async function ConversationList({ db, locale, activeId }: { db: Db; locale: string; activeId?: string }) {
  const t = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  const { data } = await db.from('enquiries').select('id, topic, status, created_at, opening_note').order('created_at', { ascending: false }).limit(50);
  const rows = (data ?? []) as Row[];
  const ids = rows.map((r) => r.id);
  const last = new Map<string, { body: string; at: string }>();
  if (ids.length) {
    const { data: msgs } = await db.from('enquiry_messages').select('enquiry_id, body, created_at').in('enquiry_id', ids).order('created_at', { ascending: false }).limit(300);
    for (const m of msgs ?? []) if (!last.has(m.enquiry_id)) last.set(m.enquiry_id, { body: m.body, at: m.created_at });
  }
  const sorted = [...rows].sort((a, b) => (last.get(b.id)?.at ?? b.created_at).localeCompare(last.get(a.id)?.at ?? a.created_at));

  if (sorted.length === 0) return null;
  return (
    <ConversationFilter label={t('biz2.messages.search')} noMatch={t('biz2.messages.noMatch')}>
    <nav aria-label={t('biz2.messages.list')} className="chat-list">
      {sorted.map((r) => {
        const pal = paletteFor(r.id);
        const l = last.get(r.id);
        return (
          <Link key={r.id} href={`/enquiries/${r.id}`} className="chat" data-chat={`${r.topic} ${l?.body ?? r.opening_note ?? ''}`} aria-current={r.id === activeId ? 'page' : undefined}>
            <span className="av" style={{ background: pal.tint, color: pal.c1 }} aria-hidden="true">
              {initialsOf(r.topic)}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong className="ellipsis">{r.topic}</strong>
                <span className="mut" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                  {fmt.dateTime(new Date(l?.at ?? r.created_at), { day: 'numeric', month: 'short', timeZone: 'Asia/Kuala_Lumpur' })}
                </span>
              </span>
              <span className="mut ellipsis" style={{ display: 'block', fontSize: '0.8125rem' }}>
                {l?.body ?? r.opening_note ?? t(`enq.statuses.${r.status}`)}
              </span>
              <span className="chip-x" style={{ marginTop: 4 }}>
                {t(`enq.statuses.${r.status}`)}
              </span>
            </span>
          </Link>
        );
      })}
    </nav>
    </ConversationFilter>
  );
}

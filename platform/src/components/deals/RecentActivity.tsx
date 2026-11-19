import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { formatMyt } from '@/lib/time';
import type { Db } from '@/server/services/result';

interface Activity { at: string; text: string; href: string }

/**
 * Latest activity from stored records only: quotation and order events (deal_events) and the times of the newest messages.
 * Row-level security limits both to the person's own organisations. No read state exists, so nothing here claims "unread" or "waiting".
 */
export default async function RecentActivity({ db, locale, limit = 6 }: { db: Db; locale: string; limit?: number }) {
  const d = await getTranslations({ locale, namespace: 'deals' });
  const [events, msgs] = await Promise.all([
    db.from('deal_events').select('id,enquiry_id,order_id,kind,created_at').order('created_at', { ascending: false }).limit(limit),
    db.from('enquiry_messages').select('enquiry_id,created_at').order('created_at', { ascending: false }).limit(limit),
  ]);
  const ids = [...new Set([...(events.data ?? []).map((e) => e.enquiry_id as string), ...(msgs.data ?? []).map((m) => m.enquiry_id as string)])];
  const topics = new Map<string, string>();
  if (ids.length) {
    const { data } = await db.from('enquiries').select('id,topic').in('id', ids);
    for (const r of data ?? []) topics.set(r.id as string, r.topic as string);
  }
  const rows: Activity[] = [
    ...(events.data ?? []).map((e): Activity => ({
      at: e.created_at as string,
      text: `${topics.get(e.enquiry_id as string) ?? ''} · ${d(`ev_${String(e.kind).replace('.', '_')}`)}`,
      href: e.order_id ? `/orders/${e.order_id}` : `/enquiries/${e.enquiry_id}`,
    })),
    ...(msgs.data ?? []).map((m): Activity => ({ at: m.created_at as string, text: `${topics.get(m.enquiry_id as string) ?? ''} · ${d('activityMessage')}`, href: `/enquiries/${m.enquiry_id}` })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  if (rows.length === 0) return <p className="mut">{d('noActivity')}</p>;
  return (
    <ul className="deal-timeline">
      {rows.map((a, i) => (
        <li key={i}><Link href={a.href}>{a.text}</Link><time className="mut" dateTime={a.at}> · {formatMyt(a.at, locale)}</time></li>
      ))}
    </ul>
  );
}

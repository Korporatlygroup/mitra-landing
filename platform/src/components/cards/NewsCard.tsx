import { Link } from '@/i18n/navigation';

export default function NewsCard({ id, title, summary, category, publisher, date, readLabel }: { id: string; title: string; summary: string; category: string; publisher?: string | null; date: string; readLabel: string }) {
  return (
    <article className="ncard">
      <div className="meta">
        <span className="chip-x brand">{category}</span>
        <span>{[publisher, date].filter(Boolean).join(' · ')}</span>
      </div>
      <h3>
        <Link href={`/news/${id}`}>{title}</Link>
      </h3>
      <p>{summary}</p>
      <Link href={`/news/${id}`} className="dcard-go">
        {readLabel}
      </Link>
    </article>
  );
}

import { Link } from '@/i18n/navigation';

/** A published programme in compact form. The status text is whatever the page computed from evidence (never assumed open). */
export default function OpportunityCard({ slug, name, agency, type, status, amount, deadline, detailsLabel }: { slug: string; name: string; agency: string; type: string; status: string; amount: string; deadline?: string | null; detailsLabel: string }) {
  return (
    <article className="ocard">
      <div className="meta">
        <span className="chip-x brand">{type}</span>
        <span className="chip-x">{status}</span>
      </div>
      <h3>
        <Link href={`/business-help/${slug}`}>{name}</Link>
      </h3>
      <div className="meta">
        <span>{agency}</span>
        <span>{amount}</span>
        {deadline ? <span>{deadline}</span> : null}
      </div>
      <div className="ocard-foot">
        <Link href={`/business-help/${slug}`} className="btn btn-primary btn-sm">
          {detailsLabel}
        </Link>
      </div>
    </article>
  );
}

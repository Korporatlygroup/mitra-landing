import { getTranslations } from 'next-intl/server';
import { initialsOf } from '@/components/ui/Tag';
import { Link } from '@/i18n/navigation';
import { catName } from '@/lib/category';
import type { ListingCard } from '@/server/services/directory';

/**
 * Business listing card (directory and home): brand monogram (no invented photo), name, category and place, a short description,
 * the real review state and up to three services. The whole card is one link to the public profile.
 */
export default async function BusinessCard({ b, locale, withDesc }: { b: ListingCard; locale: string; withDesc?: boolean }) {
  const t = await getTranslations({ locale });
  const place = [b.district, b.state].filter(Boolean).join(', ');
  const reviewed = b.reviewed.some((c) => c.decided_at);
  const desc = b.headline || b.summary || null;
  const services = b.services.slice(0, 3);
  return (
    <Link href={`/directory/${b.slug}`} className="lcard lcard-link">
      <span className="lcard-top">
        <span className="lcard-mono" aria-hidden="true">
          {initialsOf(b.name)}
        </span>
        <span style={{ minWidth: 0 }}>
          <strong className="lcard-name">{b.name}</strong>
          <span className="lcard-sub">{[catName(locale, b.category), place].filter(Boolean).join(' · ')}</span>
        </span>
      </span>
      {withDesc && desc ? <span className="lcard-desc">{desc}</span> : null}
      <span className="lcard-tags">
        <span className={`chip-x ${reviewed ? 'green' : ''}`}>{reviewed ? t('dir2.reviewedTag') : t('dir2.inReview')}</span>
        {services.map((s) => (
          <span key={s} className="chip-x">
            {s}
          </span>
        ))}
      </span>
      <span className="dcard-go">{t('apphome.viewBusiness')}</span>
    </Link>
  );
}

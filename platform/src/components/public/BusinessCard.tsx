import { getTranslations } from 'next-intl/server';
import Tag, { initialsOf, paletteFor } from '@/components/ui/Tag';
import { Link } from '@/i18n/navigation';
import { catName } from '@/lib/category';
import type { ListingCard } from '@/server/services/directory';

/** Directory / home card: dot-pattern cover, overlapping initials avatar, name, "area · category", review tag. The whole card is the link. */
export default async function BusinessCard({ b, locale, withDesc }: { b: ListingCard; locale: string; withDesc?: boolean }) {
  const t = await getTranslations({ locale });
  const pal = paletteFor(b.slug);
  const place = [b.district, b.state].filter(Boolean).join(', ');
  const reviewed = b.reviewed.some((c) => c.decided_at);
  const desc = b.headline || b.summary || (b.services.length > 0 ? b.services.slice(0, 3).join(' · ') : null);
  return (
    <Link href={`/directory/${b.slug}`} className="biz" style={{ ['--c1' as string]: pal.c1, ['--c2' as string]: pal.c2, ['--tint' as string]: pal.tint }}>
      <span className="cover">
        <span className="avt" aria-hidden="true">
          {initialsOf(b.name)}
        </span>
      </span>
      <span className="biz-body">
        <strong>{b.name}</strong>
        <span className="biz-meta">{[place, catName(locale, b.category)].filter(Boolean).join(' · ')}</span>
        {withDesc && desc ? <span className="biz-desc">{desc}</span> : null}
        <span className="biz-tags">{reviewed ? <Tag tone="green">{t('dir2.reviewedTag')}</Tag> : <Tag tone="gray">{t('dir2.inReview')}</Tag>}</span>
      </span>
    </Link>
  );
}

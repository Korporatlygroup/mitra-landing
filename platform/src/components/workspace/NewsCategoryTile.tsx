import Icon, { type IconName } from '@/components/ui/Icon';
import type { NewsCategory } from '@/server/services/news';

export const CAT_STYLE: Record<NewsCategory, { icon: IconName; tint: string; fg: string; label: string }> = {
  grants: { icon: 'money', tint: 'var(--tag-gold-bg)', fg: 'var(--tag-gold)', label: 'chipGrants' },
  training: { icon: 'news', tint: 'var(--tag-blue-bg)', fg: 'var(--tag-blue)', label: 'chipTraining' },
  deadlines: { icon: 'calendar', tint: 'var(--tag-coral-bg)', fg: 'var(--tag-coral)', label: 'chipDeadlines' },
  community: { icon: 'users', tint: 'var(--tag-violet-bg)', fg: 'var(--tag-violet)', label: 'chipCommunity' },
};

export function NewsCategoryTile({ category, size = 96 }: { category: NewsCategory; size?: number }) {
  const s = CAT_STYLE[category];
  return (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: 18, background: s.tint, color: s.fg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
      <Icon name={s.icon} size={Math.round(size / 2.8)} stroke={1.8} />
    </span>
  );
}


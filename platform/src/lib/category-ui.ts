import type { IconName } from '@/components/ui/Icon';

const ICONS: Record<string, IconName> = {
  'food-beverage': 'utensils',
  'retail-shop': 'store',
  'tailoring-apparel': 'shirt',
  'beauty-wellness': 'heart',
  'home-services': 'settings',
  'education-training': 'news',
  'tech-digital': 'globe',
  manufacturing: 'layers',
  agriculture: 'trend',
  'transport-logistics': 'car',
  'events-hospitality': 'calendar',
  'professional-services': 'scale',
  other: 'grid',
};

export function categoryIcon(slug: string | undefined | null): IconName {
  return (slug && ICONS[slug]) || 'grid';
}

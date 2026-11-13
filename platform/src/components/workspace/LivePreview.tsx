'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import Tag, { initialsOf, paletteFor } from '@/components/ui/Tag';

/** The listing card the business will get, updating as the owner types the name, type of business and town. Nothing here is saved by itself. */
export default function LivePreview({ seed, initial }: { seed: string; initial: { name: string; category: string; town: string } }) {
  const t = useTranslations('onb2');
  const [v, setV] = useState(initial);
  useEffect(() => {
    const on = (e: Event) => {
      const el = e.target;
      if (el instanceof HTMLInputElement && el.id === 'business_name') setV((s) => ({ ...s, name: el.value }));
      else if (el instanceof HTMLSelectElement && el.id === 'category_slug') setV((s) => ({ ...s, category: el.value ? (el.options[el.selectedIndex]?.text ?? '') : '' }));
      else if (el instanceof HTMLInputElement && el.id === 'district') setV((s) => ({ ...s, town: el.value }));
    };
    document.addEventListener('input', on);
    document.addEventListener('change', on);
    return () => {
      document.removeEventListener('input', on);
      document.removeEventListener('change', on);
    };
  }, []);
  const pal = paletteFor(seed);
  const name = v.name.trim() || t('previewName');
  return (
    <div className="mini-biz" style={{ ['--c1' as string]: pal.c1, ['--c2' as string]: pal.c2, ['--tint' as string]: pal.tint }}>
      <span className="cover" style={{ height: 96 }}>
        <span className="avt" aria-hidden="true" style={{ position: 'absolute', left: 18, bottom: -26 }}>
          {initialsOf(name)}
        </span>
      </span>
      <div style={{ padding: '36px 18px 18px', display: 'flex', flexDirection: 'column', gap: 6 }} aria-live="polite">
        <strong style={{ fontSize: '1.05rem' }}>{name}</strong>
        <span className="mut" style={{ fontSize: '0.8125rem' }}>
          {[v.town.trim(), v.category].filter(Boolean).join(' · ') || t('previewMeta')}
        </span>
        <span style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <Tag tone="gray">{t('draft')}</Tag>
        </span>
      </div>
    </div>
  );
}

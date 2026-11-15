'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useRouter, usePathname } from '@/i18n/navigation';
import { Switch } from '@/components/ui/Overlay';

/** "Reviewed only" switch: toggles ?reviewed=1 and goes back to page 1. The list updates without a full reload. */
export default function ReviewedSwitch() {
  const t = useTranslations('dir2');
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const on = sp.get('reviewed') === '1';
  const toggle = (next: boolean) => {
    const q = new URLSearchParams(sp.toString());
    if (next) q.set('reviewed', '1');
    else q.delete('reviewed');
    q.delete('page');
    const s = q.toString();
    router.push(s ? `${path}?${s}` : path);
  };
  return (
    <span className="sw-row" style={{ justifyContent: 'flex-start' }}>
      {t('reviewedOnly')}
      <Switch checked={on} onChange={toggle} label={t('reviewedOnly')} />
    </span>
  );
}

import { getTranslations } from 'next-intl/server';
import { DISPLAY_STATUS_TONE, displayStatus, type StatusInput } from '@/lib/gov-status';

const CLASS: Record<string, string> = { green: 'chip chip-good', gold: 'chip chip-warn', coral: 'chip chip-bad', blue: 'chip', gray: 'chip' };

/** The status shown to the public. The words carry the meaning; the colour only reinforces it. */
export default async function StatusBadge({ locale, input, label = true }: { locale: string; input: StatusInput; label?: boolean }) {
  const t = await getTranslations({ locale, namespace: 'gov' });
  const s = displayStatus(input);
  return (
    <span className={CLASS[DISPLAY_STATUS_TONE[s]]} data-status={s}>
      {label ? `${t('card.status')}: ` : ''}
      {t(`dstatus.${s}`)}
    </span>
  );
}

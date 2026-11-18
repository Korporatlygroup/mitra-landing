export type BadgeTone = 'neutral' | 'brand' | 'green' | 'gold' | 'red';

/** Status is always text (never colour alone); the tone only reinforces it. */
export default function StatusBadge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  return <span className={`chip-x${tone === 'neutral' ? '' : ` ${tone}`}`}>{label}</span>;
}

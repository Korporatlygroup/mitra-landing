/** Status shown as text (never colour alone); the border colour is only a reinforcement. */
export default function StatusChip({ status, label }: { status: string; label: string }) {
  const tone = status === 'approved' ? 'chip chip-good' : status === 'rejected' || status === 'stale' || status === 'needs_info' ? 'chip chip-bad' : 'chip';
  return <span className={tone}>{label}</span>;
}

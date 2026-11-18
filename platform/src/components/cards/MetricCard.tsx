export default function MetricCard({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="mcard">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

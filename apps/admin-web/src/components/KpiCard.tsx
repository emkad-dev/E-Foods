import { formatDeltaPercent } from '../lib/format';

interface KpiCardProps {
  label: string;
  value: string;
  current?: number;
  previous?: number;
}

export default function KpiCard({ label, value, current, previous }: KpiCardProps) {
  const delta =
    typeof current === 'number' && typeof previous === 'number' ? formatDeltaPercent(current, previous) : null;

  return (
    <div className="kpi-card">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {delta ? (
        <span className={`kpi-delta ${delta.direction}`}>
          {delta.direction === 'up' ? '▲ ' : delta.direction === 'down' ? '▼ ' : ''}
          {delta.label}
        </span>
      ) : (
        <span className="kpi-delta flat">Live count</span>
      )}
    </div>
  );
}

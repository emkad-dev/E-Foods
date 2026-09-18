import { formatDeltaPercent } from '../lib/format';

interface KpiCardProps {
  label: string;
  value: string;
  current?: number;
  previous?: number;
  /**
   * What to say in place of a delta when there is no prior period to compare.
   *
   * The default reads "Live count", which is true of a figure taken right now
   * -- live orders, riders online, the approvals queue -- and false of a
   * windowed one. Three cards on Overview are labelled "(30d)" and carry no
   * `previous`, so they fell through to this slot and contradicted their own
   * labels: a thirty-day total captioned as a live count.
   */
  caption?: string;
}

export default function KpiCard({ label, value, current, previous, caption = 'Live count' }: KpiCardProps) {
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
        <span className="kpi-delta flat">{caption}</span>
      )}
    </div>
  );
}

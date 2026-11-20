import { Link } from 'react-router-dom';
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
   *
   * `null` drops the line entirely, for cards that sit under a heading which
   * already says what the caption would ("Right now" over three live counts
   * made three "Live count" captions pure repetition).
   */
  caption?: string | null;
  /**
   * Marks a figure that represents work waiting for a person -- the approvals
   * queue with anything in it. It takes the warning hue because it IS an
   * attention state; the number still carries the meaning on its own.
   */
  attention?: boolean;
  /**
   * An alarm, not just work waiting: a rider SOS above zero. Takes the danger
   * tint and a red figure, where `attention` takes the amber one.
   */
  alert?: boolean;
  /**
   * Makes the whole tile a link to the page where you act on the figure.
   * One click from "3 pending approvals" to the approvals queue.
   */
  href?: string;
}

export default function KpiCard({
  label,
  value,
  current,
  previous,
  caption = 'Live count',
  attention = false,
  alert = false,
  href,
}: KpiCardProps) {
  const delta =
    typeof current === 'number' && typeof previous === 'number' ? formatDeltaPercent(current, previous) : null;

  const className = [
    'kpi-card',
    attention ? 'is-attention' : null,
    alert ? 'is-alert' : null,
    href ? 'kpi-card-link' : null,
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {delta ? (
        <span className={`kpi-delta ${delta.direction}`}>
          {delta.direction === 'up' ? '▲ ' : delta.direction === 'down' ? '▼ ' : ''}
          {delta.label}
        </span>
      ) : caption === null ? null : (
        <span className="kpi-delta flat">{caption}</span>
      )}
    </>
  );

  return href ? (
    <Link to={href} className={className}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

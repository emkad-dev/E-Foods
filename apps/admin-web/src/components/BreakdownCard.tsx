import { Link } from 'react-router-dom';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import EmptyState from './EmptyState';
import { formatNumber, humanizeStatus } from '../lib/format';

export interface BreakdownSlice {
  name: string;
  value: number;
}

interface BreakdownCardProps {
  title: string;
  moreHref: string;
  slices: BreakdownSlice[];
  /** Resolves each slice to its chart colour, so callers keep their own tone scale. */
  colorFor: (name: string, index: number) => string;
  emptyTitle: string;
  emptyBody: string;
}

/**
 * Donut breakdown with a matching legend. Shared by the dashboard's order and
 * payment status cards, which were previously duplicated line for line.
 */
export default function BreakdownCard({
  title,
  moreHref,
  slices,
  colorFor,
  emptyTitle,
  emptyBody,
}: BreakdownCardProps) {
  return (
    <div className="card">
      <div className="card-title-row">
        <h3 className="card-title">{title}</h3>
        {/* `card-more-link` is what carries this link over the 24x24 target
            floor; as bare inline text it measured 45x17. See global.css. */}
        <Link to={moreHref} className="muted text-[13px] card-more-link">
          more →
        </Link>
      </div>

      {slices.length === 0 ? (
        <EmptyState title={emptyTitle} body={emptyBody} />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={slices} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={3}>
                {slices.map((slice, index) => (
                  <Cell key={slice.name} fill={colorFor(slice.name, index)} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value, name) => [formatNumber(Number(value ?? 0)), humanizeStatus(String(name))]}
              />
            </PieChart>
          </ResponsiveContainer>

          <div>
            {slices.map((slice, index) => (
              <div key={slice.name} className="list-row">
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block size-2.5 rounded-full"
                    style={{ background: colorFor(slice.name, index) }}
                  />
                  {humanizeStatus(slice.name)}
                </span>
                <span className="cell-strong">{formatNumber(slice.value)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

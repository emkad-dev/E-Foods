import type { AdminTone } from '../theme/tones';
import { humanizeStatus } from '../lib/format';

export default function StatusBadge({ label, tone }: { label?: string | null; tone: AdminTone }) {
  return <span className={`badge badge-${tone}`}>{humanizeStatus(label)}</span>;
}
